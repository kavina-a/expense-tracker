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

function maskedAccountsIn(text) {
  const found = [];
  const re = /\d[\dXx*]{4,}\d/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    if (!/[*Xx]/.test(match[0])) continue;
    const canon = canonicalizeAccount(match[0]);
    if (canon && !found.includes(canon)) found.push(canon);
  }
  return found;
}

// Masked tokens and bare account numbers (10+ digits). Store names are skipped.
function accountTokensIn(text) {
  const found = [];
  const re = /\d[\dXx*]{8,}\d/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    const token = match[0];
    const digits = token.replace(/\D/g, '');
    if (!/[*Xx]/.test(token) && digits.length < 10) continue;
    const canon = canonicalizeAccount(token);
    if (canon && !found.includes(canon)) found.push(canon);
  }
  return found;
}

module.exports = { canonicalizeAccount, maskedAccountsIn, accountTokensIn };
