const OpenAI = require('openai');
require('dotenv').config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function buildSystemPrompt(categories) {
  const incomeCategories  = categories.filter(c => c.type === 'income').map(c => c.name).join(', ');
  const expenseCategories = categories.filter(c => c.type === 'expense' || !c.type).map(c => c.name).join(', ');
  const today = new Date().toLocaleDateString('sv-SE');

  return `You are a personal income and expense tracking assistant for a Sri Lankan user. Parse messages and return ONLY valid JSON.

INCOME categories (use when money comes IN): ${incomeCategories}
EXPENSE categories (use when money goes OUT): ${expenseCategories}

For a TRANSACTION (expense or income), return:
{
  "isQuery": false,
  "amount": <positive number, Rs. implied>,
  "type": "expense" | "income",
  "category": "<exact name from the matching list above>",
  "description": "<short 1-3 word label>",
  "date": "<YYYY-MM-DD — use today unless message specifies another date>"
}

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

Classification rules:
- "spent X on Y", "X for Y", "paid X", "bought X" → expense, pick closest expense category
- "received X from Y", "earned X", "got X", "salary X", "payment X" → income, pick closest income category
- "X from Arimac/Tutopiya/class/etc." → income
- "Uber", "food", "coffee", "gym", "concert", "groceries" → expense
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
- "chart", "pie", "category chart" → chart_summary
- "trend", "monthly chart", "6 month" → chart_trend
- "daily", "daily chart", "this month chart" → chart_daily
- "stats", "all charts", "full report", "report" → stats
- Anything else → unknown

Today: ${today}
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
      { role: 'user',   content: text },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 200,
  });
  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) return { isQuery: true, queryType: 'unknown' };
  return safeParseJSON(raw);
}

async function parseImageMessage(imageBuffer, mimeType, categories) {
  const base64 = imageBuffer.toString('base64');
  const completion = await openai.chat.completions.create({
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
            image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'low' },
          },
          { type: 'text', text: 'Parse this receipt or payment screenshot as an expense transaction.' },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 200,
  });
  const raw = completion.choices?.[0]?.message?.content;
  if (!raw) return { isQuery: true, queryType: 'unknown' };
  return safeParseJSON(raw);
}

module.exports = { parseTextMessage, parseImageMessage };
