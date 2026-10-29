const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSms } = require('./parsers');

// One test per HNB SMS kind. The values are made up; only the shapes come from
// real messages, including the odd spacing HNB really sends.
const SAMPLES = {
  card_debit_online: 'HNB SMS ALERT:INTERNET, Account:2080***2939,Location :SHOP ONE, LK,Amount(Approx.):120.50 LKR,Av.Bal:900.00 LKR,Date:01.11.26,Time:10:15, Hot Line:0112462462',
  card_debit_pos: 'HNB SMS ALERT: PURCHASE, Debit account:2080***2939,Location :CAFE TWO - MAIN ST, LK,Amount(Approx.):450.00 LKR,Av.Bal:450.00 LKR,Date:01.11.26,Time:11:00, Hot Line:0112462462',
  card_reversal: 'TRANSACTION REVERSAL, Credit account:2080***2939,Location :SHOP ONE, LK,Amount:120.50 LKR,Av.Bal:1020.50 LKR,Date:02.11.26,Time:06:30, Hot Line:0112462462',
  ecom_reversal_credit: 'LKR 120.50 credited to Ac No:20802XXXXX39 on 02/11/26 06:30:41 Reason:ECOM REV/000001/ID:113007 Bal:LKR 1,020.50 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
  declined: 'HNB SMS ALERT:Transaction for Amt(Approx.):  800.00 LKR declined due to insufficient funds.Please attempt when sufficient funds are available. Account: 2080***2939,Location: SHOP ONE, LK,Avl Bal: 100.00 LKR,Date: 03.11.26, Time:09:05,Hotline:0112462462',
  merchant_adjustment_credit: 'A Transaction for LKR 25.00 has been credit ed to Ac No:20802XXXXX39 on 04/11/26 12:00:00 . Remarks :ADJ FOR ECOM/SHOP ONE11/03.Bal: LKR 1,045.50',
  mb_transfer_debit: 'LKR 2,000.00 debited to Ac No:20802XXXXX64 on 05/11/26 14:00:00 Reason:MB:for the tickets Bal:LKR 8,000.00 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
  bill_payment: 'LKR 900.00 debited to Ac No:20802XXXXX39 on 05/11/26 10:00:00 Reason:MB BillPmt/Dialog/0770000000/0770000000 Bal:LKR 5,000.00 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
  salary_credit: 'LKR 50,000.00 credited to Ac No:20802XXXXX91 on 24/11/26 09:00:00 Reason:SALARY_NOV_2026/BT/999 Bal:LKR 50,000.00 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
  account_credit: 'LKR 3,000.00 credited to Ac No:20802XXXXX39 on 06/11/26 08:00:00 Reason:Kavina Bal:LKR 4,000.00 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
  interest_credit: 'LKR 1.50 credited to Ac No:20802XXXXX82 on 24/11/26 21:51:07 Reason:20802XXXXX82:Int.Pd: 28-10-2026 to 24-11-2026 Bal:LKR 4.00 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462',
  inbound_transfer_notice: 'You received LKR 1,500 from DOE J\nOTP අංකය හෝ රහස්‍ය තොරතුරු කිසිවෙකුටවත් ලබා නොදෙන්න.\nDo not share OTP & sensitive information with anyone.',
  otp: 'Your verification code is 654321. Use this to verify your transfer with HNB Digital Banking\nDo not share OTP & sensitive information with anyone.',
};

describe('HNB parser kinds', () => {
  it('card_debit (online)', () => {
    const p = parseSms(SAMPLES.card_debit_online);
    assert.equal(p.kind, 'card_debit');
    assert.equal(p.channel, 'online');
    assert.equal(p.type, 'purchase');
    assert.equal(p.merchant, 'SHOP ONE');
    assert.equal(p.amount, 120.5);
    assert.equal(p.account_masked, '2080***39');
    assert.equal(p.balance_after, 900);
    assert.equal(p.occurred_at, '2026-11-01T10:15:00');
  });

  it('card_debit (point of sale)', () => {
    const p = parseSms(SAMPLES.card_debit_pos);
    assert.equal(p.kind, 'card_debit');
    assert.equal(p.channel, 'pos');
    assert.equal(p.merchant, 'CAFE TWO - MAIN ST');
  });

  it('card_reversal', () => {
    const p = parseSms(SAMPLES.card_reversal);
    assert.equal(p.kind, 'card_reversal');
    assert.equal(p.direction, 'credit');
    assert.equal(p.amount, 120.5);
  });

  it('ecom_reversal_credit', () => {
    const p = parseSms(SAMPLES.ecom_reversal_credit);
    assert.equal(p.kind, 'ecom_reversal_credit');
    assert.equal(p.type, 'credit_confirmation');
    assert.equal(p.balance_after, 1020.5);
    assert.match(p.reference, /^ECOM REV\/000001/);
  });

  it('declined carries a low-balance signal and never an amount direction', () => {
    const p = parseSms(SAMPLES.declined);
    assert.equal(p.kind, 'declined');
    assert.equal(p.direction, 'none');
    assert.equal(p.signal, 'low_balance');
    assert.equal(p.amount, 800);
    assert.equal(p.balance_after, 100);
    assert.equal(p.account_masked, '2080***39');
    assert.equal(p.occurred_at, '2026-11-03T09:05:00');
  });

  it('merchant_adjustment_credit reads the original date from the remark', () => {
    const p = parseSms(SAMPLES.merchant_adjustment_credit);
    assert.equal(p.kind, 'merchant_adjustment_credit');
    assert.equal(p.merchant, 'SHOP ONE');
    assert.equal(p.amount, 25);
    assert.equal(p.original_txn_date, '2026-11-03');
    assert.equal(p.occurred_at, '2026-11-04T12:00:00');
  });

  it('mb_transfer_debit keeps the remark as the user note', () => {
    const p = parseSms(SAMPLES.mb_transfer_debit);
    assert.equal(p.kind, 'mb_transfer_debit');
    assert.equal(p.user_note, 'for the tickets');
    assert.equal(p.account_masked, '2080***64');
    assert.equal(p.direction, 'debit');
  });

  it('bill_payment', () => {
    const p = parseSms(SAMPLES.bill_payment);
    assert.equal(p.kind, 'bill_payment');
    assert.equal(p.merchant, 'DIALOG');
  });

  it('salary_credit knows its month', () => {
    const p = parseSms(SAMPLES.salary_credit);
    assert.equal(p.kind, 'salary_credit');
    assert.equal(p.salary_month, '2026-11');
    assert.equal(p.account_masked, '2080***91');
  });

  it('account_credit', () => {
    const p = parseSms(SAMPLES.account_credit);
    assert.equal(p.kind, 'account_credit');
    assert.equal(p.reason, 'Kavina');
    assert.equal(p.direction, 'credit');
  });

  it('interest_credit', () => {
    const p = parseSms(SAMPLES.interest_credit);
    assert.equal(p.kind, 'interest_credit');
    assert.equal(p.type, 'ignore');
  });

  it('inbound_transfer_notice has no account, balance or time', () => {
    const p = parseSms(SAMPLES.inbound_transfer_notice);
    assert.equal(p.kind, 'inbound_transfer_notice');
    assert.equal(p.amount, 1500);
    assert.equal(p.payer, 'DOE J');
    assert.equal(p.account_masked, null);
    assert.equal(p.occurred_at, null);
  });

  it('otp is recognised and its code is redacted', () => {
    const p = parseSms(SAMPLES.otp);
    assert.equal(p.kind, 'otp');
    assert.ok(!p.redacted_text.includes('654321'));
    assert.match(p.redacted_text, /\[redacted\]/);
  });

  it('copes with whitespace variants', () => {
    const tight = SAMPLES.card_debit_online.replace('Location :', 'Location:').replace('Av.Bal:', 'Avl Bal:');
    assert.equal(parseSms(tight).kind, 'card_debit');
    const spaced = SAMPLES.ecom_reversal_credit.replace('Bal:LKR', 'Bal: LKR');
    assert.equal(parseSms(spaced).kind, 'ecom_reversal_credit');
    const credited = SAMPLES.merchant_adjustment_credit.replace('credit ed', 'credited');
    assert.equal(parseSms(credited).kind, 'merchant_adjustment_credit');
  });

  it('returns null for unknown text instead of guessing', () => {
    assert.equal(parseSms('Your parcel is out for delivery'), null);
    assert.equal(parseSms('LKR 10.00 withdrawn at ATM somewhere'), null);
  });
});
