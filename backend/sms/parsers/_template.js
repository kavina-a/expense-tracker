// Template for adding another bank. Copy to parsers/<bank>.js, then register it in
// parsers/index.js. Work ONLY from real SMS you have seen — never guess a format.
//
// 1. Put real (redacted) samples in sms/fixtures/<bank>/ as JSON:
//      { "messages": [ { "seq": 1, "sms": "...", "expected_parse": { "kind": "...",
//        "amount": 1.00, "account": "1234***56", "direction": "debit" } } ] }
//    The generic runner in test/fixtures.test.js parses every message in every
//    fixtures/<bank>/*.json against its expected_parse. No test code to write.
// 2. Each matcher takes whitespace-collapsed text and returns null on a miss.
// 3. Return the same shape as hnb.js: bank, type, kind, account_masked, merchant,
//    amount, direction, balance_after, occurred_at (Colombo local, no offset), reference.
//    Types the ingest understands today: purchase, reversal, credit_confirmation,
//    ignore, otp, declined; everything else is parsed and logged.
// 4. Be lenient with spacing and tolerate "Label :" as well as "Label:" — banks vary.

const { canonicalizeAccount } = require('../account');

const exampleMatcher = {
  name: 'bank_example',
  parse(_text) {
    return null;
  },
};

module.exports = {
  id: 'bank',
  matchers: [exampleMatcher],
  canonicalizeAccount,
};
