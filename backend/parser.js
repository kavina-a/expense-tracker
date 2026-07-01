const OpenAI = require('openai');
require('dotenv').config();
const { log, logError, preview } = require('./logger');

// Railway/containers often fail with openai@4's default node-fetch client
// ("Premature close"). Native fetch (undici) handles IPv4/IPv6 + chunked responses reliably.
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  fetch: globalThis.fetch,
  maxRetries: 3,
  timeout: 60_000,
});

function buildSystemPrompt(categories) {
  const incomeCategories  = categories.filter(c => c.type === 'income').map(c => c.name).join(', ');
  const expenseCategories = categories.filter(c => c.type === 'expense' || !c.type).map(c => c.name).join(', ');
  const today = new Date().toLocaleDateString('sv-SE');

  return `You are Kash — a Gen Z personal finance bestie for a Sri Lankan user. You're sharp, warm, and low-key obsessed with helping them stay on top of their money. You parse messages and return ONLY valid JSON. No markdown, no explanation, ever.

INCOME categories (money coming IN): ${incomeCategories}
EXPENSE categories (money going OUT): ${expenseCategories}

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
  "amount": <positive number, Rs. implied if no currency given>,
  "type": "expense" | "income",
  "category": "<exact name from the matching list above>",
  "description": "<2–5 words capturing what made THIS expense meaningful or specific — include people, occasions, or context if mentioned. e.g. 'flat white with Kisura', 'Uber after Blok show', 'mom's birthday dinner'>",
  "date": "<YYYY-MM-DD — use today unless message specifies another date>",
  "confirmationMessage": "<1 short casual Gen Z sentence acknowledging the log — vary it, keep it warm. e.g. 'noted, that coffee run is on record 💸', 'logged! Kisura dinner is in the books ✨', 'got it, Rs. 450 less but worth it fr'>"
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
- Examples of good ones: "that's logged, enjoy the coffee ☕", "Rs. 2400 noted — dinner with friends hits different", "logged! undo if you need to bestie"

Today: ${today}
Reply ONLY with valid JSON. No markdown, no explanation.`;
}

function safeParseJSON(raw, kind) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    log('warn', 'Parser', 'json_parse_failed', {
      kind,
      rawPreview: preview(raw, 200),
      parseError: err.message,
    });
    return { isQuery: true, queryType: 'unknown' };
  }
}

async function callChatCompletion(kind, params, meta = {}) {
  const start = Date.now();
  log('info', 'Parser', 'openai_request_start', {
    kind,
    model: params.model,
    maxTokens: params.max_tokens,
    hasApiKey: Boolean(process.env.OPENAI_API_KEY),
    ...meta,
  });

  try {
    const completion = await openai.chat.completions.create(params);
    const choice = completion.choices?.[0];
    log('info', 'Parser', 'openai_request_ok', {
      kind,
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
      model: params.model,
      durationMs: Date.now() - start,
      hasApiKey: Boolean(process.env.OPENAI_API_KEY),
      ...meta,
    });
    throw err;
  }
}

async function parseTextMessage(text, categories) {
  const completion = await callChatCompletion('text', {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: buildSystemPrompt(categories) },
      { role: 'user',   content: text },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 300,
  }, { inputPreview: preview(text) });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) {
    log('warn', 'Parser', 'openai_empty_response', { kind: 'text', inputPreview: preview(text) });
    return { isQuery: true, queryType: 'unknown' };
  }
  return safeParseJSON(raw, 'text');
}

async function parseImageMessage(imageBuffer, mimeType, categories) {
  const imageBytes = imageBuffer?.length || 0;
  const completion = await callChatCompletion('image', {
    model: 'gpt-4o-mini',
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
            image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}`, detail: 'low' },
          },
          { type: 'text', text: 'Parse this receipt or payment screenshot as an expense transaction.' },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 300,
  }, { mimeType, imageBytes });

  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) {
    log('warn', 'Parser', 'openai_empty_response', { kind: 'image', mimeType, imageBytes });
    return { isQuery: true, queryType: 'unknown' };
  }
  return safeParseJSON(raw, 'image');
}

module.exports = { parseTextMessage, parseImageMessage };
