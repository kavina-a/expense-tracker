// Payment aggregators (BNPL / wallets) are not shops and must not get a
// merchant-wide category. SMS only names the payment method; the underlying
// purchase stays unknown until Kavina answers that one charge.

const AGGREGATOR_TOKENS = ['MINTPAY'];

function isAggregatorMerchant(merchant) {
  const hay = String(merchant || '').toUpperCase();
  if (!hay.trim()) return false;
  return AGGREGATOR_TOKENS.some((token) => hay.includes(token));
}

function aggregatorPrompt(tx) {
  const who = tx.merchant || 'Mintpay';
  const amount = `LKR ${Number(tx.amount).toFixed(2)}`;
  return `${who} ${amount} is a payment method, not the shop. What was the underlying purchase, and was this Pay Now or instalments?`;
}

module.exports = {
  AGGREGATOR_TOKENS,
  isAggregatorMerchant,
  aggregatorPrompt,
};
