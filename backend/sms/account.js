// Masked account tails differ by SMS shape. Both of these are the same HNB account:
//   2080***2939  (purchase / reversal alert)
//   20802XXXXX39 (free-text credit confirmation)
// Canonical form keeps the first 4 and last 2 visible digits and never rebuilds
// a full account number.

function canonicalizeAccount(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const leading = (text.match(/^\d+/) || [''])[0];
  const trailing = (text.match(/\d+$/) || [''])[0];
  if (leading.length < 4 || trailing.length < 2) return null;
  return `${leading.slice(0, 4)}***${trailing.slice(-2)}`;
}

module.exports = { canonicalizeAccount };
