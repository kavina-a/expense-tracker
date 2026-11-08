// User-approved merchant → category mappings.
//
// More specific than category_rules: an optional description_pattern must also
// appear in the merchant or description, so "CLOUDFLARE" + "DOMAIN" can map to
// Taggy without tagging every Cloudflare charge.

const db = require('../db').connection;
const { isoNow } = require('../time');

const DEFAULT_MAPPINGS = [
  {
    merchant_pattern: 'CLOUDFLARE',
    description_pattern: 'DOMAIN',
    category: 'Taggy',
    note: 'Cloudflare domain for Taggy only; not every Cloudflare charge',
  },
  {
    merchant_pattern: 'CLOUDFLARE',
    description_pattern: 'TAGGY',
    category: 'Taggy',
    note: 'Cloudflare domain for Taggy only; not every Cloudflare charge',
  },
  {
    merchant_pattern: 'FASHN.AI',
    description_pattern: '',
    category: 'Modelsnapper',
    note: 'Fashn.ai → Modelsnapper',
  },
  {
    merchant_pattern: 'FASHN AI',
    description_pattern: '',
    category: 'Modelsnapper',
    note: 'Fashn.ai → Modelsnapper',
  },
  {
    merchant_pattern: 'CLAUDE',
    description_pattern: '',
    category: 'AI Tools',
    note: 'Claude payments → existing AI Tools (AI expenses alias)',
  },
];

function normalizePattern(value) {
  return String(value || '').trim().toUpperCase();
}

function mappingRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    merchant_pattern: row.merchant_pattern,
    description_pattern: row.description_pattern || '',
    category: row.category,
    approved_by: row.approved_by,
    note: row.note,
    created_at: row.created_at,
  };
}

function seedDefaultMappings() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO merchant_mappings
      (merchant_pattern, description_pattern, category, approved_by, note, created_at)
    VALUES (?, ?, ?, 'user', ?, ?)
  `);
  const now = isoNow();
  db.transaction(() => {
    for (const mapping of DEFAULT_MAPPINGS) {
      insert.run(
        normalizePattern(mapping.merchant_pattern),
        normalizePattern(mapping.description_pattern),
        mapping.category,
        mapping.note || null,
        now,
      );
    }
  })();
}

function listMappings() {
  return db.prepare(`
    SELECT * FROM merchant_mappings
    ORDER BY LENGTH(merchant_pattern) DESC, LENGTH(description_pattern) DESC, id ASC
  `).all().map(mappingRow);
}

function upsertMapping({ merchant_pattern, description_pattern = '', category, note = null, approved_by = 'user' }) {
  const merchant = normalizePattern(merchant_pattern);
  const extra = normalizePattern(description_pattern);
  const name = String(category || '').trim();
  if (!merchant || !name) return null;
  db.prepare(`
    INSERT INTO merchant_mappings
      (merchant_pattern, description_pattern, category, approved_by, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(merchant_pattern, description_pattern) DO UPDATE SET
      category = excluded.category,
      approved_by = excluded.approved_by,
      note = excluded.note
  `).run(merchant, extra, name, approved_by || 'user', note ? String(note) : null, isoNow());
  return mappingRow(db.prepare(`
    SELECT * FROM merchant_mappings WHERE merchant_pattern = ? AND description_pattern = ?
  `).get(merchant, extra));
}

function haystack(merchant, description) {
  return `${String(merchant || '')} ${String(description || '')}`.toUpperCase();
}

function matchMerchantMapping(merchant, description = '') {
  const hay = haystack(merchant, description);
  if (!hay.trim()) return null;
  for (const row of listMappings()) {
    if (!hay.includes(row.merchant_pattern)) continue;
    if (row.description_pattern && !hay.includes(row.description_pattern)) continue;
    return row;
  }
  return null;
}

module.exports = {
  DEFAULT_MAPPINGS,
  seedDefaultMappings,
  listMappings,
  upsertMapping,
  matchMerchantMapping,
  normalizePattern,
};
