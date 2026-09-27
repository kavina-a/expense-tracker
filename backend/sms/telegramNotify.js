const db = require('../db');
const tg = require('../telegram');
const { log } = require('../logger');
const { PENDING_CATEGORY } = require('./categorize');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function chatIdFrom(deps) {
  return deps.chatId || process.env.MY_TELEGRAM_CHAT_ID || '';
}

function sender(deps) {
  return deps.sendMessage || ((id, text, options) => tg.sendMessage(id, text, options));
}

function expenseMessage(tx) {
  const lines = [
    `<b>${escapeHtml(tx.merchant || 'Purchase')}</b>`,
    `LKR ${Number(tx.amount).toFixed(2)}`,
  ];
  if (tx.category === PENDING_CATEGORY) {
    lines.push('What category is this?');
  } else {
    lines.push(escapeHtml(tx.category));
  }
  lines.push('Reply to this message to add a note.');
  return lines.join('\n');
}

function keyboardFor(tx, categories) {
  const rows = [];
  if (tx.category === PENDING_CATEGORY) {
    for (let i = 0; i < categories.length; i += 2) {
      const row = [];
      for (let j = i; j < Math.min(i + 2, categories.length); j += 1) {
        row.push({ text: categories[j], callback_data: `s:c:${tx.id}:${j}` });
      }
      rows.push(row);
    }
    rows.push([{ text: 'Other', callback_data: `s:o:${tx.id}` }]);
    rows.push([{ text: 'Uncategorized', callback_data: `s:u:${tx.id}` }]);
  }
  rows.push([{ text: '👍 No note needed', callback_data: `s:n:${tx.id}` }]);
  return { inline_keyboard: rows };
}

function muteKeyboard(txId) {
  return {
    inline_keyboard: [[
      { text: 'Yes, mute', callback_data: `s:m:${txId}:1` },
      { text: 'No, keep asking', callback_data: `s:m:${txId}:0` },
    ]],
  };
}

async function notifySmsExpense(transaction, deps = {}) {
  const tx = db.getTransactionById(transaction.id) || transaction;
  if (!tx || tx.source !== 'sms') return { notified: false, reason: 'not_sms' };
  if (db.isMerchantMuted(tx.merchant)) return { notified: false, reason: 'muted' };
  if (tx.telegram_notify_message_id) return { notified: false, reason: 'already_sent' };

  const chatId = chatIdFrom(deps);
  if (!chatId) return { notified: false, reason: 'no_chat' };

  const categories = tx.category === PENDING_CATEGORY ? db.listCategoriesInUse() : [];
  const sent = await sender(deps)(chatId, expenseMessage(tx), {
    reply_markup: keyboardFor(tx, categories),
  });
  const messageId = sent?.message_id ?? null;
  if (!messageId) {
    log('warn', 'SmsNotify', 'send_failed', { transaction_id: tx.id, merchant: tx.merchant });
    return { notified: false, reason: 'send_failed' };
  }

  db.updateSmsExpense(tx.id, {
    telegram_notify_message_id: messageId,
    category_prompt_options: categories.length ? JSON.stringify(categories) : null,
  });
  log('info', 'SmsNotify', 'sent', {
    transaction_id: tx.id,
    message_id: messageId,
    category: tx.category,
    merchant: tx.merchant,
  });
  return { notified: true, message_id: messageId };
}

function streakWarrantsMute(tx) {
  if (!tx?.merchant || db.isMerchantMuted(tx.merchant)) return false;
  const streak = db.getNoteStreak(tx.merchant);
  if (streak.last_suggested_tx_id === tx.id) return false;
  const recent = db.recentSmsDebits(tx.merchant, streak.reset_after_tx_id, 3);
  if (recent.length < 3) return false;
  return recent.every((row) => row.note_reviewed && !row.note);
}

async function maybeSuggestMute(tx, deps) {
  if (!streakWarrantsMute(tx)) return false;
  const chatId = chatIdFrom(deps);
  if (!chatId) return false;
  const sent = await sender(deps)(
    chatId,
    `Mute note-prompts for ${escapeHtml(tx.merchant)}?`,
    { reply_markup: muteKeyboard(tx.id) },
  );
  if (!sent?.message_id) return false;
  db.setNoteStreak(tx.merchant, { last_suggested_tx_id: tx.id });
  return true;
}

function applyCategory(tx, category) {
  db.updateSmsExpense(tx.id, {
    category,
    category_reply_pending: 0,
  });
  if (tx.merchant) db.upsertCategoryRule(tx.merchant, category);
  return db.getTransactionById(tx.id);
}

async function clearKeyboard(query, deps) {
  const edit = deps.editMessageReplyMarkup || tg.editMessageReplyMarkup;
  const chatId = query.message?.chat?.id;
  const messageId = query.message?.message_id;
  if (chatId && messageId) await edit(chatId, messageId, { inline_keyboard: [] });
}

async function handleSmsCallback(query, deps = {}) {
  const data = String(query?.data || '');
  if (!data.startsWith('s:')) return false;

  const answer = deps.answerCallbackQuery || tg.answerCallbackQuery;
  if (query.id) await answer(query.id);

  const [, kind, idRaw, extra] = data.split(':');
  const txId = parseInt(idRaw, 10);
  const tx = db.getTransactionById(txId);
  if (!tx || tx.source !== 'sms') return true;

  const chatId = query.message?.chat?.id || chatIdFrom(deps);
  const send = sender({ ...deps, chatId });

  if (kind === 'n') {
    db.updateSmsExpense(tx.id, { note_reviewed: 1 });
    const updated = db.getTransactionById(tx.id);
    await clearKeyboard(query, deps);
    if (chatId) await send(chatId, 'No note needed.');
    const suggested = await maybeSuggestMute(updated, { ...deps, chatId });
    return { handled: true, action: 'note_reviewed', suggestMute: suggested, transaction: updated };
  }

  if (kind === 'c') {
    const options = JSON.parse(tx.category_prompt_options || '[]');
    const category = options[parseInt(extra, 10)];
    if (!category) return { handled: true, action: 'ignored' };
    const updated = applyCategory(tx, category);
    await clearKeyboard(query, deps);
    if (chatId) await send(chatId, `${escapeHtml(tx.merchant)} → ${escapeHtml(category)}`);
    return { handled: true, action: 'category', transaction: updated };
  }

  if (kind === 'u') {
    const updated = applyCategory(tx, 'Uncategorized');
    await clearKeyboard(query, deps);
    if (chatId) await send(chatId, `${escapeHtml(tx.merchant)} left as Uncategorized.`);
    return { handled: true, action: 'uncategorized', transaction: updated };
  }

  if (kind === 'o') {
    db.updateSmsExpense(tx.id, { category_reply_pending: 1 });
    await clearKeyboard(query, deps);
    let promptId = null;
    if (chatId) {
      const sent = await send(
        chatId,
        `Reply to this message with a category name for ${escapeHtml(tx.merchant)}.`,
      );
      promptId = sent?.message_id ?? null;
      if (promptId) db.updateSmsExpense(tx.id, { category_prompt_message_id: promptId });
    }
    return { handled: true, action: 'awaiting_category', prompt_message_id: promptId };
  }

  if (kind === 'm') {
    await clearKeyboard(query, deps);
    if (extra === '1') {
      db.muteMerchant(tx.merchant);
      if (chatId) await send(chatId, `Muted note-prompts for ${escapeHtml(tx.merchant)}.`);
      return { handled: true, action: 'muted' };
    }
    db.setNoteStreak(tx.merchant, { reset_after_tx_id: tx.id });
    if (chatId) await send(chatId, `I'll keep asking about ${escapeHtml(tx.merchant)}.`);
    return { handled: true, action: 'mute_declined' };
  }

  return { handled: true, action: 'ignored' };
}

async function handleSmsTextReply(message, deps = {}) {
  const replyId = message?.reply_to_message?.message_id;
  const text = String(message?.text || '').trim();
  if (!replyId || !text) return false;

  const tx = db.findSmsExpenseByNotifyMessageId(replyId);
  if (!tx) return false;

  const chatId = message.chat?.id || chatIdFrom(deps);
  const send = sender({ ...deps, chatId });

  if (tx.category_reply_pending) {
    const updated = applyCategory(tx, text);
    if (chatId) await send(chatId, `${escapeHtml(tx.merchant)} → ${escapeHtml(text)}`);
    return { handled: true, action: 'category_text', transaction: updated };
  }

  const updated = db.updateSmsExpense(tx.id, { note: text });
  if (chatId) await send(chatId, 'Note saved.');
  return { handled: true, action: 'note', transaction: updated };
}

module.exports = {
  notifySmsExpense,
  handleSmsCallback,
  handleSmsTextReply,
  expenseMessage,
  streakWarrantsMute,
};
