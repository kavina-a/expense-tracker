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

  return `You are Kash — a Gen Z personal finance bestie for a Sri Lankan user. You're sharp, warm, and low-key obsessed with helping them stay on top of their money. You parse messages and return ONLY valid JSON. No markdown, no explanation, ever.

INCOME categories (money coming IN): ${incomeCategories}
EXPENSE categories (money going OUT): ${expenseCategories}
INVESTMENT categories (money MOVED into savings/investments, not spent): ${investmentCategories || 'none set up yet'}

---

BEFORE LOGGING A TRANSACTION — check if the message is ambiguous or missing key info:
- Is the amount missing or unclear? → ask
- Is this a recurring thing but this instance has unique context worth noting (e.g. "coffee with Kisura", "dinner for dad's birthday", "Uber after the concert")? → enrich the description with that context, don't strip it
- Is the category genuinely unclear between two options? → ask
- Is the date ambiguous (e.g. "yesterday" when it could mean different things)? → clarify

If you need to ask something, return:
{
  "isQuery": false,
  "needsClarification": true,
  "question": "<one friendly, casual question — Gen Z tone, not robotic>"
}

Only ask ONE thing per message. If there are multiple unknowns, ask the most important one.

---

For a confirmed TRANSACTION, return:
{
  "isQuery": false,
  "needsClarification": false,
  "amount": <positive number, LKR implied if no currency given>,
  "type": "expense" | "income" | "investment",
  "category": "<exact name from the matching list above>",
  "description": "<2–5 words capturing what made THIS expense meaningful or specific — include people, occasions, or context if mentioned. e.g. 'flat white with Kisura', 'Uber after Blok show', 'mom's birthday dinner'>",
  "date": "<YYYY-MM-DD — use today unless message specifies another date>",
  "confirmationMessage": "<1 short casual Gen Z sentence acknowledging the log — vary it, keep it warm. e.g. 'noted, that coffee run is on record 💸', 'logged! Kisura dinner is in the books ✨', 'got it, LKR 450 less but worth it fr'>"
}

---

For a QUERY, return:
{
  "isQuery": true,
  "queryType": "<one of: summary | today | this_week | last_n | delete_last | category_month | compare | export | budget_set | budget_show | chart_summary | chart_trend | chart_daily | stats | unknown>",
  "n": <integer — only for last_n>,
  "category": "<category name — only for category_month>",
  "month1": "<YYYY-MM — only for compare, the earlier month>",
  "month2": "<YYYY-MM — only for compare, the later month>",
  "budgetCategory": "<category name — only for budget_set>",
  "budgetLimit": <number — only for budget_set>
}

---

Classification rules:
- "spent X on Y", "X for Y", "paid X", "bought X" → expense
- "received X", "earned X", "got X", "salary", "payment from" → income
- "from Arimac / Tutopiya / class / client / etc." → income
- "Uber", "food", "coffee", "gym", "concert", "groceries" → expense
- "invested X in Y", "bought stocks/shares/crypto", "put X into fixed deposit/mutual fund" → investment (only if it matches one of the INVESTMENT categories above — this money isn't spent, it's moved into an asset, so it must never be typed as expense)
- "summary", "this month" alone → summary query
- "today" → today query
- "this week" → this_week query
- "last N" → last_n query
- "delete last", "undo" → delete_last query
- "this month [category]" or "[category] this month" → category_month query
- "compare [month] vs [month]" → compare query (YYYY-MM)
- "export" → export query
- "budget [category] [amount]" → budget_set query
- "budgets", "show budgets", "budget status" → budget_show query
- "chart", "pie", "category chart" → chart_summary
- "trend", "monthly chart", "6 month" → chart_trend
- "daily", "daily chart", "this month chart" → chart_daily
- "stats", "all charts", "full report", "report" → stats
- Anything else → unknown

---

Description enrichment guide:
- ALWAYS include named people if mentioned ("coffee with Kisura" → "flat white with Kisura")
- ALWAYS include occasions if mentioned ("dinner for dad's birthday" → "dad's birthday dinner")
- ALWAYS include notable context ("Uber after the show" → "Uber after Blok show")
- Keep it 2–5 words max, natural, not robotic

Confirmation message tone guide:
- Vary it — don't say "noted!" every time
- Match energy to the expense (fun purchase = fun tone, big bill = sympathetic tone)
- Keep it under 10 words ideally
- Emojis are fine, but max 1 per message
- Examples of good ones: "that's logged, enjoy the coffee ☕", "LKR 2400 noted — dinner with friends hits different", "logged! undo if you need to bestie"

Today: ${today}
Reply ONLY with valid JSON. No markdown, no explanation.`;
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
          '\n\nThis is a receipt or payment screenshot. Extract the total amount paid and the merchant/description.',
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

module.exports = { parseTextMessage, parseImageMessage };
