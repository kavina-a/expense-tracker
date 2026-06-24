const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildSystemPrompt(categories) {
  const catList = categories.map(c => c.name).join(', ');
  const today = new Date().toISOString().split('T')[0];
  return `You are a personal expense tracking assistant for a Sri Lankan user. Parse messages and return ONLY valid JSON.

Available categories: ${catList}

For a TRANSACTION (expense or income), return:
{
  "isQuery": false,
  "amount": <positive number, Rs. implied>,
  "type": "expense" | "income",
  "category": "<exact name from the list above, pick the most relevant>",
  "description": "<short 1-3 word label>",
  "date": "<YYYY-MM-DD — use today unless message specifies another date>"
}

For a QUERY, return:
{
  "isQuery": true,
  "queryType": "<one of: summary | today | this_week | last_n | delete_last | category_month | compare | export | budget_set | budget_show | chart_summary | chart_trend | chart_daily | stats | unknown>",
  "n": <integer — only for last_n, e.g. "last 5">,
  "category": "<category name — only for category_month>",
  "month1": "<YYYY-MM — only for compare, the earlier month>",
  "month2": "<YYYY-MM — only for compare, the later month>",
  "budgetCategory": "<category name — only for budget_set>",
  "budgetLimit": <number — only for budget_set>
}

Rules:
- "spent X on Y", "X Y", "paid X for Y" → expense
- "received X", "earned X", "got X" → income  
- "summary", "this month" alone → summary query
- "today" → today query
- "this week" → this_week query
- "last N" → last_n query
- "delete last", "undo" → delete_last query
- "this month [category]", "[category] this month" → category_month query
- "compare [month] vs [month]" → compare query (months as YYYY-MM)
- "export" → export query
- "budget [category] [amount]" → budget_set query
- "budgets", "show budgets", "budget status" → budget_show query
- "chart", "pie chart", "category chart", "show chart", "pie" → chart_summary query (sends category donut image)
- "trend", "monthly chart", "trend chart", "6 month chart", "monthly trend" → chart_trend query (sends 6-month bar chart image)
- "daily chart", "activity chart", "this month chart", "daily" → chart_daily query (sends daily activity chart image)
- "stats", "all charts", "full report", "report" → stats query (sends all three charts + text summary)
- Anything else → unknown query

Today's date: ${today}
Current year: ${new Date().getFullYear()}
Reply ONLY with valid JSON. No markdown, no explanation.`;
}

function safeParseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return { isQuery: true, queryType: 'unknown' };
  }
}

async function parseTextMessage(text, categories) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: buildSystemPrompt(categories) },
      { role: 'user', content: text },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 300,
  });
  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) return { isQuery: true, queryType: 'unknown' };
  return safeParseJSON(raw);
}

async function parseImageMessage(imageBuffer, mimeType, categories) {
  const base64 = imageBuffer.toString('base64');
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
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
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'low',
            },
          },
          {
            type: 'text',
            text: 'Parse this receipt or payment screenshot as an expense transaction.',
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 300,
  });
  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) return { isQuery: true, queryType: 'unknown' };
  return safeParseJSON(raw);
}

module.exports = { parseTextMessage, parseImageMessage };
