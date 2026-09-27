# SMS ingest

Bank SMS forwarded from an iPhone Shortcut is parsed on the server and written into the same `transactions` table the Telegram bot uses. `source` is `sms` for these rows and `telegram` for new Telegram messages. A reversed debit stays in the table with `status = 'reversed'` and drops out of totals and the default transaction list, so a voided charge does not keep counting as spend.

Set `SMS_INGEST_SECRET` in `backend/.env` (and in Railway variables) before using the endpoint. If it is unset, the route responds `503`.

## Endpoint

`POST /api/sms-ingest`

Header:

```
X-SMS-Secret: <SMS_INGEST_SECRET>
Content-Type: application/json
```

Body — send the raw SMS. Do not pre-parse it in Shortcuts.

```json
{
  "text": "SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):207.65 LKR,...",
  "received_at": "2026-09-26T18:55:00+05:30"
}
```

`received_at` is optional. The ledger date comes from the date inside the SMS, not from this field.

`401` means the header is missing or wrong. `400` means `text` is empty or `received_at` is not a parseable timestamp.

### What comes back

Every response is JSON with `ok: true` and an `action`:

| `action` | Meaning |
|---|---|
| `inserted` | New expense. `category`, `transaction_id`, and `parsed` are set. |
| `reversed` | One posted debit matched. That row is now `reversed`. No second expense or income row. |
| `linked_existing` | The debit was already reversed (the other HNB message for the same refund). Linked only. |
| `needs_review` | More than one posted debit matched. None were changed. `candidates` lists them. `review_id` is the reversal record. |
| `orphan_reversal` | Reversal or credit confirmation with nothing to attach to. Logged, not booked as income. |
| `unparsed` | No bank pattern matched. The raw text is in `sms_raw`. Nothing was added to the ledger. |
| `duplicate` | This exact SMS was already processed. |

`message` is a one-line summary you can show from the Shortcut while you are setting it up. `parsed` is the normalized object: `bank`, `type`, `account_masked`, `merchant`, `amount`, `direction`, `balance_after`, `occurred_at`, `reference`.

Example:

```bash
curl -s -X POST "$BASE/api/sms-ingest" \
  -H "Content-Type: application/json" \
  -H "X-SMS-Secret: $SMS_INGEST_SECRET" \
  -d '{"text":"SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):207.65 LKR,Av.Bal:14181.48 LKR,Date:26.09.26,Time:18:54, Hot Line:0112462462"}'
```

## Reversals

HNB sends two extra messages when a charge is voided: a `TRANSACTION REVERSAL` alert and a free-text `LKR … credited … Reason:…REV…` confirmation. Those are one event. They are not income.

Matching ignores time. A refund can land the next day or later. A reversal links to a posted SMS debit only when the canonical account, the amount (to the cent), and the merchant all match. Partial amounts are not matched.

- One candidate: that debit becomes `reversed`, and the SMS is stored on `sms_reversals` with `transaction_id` pointing at it.
- No candidate: `sms_reversals.status = 'orphan_reversal'`.
- Several candidates: `sms_reversals.status = 'needs_review'` with `candidate_ids`. Every candidate stays `posted`.

If the credit confirmation arrives after the reversal alert already flipped the debit, it links to that reversed row and does not open a new review.

### Resolving an ambiguous reversal

`GET /api/sms-review` with the same `X-SMS-Secret` header lists open reviews and their candidate expenses (`id`, `amount`, `merchant`, `date`).

Pick one candidate:

```bash
curl -s -X POST "$BASE/api/sms-review/12/resolve" \
  -H "Content-Type: application/json" \
  -H "X-SMS-Secret: $SMS_INGEST_SECRET" \
  -d '{"transaction_id": 34}'
```

That debit becomes `reversed`. The others stay `posted`.

## Accounts, categories, references

Masked numbers are stored only in canonical form: first 4 digits, `***`, last 2 digits. `2080***2939` and `20802XXXXX39` both become `2080***39`. The full number is never reconstructed. The original SMS text is kept in `sms_raw`.

`category_rules` maps a merchant substring to a category, longest pattern first, case-insensitive. Seeded rules: `UBER EATS`, `FOODPANDA`, and `PICKME FOOD` → Food; `UBER` → Transport.

When nothing matches, the server asks Groq (the same `GROQ_API_KEY` / `GROQ_MODEL` the Telegram parser uses) to pick one category the ledger already uses. A name it returns that is on that list is saved on the expense and written back into `category_rules`, so the next SMS for that merchant does not call the model. `unsure`, an invented name, or a Groq failure leaves `category` as `pending_category`. That is not the same as `Uncategorized`: pending means the question is still open. `Uncategorized` is only written when you tap that button in Telegram.

## Telegram notes

Every new SMS expense is sent to `MY_TELEGRAM_CHAT_ID`, including ones that already have a category. The message has the merchant, amount, and category (or category buttons when it is still `pending_category`), plus **👍 No note needed**. Reply to that message to set `note` on that expense. The note is never filled in by the model.

Ignoring the message changes nothing. **No note needed** sets `note_reviewed` and does not set `note`. Three of those taps in a row for the same merchant, with no note in between, asks whether to mute that merchant. **Yes, mute** stops future note messages for that merchant; category matching still runs. **No, keep asking** waits for another three taps before asking again.

Button taps and text replies are different Telegram updates. A category button, **Other**, or **Uncategorized** updates the category and the rule. A text reply sets the note, unless you tapped **Other** and are answering with a category name.

The bot only receives button taps after the webhook allows `callback_query`. Re-register it once:

```bash
curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"$PUBLIC_URL/telegram\",\"secret_token\":\"$TELEGRAM_SECRET_TOKEN\",\"allowed_updates\":[\"message\",\"callback_query\"]}"
```

Merchants in `muted_merchants` skip the note message only.

`Reason:ECOM REV/002117/ID:113007` is stored as `reference` on the reversal and copied onto the debit when that debit has no reference yet. Matching does not use it yet — there are not enough samples to know whether `113007` is stable per transaction or just a sequence number.

## Adding another bank

Add `backend/sms/parsers/<bank>.js`:

```js
module.exports = {
  id: 'sampath',
  matchers: [
    {
      name: 'sampath_purchase_alert',
      parse(text) {
        // text is already one line (newlines collapsed)
        // return null on a miss — do not throw
        return {
          bank: 'sampath',
          type: 'purchase', // or 'reversal' / 'credit_confirmation'
          account_masked: '1234***90', // canonical masked form only
          merchant: 'KEELLS',          // uppercase, or null
          amount: 1500,
          direction: 'debit',          // 'credit' for reversals
          balance_after: 2000,
          occurred_at: '2026-09-27T12:00:00', // bank-local, no timezone shift
          reference: null,
        };
      },
    },
  ],
};
```

Register it in `backend/sms/parsers/index.js` by appending the module to `banks`. Matchers run in array order, first hit wins. A `purchase` becomes an expense. `reversal` and `credit_confirmation` go through the same correlation rules and are not inserted as their own ledger rows.

Run the parser tests with `npm test` from `backend/`.
