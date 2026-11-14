const db = require('../db');
const { log, logError } = require('../logger');
const { completeJsonChat, extractJSON } = require('../parser');
const { matchMerchantMapping } = require('../ledger/mappings');
const { isAggregatorMerchant } = require('./aggregators');

const PENDING_CATEGORY = 'pending_category';

function isJsonValidateFailed(err) {
  if (!err) return false;
  const parts = [
    err.message,
    err.code,
    err.type,
    err.error?.code,
    err.error?.message,
    err.error?.failed_generation,
    typeof err.error === 'string' ? err.error : '',
  ].filter(Boolean).join(' ').toLowerCase();
  return parts.includes('json_validate_failed') || parts.includes('json_validate');
}

function interpretCategoryGuess(raw, categories) {
  let parsed;
  try {
    parsed = JSON.parse(extractJSON(raw));
  } catch {
    return { confident: false, category: null };
  }
  const name = String(parsed?.category || '').trim();
  if (!name || /^(unsure|uncertain)$/i.test(name)) {
    return { confident: false, category: null };
  }
  const match = (categories || []).find((category) => category.toLowerCase() === name.toLowerCase());
  if (!match) return { confident: false, category: null };
  return { confident: true, category: match };
}

async function guessMerchantCategory({ merchant, categories }) {
  if (!process.env.GROQ_API_KEY || !categories?.length) {
    return { confident: false, category: null };
  }
  const system = [
    'Assign this card merchant to exactly one existing expense category.',
    'Reply with JSON only: {"category":"<a name from the list, or unsure>"}',
    'Use unsure when none of the names clearly fit.',
    'Do not invent a category name.',
  ].join(' ');
  const user = `Merchant: ${merchant}\nCategories: ${categories.join(', ')}`;
  try {
    const raw = await completeJsonChat({
      kind: 'sms_category',
      system,
      user,
      maxTokens: 60,
      meta: { merchant },
    });
    if (!String(raw || '').trim()) {
      log('warn', 'SmsCategory', 'json_validate_failed', { merchant, reason: 'empty_response' });
      return { confident: false, category: null };
    }
    return interpretCategoryGuess(raw, categories);
  } catch (err) {
    if (isJsonValidateFailed(err)) {
      log('warn', 'SmsCategory', 'json_validate_failed', { merchant });
    } else {
      logError('SmsCategory', err, { merchant });
    }
    return { confident: false, category: null };
  }
}

async function resolveSmsCategory(merchant, guessCategory, extra = {}) {
  // Payment methods are not shops. Never map, learn, or guess a global category.
  if (isAggregatorMerchant(merchant)) {
    return { category: PENDING_CATEGORY, via: 'aggregator' };
  }

  const mapped = matchMerchantMapping(merchant, extra.description || extra.merchant_raw || '');
  if (mapped) return { category: mapped.category, via: 'mapping' };

  const rule = db.matchCategoryRule(merchant);
  if (rule) return { category: rule, via: 'rule' };

  const categories = db.listExpenseCategoryNames();
  if (typeof guessCategory === 'function' && merchant && categories.length) {
    try {
      const guess = await guessCategory({ merchant, categories });
      const canonical = guess?.confident
        ? categories.find((name) => name.toLowerCase() === String(guess.category || '').trim().toLowerCase())
        : null;
      if (canonical) {
        db.upsertCategoryRule(merchant, canonical);
        log('info', 'SmsCategory', 'llm_applied', { merchant, category: canonical });
        return { category: canonical, via: 'llm' };
      }
      log('info', 'SmsCategory', 'llm_unsure', { merchant });
    } catch (err) {
      if (isJsonValidateFailed(err)) {
        log('warn', 'SmsCategory', 'json_validate_failed', { merchant });
      } else {
        logError('SmsCategory', err, { merchant });
      }
    }
  }

  return { category: PENDING_CATEGORY, via: 'pending' };
}

module.exports = {
  PENDING_CATEGORY,
  isJsonValidateFailed,
  interpretCategoryGuess,
  guessMerchantCategory,
  resolveSmsCategory,
};
