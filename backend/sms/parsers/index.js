const hnb = require('./hnb');

// First match wins. Add a bank by appending another module with the same shape:
//   { id: 'sampath', matchers: [{ name, parse(collapsedText) }] }
// parse() returns the normalized object or null. Do not throw on a miss.
const banks = [hnb];

function collapseWhitespace(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseSms(text) {
  const collapsed = collapseWhitespace(text);
  if (!collapsed) return null;
  for (const bank of banks) {
    for (const matcher of bank.matchers) {
      const parsed = matcher.parse(collapsed);
      if (parsed) {
        return {
          ...parsed,
          bank: parsed.bank || bank.id,
          parser_match: matcher.name,
        };
      }
    }
  }
  return null;
}

module.exports = { parseSms, banks, collapseWhitespace };
