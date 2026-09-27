const OpenAI = require('openai');
require('dotenv').config();
const { log, logError, preview } = require('./logger');

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_TEXT_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = process.env.GROQ_VISION_MODEL || 'llama-3.2-90b-vision-preview';
const MAX_OUTPUT_TOKENS = 512;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

// Groq is OpenAI-compatible; native fetch avoids Railway "Premature close" issues.
const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: GROQ_BASE_URL,
  fetch: globalThis.fetch,
  maxRetries: 3,
  timeout: 60_000,
});

if (!process.env.GROQ_API_KEY) {
  console.warn('[Parser] GROQ_API_KEY not set — message parsing will fail');
}

function buildSystemPrompt(categories) {
  const incomeCategories     = categories.filter(c => c.type === 'income').map(c => c.name).join(', ');
  const expenseCategories    = categories.filter(c => c.type === 'expense' || !c.type).map(c => c.name).join(', ');
  const investmentCategories = categories.filter(c => c.type === 'investment').map(c => c.name).join(', ');
  const today = new Date().toLocaleDateString('sv-SE');

  return `You are Kash — parse Sri Lankan personal finance chat into JSON only. No markdown, no prose outside JSON.

INCOME: ${incomeCategories}
EXPENSE: ${expenseCategories}
INVESTMENT: ${investmentCategories || 'none'}
Today: ${today}

If amount/category/date is missing or unclear, ask ONE casual question:
{"isQuery":false,"needsClarification":true,"question":"<one short question>"}

TRANSACTION (confirmed):
{"isQuery":false,"needsClarification":false,"amount":<number>,"type":"expense"|"income"|"investment","category":"<exact list name>","description":"<short specific label>","date":"YYYY-MM-DD","confirmationMessage":"<1 warm Gen Z sentence, ≤12 words, max 1 emoji>"}

QUERY:
{"isQuery":true,"queryType":"<summary|today|this_week|last_n|delete_last|category_month|compare|export|budget_set|budget_show|chart_summary|chart_trend|chart_daily|stats|unknown>","n":<int?>,"category":"<name?>","month1":"YYYY-MM?","month2":"YYYY-MM?","budgetCategory":"<name?>","budgetLimit":<num?>}

Classify:
- spent/paid/bought/Uber/food/coffee/gym → expense
- received/earned/salary/from employer or client → income
- invested/stocks/FD/mutual fund matching INVESTMENT list → investment (never expense)
- summary / today / this week / last N / delete last|undo / export / budgets → matching query
- "budget [cat] [amount]" → budget_set; "compare A vs B" → compare
- chart|pie → chart_summary; trend → chart_trend; daily → chart_daily; stats|report → stats

Description rules (critical):
- Category = bucket. Description = what actually happened — do NOT replace specifics with the category name.
- KEEP place/venue/brand/restaurant names exactly as said (Isso, Barista, KFC, Galle Face, etc.). Never drop them.
- KEEP people and occasions if mentioned.
- Casual shorthand for food/outing still means food/out — map category correctly, but leave the shorthand IN the description.
- Prefer "<place> with <people>" or "<place> <what>" over generic "lunch with friends".
- "with friends" / outing → prefer "Out w Friends" when that category exists; otherwise Food.
- Examples: "had ESO with friends" → category Out w Friends, description "ESO with friends"; "450 barista" → description "Barista"; "Uber after Blok" → "Uber after Blok".
- 2–8 words. Natural, not robotic.

confirmationMessage: vary it, warm Gen Z, mention the place/people when present (e.g. "ESO with the crew — logged 💸").

If the user message includes "Previous:" and "Follow-up:", merge them into one transaction (previous has context; follow-up usually has the missing amount/detail).`;
}

function extractJSON(raw) {
  const trimmed = String(raw || '').trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function safeParseJSON(raw, kind) {
  const cleaned = extractJSON(raw);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    log('warn', 'Parser', 'json_parse_failed', {
      kind,
      rawPreview: preview(cleaned, 200),
      parseError: err.message,
    });
    return { isQuery: true, queryType: 'unknown' };
  }
}

async function callChatCompletion(kind, params, meta = {}) {
  const start = Date.now();
  log('info', 'Parser', 'llm_request_start', {
    kind,
    provider: 'groq',
    model: params.model,
    maxTokens: params.max_tokens,
    hasApiKey: Boolean(process.env.GROQ_API_KEY),
    ...meta,
  });

  try {
    const completion = await groq.chat.completions.create(params);
    const choice = completion.choices?.[0];
    log('info', 'Parser', 'llm_request_ok', {
      kind,
      provider: 'groq',
      model: params.model,
      durationMs: Date.now() - start,
      finishReason: choice?.finish_reason,
      usage: completion.usage,
      responsePreview: preview(choice?.message?.content, 160),
    });
    return completion;
  } catch (err) {
    logError('Parser', err, {
      kind,
      provider: 'groq',
      model: params.model,
      durationMs: Date.now() - start,
      hasApiKey: Boolean(process.env.GROQ_API_KEY),
      ...meta,
    });
    throw err;
  }
}

async function parseTextMessage(text, categories) {
  const completion = await callChatCompletion('text', {
    model: GROQ_TEXT_MODEL,
    messages: [
      { role: 'system', content: buildSystemPrompt(categories) },
      { role: 'user',   content: text },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
  }, { inputPreview: preview(text) });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) {
    log('warn', 'Parser', 'llm_empty_response', { kind: 'text', inputPreview: preview(text) });
    return { isQuery: true, queryType: 'unknown' };
  }
  return safeParseJSON(raw, 'text');
}

async function parseImageMessage(imageBuffer, mimeType, categories) {
  const imageBytes = imageBuffer?.length || 0;
  if (imageBytes > MAX_IMAGE_BYTES) {
    log('warn', 'Parser', 'image_too_large', { imageBytes, maxBytes: MAX_IMAGE_BYTES });
    return {
      isQuery: false,
      needsClarification: true,
      question: 'That image is a bit too large for me — can you send a smaller screenshot or just type the amount?',
    };
  }

  const completion = await callChatCompletion('image', {
    model: GROQ_VISION_MODEL,
    messages: [
      {
        role: 'system',
        content:
          buildSystemPrompt(categories) +
          '\n\nThis is a receipt or payment screenshot. Extract the total amount paid and the merchant/description. Keep the merchant name in description.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` },
          },
          { type: 'text', text: 'Parse this receipt or payment screenshot as an expense transaction.' },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
  }, { mimeType, imageBytes });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) {
    log('warn', 'Parser', 'llm_empty_response', { kind: 'image', mimeType, imageBytes });
    return { isQuery: true, queryType: 'unknown' };
  }
  return safeParseJSON(raw, 'image');
}

async function completeJsonChat({ kind, system, user, maxTokens = 80, meta = {} }) {
  const completion = await callChatCompletion(kind, {
    model: GROQ_TEXT_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: maxTokens,
  }, meta);
  return completion.choices?.[0]?.message?.content || '';
}

module.exports = { parseTextMessage, parseImageMessage, buildSystemPrompt, completeJsonChat, extractJSON };
