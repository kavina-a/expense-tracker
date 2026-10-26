const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSms } = require('./parsers');
const {
  purchaseMintpay,
  purchaseUber,
  reversalUber,
  creditUber,
  realInternetUber,
  realInternetUberOct18,
  realPurchaseBarista,
  realBillMobitel,
  realInternetMintpay,
  realKeellsWithCommas,
  realInternetUberWrapped,
} = require('./samples');

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

  it('ignores an interest credit', () => {
    const text = 'LKR 103.49 credited to Ac No:20802XXXXX64 on 27/09/26 21:24:32 Reason:20802XXXXX64:Int.Pd: 31-08-2026 to 27-09-2026 Bal:LKR 97,140.60 Protect from scams';
    const parsed = parseSms(text);
    assert.equal(parsed.type, 'ignore');
    assert.equal(parsed.ignore_reason, 'interest');
    assert.equal(parsed.account_masked, '2080***64');
    assert.equal(cents(parsed.amount), 10349);
  });

  it('does not treat a non-reversal credit as a reversal', () => {
    const text = 'LKR 5000.00 credited to Ac No:20802XXXXX39 on 27/09/26 05:54:22 Reason:SALARY Bal:LKR 11,762.17';
    const parsed = parseSms(text);
    assert.equal(parsed.kind, 'account_credit');
    assert.notEqual(parsed.type, 'credit_confirmation');
  });

  it('returns null for text that matches nothing', () => {
    assert.equal(parseSms('hello from a friend'), null);
    assert.equal(parseSms(''), null);
  });

  it('parses a real HNB INTERNET alert with the bank prefix', () => {
    const parsed = parseSms(realInternetUber);
    assert.equal(parsed.parser_match, 'hnb_purchase_alert');
    assert.equal(parsed.type, 'purchase');
    assert.equal(parsed.merchant, 'UBER');
    assert.equal(parsed.account_masked, '2080***39');
    assert.equal(cents(parsed.amount), 67059);
    assert.equal(cents(parsed.balance_after), 1462199);
    assert.equal(parsed.occurred_at, '2026-10-19T17:06:00');
  });

  it('parses a second real HNB INTERNET alert', () => {
    const parsed = parseSms(realInternetUberOct18);
    assert.equal(parsed.merchant, 'UBER');
    assert.equal(cents(parsed.amount), 140583);
    assert.equal(cents(parsed.balance_after), 1828858);
    assert.equal(parsed.occurred_at, '2026-10-18T18:03:00');
  });

  it('parses a real HNB PURCHASE alert with Debit account and a hyphenated merchant', () => {
    const parsed = parseSms(realPurchaseBarista);
    assert.equal(parsed.parser_match, 'hnb_purchase_alert');
    assert.equal(parsed.type, 'purchase');
    assert.equal(parsed.merchant, 'BARISTA - CARGILLS SQUARE');
    assert.equal(parsed.account_masked, '2080***39');
    assert.equal(cents(parsed.amount), 71500);
    assert.equal(cents(parsed.balance_after), 1757358);
    assert.equal(parsed.occurred_at, '2026-10-19T09:12:00');
  });

  it('parses a BillPmt debit as a Mobitel bill payment', () => {
    const parsed = parseSms(realBillMobitel);
    assert.equal(parsed.parser_match, 'hnb_bill_payment');
    assert.equal(parsed.type, 'purchase');
    assert.equal(parsed.direction, 'debit');
    assert.equal(parsed.merchant, 'MOBITEL BILL PAYMENT');
    assert.equal(parsed.account_masked, '2080***39');
    assert.equal(cents(parsed.amount), 159800);
    assert.equal(cents(parsed.balance_after), 1597558);
    assert.equal(parsed.occurred_at, '2026-10-19T10:18:43');
    assert.equal(parsed.reference, 'MB BillPmt/Mobitel/0701150250/0701150250');
  });

  it('parses a real HNB alert for MINTPAY PVT LTD', () => {
    const parsed = parseSms(realInternetMintpay);
    assert.equal(parsed.parser_match, 'hnb_purchase_alert');
    assert.equal(parsed.merchant, 'MINTPAY PVT LTD');
    assert.equal(cents(parsed.amount), 218189);
    assert.equal(parsed.occurred_at, '2026-10-19T14:24:00');
  });

  it('keeps commas inside the merchant and ignores wrapping newlines', () => {
    const keells = parseSms(realKeellsWithCommas);
    assert.equal(keells.merchant, 'KEELLS SUPER, COLOMBO 03');
    assert.equal(cents(keells.amount), 50000);
    assert.equal(keells.occurred_at, '2026-10-19T10:00:00');

    const wrapped = parseSms(realInternetUberWrapped);
    assert.equal(wrapped.merchant, 'UBER');
    assert.equal(cents(wrapped.amount), 67059);
    assert.equal(wrapped.occurred_at, '2026-10-19T17:06:00');
  });

  it('leaves non-BillPmt free-text debits unparsed', () => {
    assert.equal(parseSms('LKR 5,000.00 debited to Ac No:20802XXXXX39 on 19/10/26 10:18:43 Reason:CEFT/JOHN/DOE Bal:LKR 10,000.00'), null);
    assert.equal(parseSms('LKR 10,000.00 debited to Ac No:20802XXXXX39 on 19/10/26 10:18:43 Reason:CARD PAYMENT Bal:LKR 5,000.00'), null);
    assert.equal(parseSms('LKR 2,000.00 debited to Ac No:20802XXXXX39 on 19/10/26 10:18:43 Reason:ATM WDL Bal:LKR 8,000.00'), null);
  });
});
