const axios = require('axios');
const path = require('path');
require('dotenv').config();

const BASE = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

// ─── Send text ────────────────────────────────────────────────────────────────

async function sendMessage(chatId, text, options = {}) {
  try {
    const payload = {
      chat_id:    chatId,
      text,
      parse_mode: 'HTML',
    };
    if (options.reply_markup) payload.reply_markup = options.reply_markup;
    const { data } = await axios.post(`${BASE()}/sendMessage`, payload);
    return data.result || null;
  } catch (err) {
    console.error('[Telegram] Send error:', err.response?.data || err.message);
    return null;
  }
}

async function answerCallbackQuery(callbackQueryId, text = '') {
  try {
    await axios.post(`${BASE()}/answerCallbackQuery`, {
      callback_query_id: callbackQueryId,
      text: text || undefined,
    });
  } catch (err) {
    console.error('[Telegram] answerCallbackQuery error:', err.response?.data || err.message);
  }
}

async function editMessageReplyMarkup(chatId, messageId, replyMarkup) {
  try {
    await axios.post(`${BASE()}/editMessageReplyMarkup`, {
      chat_id:      chatId,
      message_id:   messageId,
      reply_markup: replyMarkup || { inline_keyboard: [] },
    });
  } catch (err) {
    console.error('[Telegram] editMessageReplyMarkup error:', err.response?.data || err.message);
  }
}

// ─── Send a chart image (PNG buffer) ─────────────────────────────────────────

async function sendChartImage(chatId, imageBuffer, caption = '') {
  try {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('photo', imageBuffer, { filename: 'chart.png', contentType: 'image/png' });
    if (caption) form.append('caption', caption);

    await axios.post(`${BASE()}/sendPhoto`, form, {
      headers: form.getHeaders(),
    });
  } catch (err) {
    console.error('[Telegram] Send photo error:', err.response?.data || err.message);
    throw err;
  }
}

// ─── Download a photo sent by the user ───────────────────────────────────────

function mimeFromName(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  const types = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.webm': 'audio/webm',
  };
  return types[ext] || 'application/octet-stream';
}

async function downloadMedia(fileId) {
  try {
    const { data: fileInfo } = await axios.get(`${BASE()}/getFile?file_id=${fileId}`);
    const filePath = fileInfo.result.file_path;
    const filename = path.basename(filePath);
    const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    return { buffer: Buffer.from(data), mimeType: mimeFromName(filename), filename };
  } catch (err) {
    console.error('[Telegram] Download error:', err.response?.data || err.message);
    return null;
  }
}

// ─── Register webhook with Telegram ──────────────────────────────────────────

async function registerWebhook(webhookUrl) {
  const { data } = await axios.post(`${BASE()}/setWebhook`, {
    url:          webhookUrl,
    secret_token: process.env.TELEGRAM_SECRET_TOKEN || '',
    allowed_updates: ['message', 'callback_query'],
  });
  return data;
}

module.exports = {
  sendMessage,
  sendChartImage,
  downloadMedia,
  registerWebhook,
  answerCallbackQuery,
  editMessageReplyMarkup,
};
