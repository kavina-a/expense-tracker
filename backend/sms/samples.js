const purchaseMintpay = 'SMS ALERT:INTERNET, Account:2080***2939,Location:MINTPAY, LK,Amount(Approx.):1722.00 LKR,Av.Bal:15184.20 LKR,Date:25.09.26,Time:14:28, Hot Line:0112462462';

const purchaseUber = 'SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):207.65 LKR,Av.Bal:14181.48 LKR,Date:26.09.26,Time:18:54, Hot Line:0112462462';

const reversalUber = 'TRANSACTION REVERSAL, Credit account:2080***2939,Location:UBER, LK,Amount:207.65 LKR,Av.Bal:11762.17 LKR,Date:27.09.26,Time:05:54, Hot Line:0112462462';

const creditUber = `LKR 207.65 credited to Ac No:20802XXXXX39 on 27/09/26 05:54:22 Reason:ECOM REV/002117/ID:113007 Bal:LKR 11,762.17
Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP*
Hotline 0112462462`;

module.exports = { purchaseMintpay, purchaseUber, reversalUber, creditUber };
