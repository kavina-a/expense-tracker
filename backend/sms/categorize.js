const db = require('../db');
const { log, logError } = require('../logger');
const { completeJsonChat, extractJSON } = require('../parser');

const PENDING_CATEGORY = 'pending_category';

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
    return interpretCategoryGuess(raw, categories);
  } catch (err) {
    logError('SmsCategory', err, { merchant });
    return { confident: false, category: null };
  }
}

async function resolveSmsCategory(merchant, guessCategory) {
  const rule = db.matchCategoryRule(merchant);
  if (rule) return { category: rule, via: 'rule' };

  const categories = db.listCategoriesInUse();
  if (typeof guessCategory === 'function' && merchant && categories.length) {
    const guess = await guessCategory({ merchant, categories });
    const canonical = guess?.confident
      ? categories.find((name) => name.toLowerCase() === String(guess.category || '').toLowerCase())
      : null;
    if (canonical) {
      db.upsertCategoryRule(merchant, canonical);
      log('info', 'SmsCategory', 'llm_applied', { merchant, category: canonical });
      return { category: canonical, via: 'llm' };
    }
    log('info', 'SmsCategory', 'llm_unsure', { merchant });
  }

  return { category: PENDING_CATEGORY, via: 'pending' };
}

module.exports = {
  PENDING_CATEGORY,
  interpretCategoryGuess,
  guessMerchantCategory,
  resolveSmsCategory,
};
