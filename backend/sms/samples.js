const purchaseMintpay = 'SMS ALERT:INTERNET, Account:2080***2939,Location:MINTPAY, LK,Amount(Approx.):1722.00 LKR,Av.Bal:15184.20 LKR,Date:25.09.26,Time:14:28, Hot Line:0112462462';

const purchaseUber = 'SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):207.65 LKR,Av.Bal:14181.48 LKR,Date:26.09.26,Time:18:54, Hot Line:0112462462';

const reversalUber = 'TRANSACTION REVERSAL, Credit account:2080***2939,Location:UBER, LK,Amount:207.65 LKR,Av.Bal:11762.17 LKR,Date:27.09.26,Time:05:54, Hot Line:0112462462';

const creditUber = `LKR 207.65 credited to Ac No:20802XXXXX39 on 27/09/26 05:54:22 Reason:ECOM REV/002117/ID:113007 Bal:LKR 11,762.17
Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP*
Hotline 0112462462`;

const realInternetUber = 'HNB SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):670.59 LKR,Av.Bal:14621.99 LKR,Date:19.10.26,Time:17:06, Hot Line:0112462462';

const realInternetUberOct18 = 'HNB SMS ALERT:INTERNET, Account:2080***2939,Location:UBER, LK,Amount(Approx.):1405.83 LKR,Av.Bal:18288.58 LKR,Date:18.10.26,Time:18:03, Hot Line:0112462462';

const realPurchaseBarista = 'HNB SMS ALERT: PURCHASE, Debit account:2080***2939,Location:BARISTA - CARGILLS SQUARE, LK,Amount(Approx.):715.00 LKR,Av.Bal:17573.58 LKR,Date:19.10.26,Time:09:12, Hot Line:0112462462';

const realBillMobitel = 'LKR 1,598.00 debited to Ac No:20802XXXXX39 on 19/10/26 10:18:43 Reason:MB BillPmt/Mobitel/0701150250/0701150250 Bal:LKR 15,975.58 Protect from scams *DO NOT SHARE ACCOUNT DETAILS /OTP* Hotline 0112462462';

const realInternetMintpay = 'HNB SMS ALERT:INTERNET, Account:2080***2939,Location:MINTPAY PVT LTD, LK,Amount(Approx.):2181.89 LKR,Av.Bal:12345.67 LKR,Date:19.10.26,Time:14:24, Hot Line:0112462462';

const realKeellsWithCommas = 'HNB SMS ALERT:INTERNET, Account:2080***2939,Location:KEELLS SUPER, COLOMBO 03, LK,Amount(Approx.):500.00 LKR,Av.Bal:100.00 LKR,Date:19.10.26,Time:10:00, Hot Line:0112462462';

const realInternetUberWrapped = `HNB SMS ALERT:INTERNET,
Account:2080***2939,Location:UBER,
LK,Amount(Approx.):670.59 LKR,Av.Bal:14621.99
LKR,Date:19.10.26,Time:17:06, Hot Line:0112462462`;

module.exports = {
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
};
