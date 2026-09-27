const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSms } = require('./parsers');
const { purchaseMintpay, purchaseUber, reversalUber, creditUber } = require('./samples');

function cents(amount) {
  return Math.round(Number(amount) * 100);
}

describe('HNB parser', () => {
  it('parses a card purchase alert', () => {
    const parsed = parseSms(purchaseMintpay);
    assert.equal(parsed.bank, 'hnb');
    assert.equal(parsed.parser_match, 'hnb_purchase_alert');
    assert.equal(parsed.type, 'purchase');
    assert.equal(parsed.direction, 'debit');
    assert.equal(parsed.account_masked, '2080***39');
    assert.equal(parsed.merchant, 'MINTPAY');
    assert.equal(cents(parsed.amount), 172200);
    assert.equal(cents(parsed.balance_after), 1518420);
    assert.equal(parsed.occurred_at, '2026-09-25T14:28:00');
    assert.equal(parsed.reference, null);
  });

  it('parses a second purchase with the same shape', () => {
    const parsed = parseSms(purchaseUber);
    assert.equal(parsed.type, 'purchase');
    assert.equal(parsed.merchant, 'UBER');
    assert.equal(parsed.account_masked, '2080***39');
    assert.equal(cents(parsed.amount), 20765);
    assert.equal(parsed.occurred_at, '2026-09-26T18:54:00');
    assert.equal(cents(parsed.balance_after), 1418148);
  });

  it('parses a transaction reversal alert', () => {
    const parsed = parseSms(reversalUber);
    assert.equal(parsed.parser_match, 'hnb_reversal_alert');
    assert.equal(parsed.type, 'reversal');
    assert.equal(parsed.direction, 'credit');
    assert.equal(parsed.merchant, 'UBER');
    assert.equal(parsed.account_masked, '2080***39');
    assert.equal(cents(parsed.amount), 20765);
    assert.equal(parsed.occurred_at, '2026-09-27T05:54:00');
    assert.equal(parsed.reference, null);
    assert.equal(cents(parsed.balance_after), 1176217);
  });

  it('parses the free-text credit confirmation and canonicalizes the other mask', () => {
    const parsed = parseSms(creditUber);
    assert.equal(parsed.parser_match, 'hnb_credit_confirmation');
    assert.equal(parsed.type, 'credit_confirmation');
    assert.equal(parsed.direction, 'credit');
    assert.equal(parsed.merchant, null);
    assert.equal(parsed.account_masked, '2080***39');
    assert.equal(parseSms(purchaseUber).account_masked, parsed.account_masked);
    assert.equal(cents(parsed.amount), 20765);
    assert.equal(parsed.occurred_at, '2026-09-27T05:54:22');
    assert.equal(parsed.reference, 'ECOM REV/002117/ID:113007');
    assert.equal(cents(parsed.balance_after), 1176217);
  });

  it('keeps a multi-word location as the merchant', () => {
    const text = 'SMS ALERT:INTERNET, Account:2080***2939,Location:UBER EATS, LK,Amount(Approx.):900.00 LKR,Av.Bal:100.00 LKR,Date:02.02.26,Time:12:00, Hot Line:0112462462';
    assert.equal(parseSms(text).merchant, 'UBER EATS');
  });

  it('does not treat a non-reversal credit as a reversal', () => {
    const text = 'LKR 5000.00 credited to Ac No:20802XXXXX39 on 27/09/26 05:54:22 Reason:SALARY Bal:LKR 11,762.17';
    assert.equal(parseSms(text), null);
  });

  it('returns null for text that matches nothing', () => {
    assert.equal(parseSms('hello from a friend'), null);
    assert.equal(parseSms(''), null);
  });
});
