# SmartShop ব্যবহার করার সহজ গাইড

আপডেট: **৫ নভেম্বর ২০২৬**। শেষ সিদ্ধান্ত হলো সম্পূর্ণ বিনাখরচের **Mac local server + USB-তে নিজের Huawei P10 (Android 9)**। Cloud deployment ও billing-এর কাজ বাতিল করা হয়েছে। Emulator আর চালানো হবে না। Mac চালু থাকা অবস্থায় app ও browser কাজ করবে।

## ১. Mac-এ অ্যাপ চালাও

VS Code-এ `Mobile Apps` folder খোলো। **Terminal → New Terminal** থেকে দাও:

```bash
npm run dev:phone
```

তারপর [SmartShop খোলো](http://localhost:5173)। একই server আগে চললে দ্বিতীয়বার command দেবে না। `Port ... already in use` দেখালে চলতি server ব্যবহার করো। বন্ধ করতে ওই Terminal-এ **Control+C** চাপবে।

## ২. Huawei ফোনে USB debugging চালু করো

1. ফোনে **Settings → System → About phone** খোলো।
2. **Build number**-এ ৭ বার চাপো; PIN চাইলে ফোনেই নিজের PIN দাও।
3. **System → Developer options**-এ ফিরে **USB debugging** চালু করো।
4. Data cable দিয়ে Mac-এ লাগিয়ে ফোন unlock রাখো। USB mode-এ **File transfer** বেছে নাও। শুধু charge হওয়া মানেই data connection প্রস্তুত নয়।
5. ফোনে debugging request এলে নিজের Mac যাচাই করে **Allow** দাও।

EMUI 8/9-এর এই settings path এবং data connection যাচাই Huawei-এর [official নির্দেশনায়](https://consumer.huawei.com/mu/support/content/en-gb00698619/) আছে। Menu-এর নাম ভাষা/version অনুযায়ী সামান্য বদলাতে পারে।

## ৩. Cable দিয়ে install ও চালাও

Mac-এর server-এর Terminal চালু রাখো। আরেকটি project Terminal-এ দাও:

```bash
npm run android:usb
```

এটি physical phone খুঁজে APK তৈরি করবে, USB connection দিয়ে Mac API যুক্ত করবে, `output/SmartShop-USB.apk` install করে SmartShop খুলবে। Emulator ব্যবহার করবে না। `unauthorized` দেখালে ফোন unlock করে অনুমতির prompt শেষ করো। ফোন পাওয়া না গেলে data cable/USB port পরীক্ষা করো।

Cable যুক্ত থাকা ও USB reverse চালু থাকা অবস্থায় একই Wi-Fi দরকার নেই। Mac-এর server এবং cable চালু রাখবে। Cable খুললে বা device restart করলে connection reset হতে পারে; আবার cable লাগিয়ে command দাও। বর্তমান USB app API address হলো `http://127.0.0.1:3001`—এটি USB-এর মাধ্যমে Mac-এ যায়।

Cable ছাড়া ব্যবহার করতে চাইলে Mac ও ফোন একই Wi-Fi-তে রাখো। App-এর **Shop connection settings**-এ Mac-এর বর্তমান LAN address দিয়ে **Test connection → Save and reconnect** করো। বিস্তারিত [ফোনের গাইডে](docs/PHONE_INSTALL_BN.md)। Mac বন্ধ থাকলে shared data/login পাওয়া যাবে না।

## ৪. নিজের Owner account চালু করো

আগে নিজের email দিয়ে customer account তৈরি করে থাকলে সেই account-এ sign in করো। নতুন হলে **Sign in → Create an account** থেকে নিজের নাম, unique username, email, phone ও password দাও। Public registration-এ Customer হয়।

দোকানের প্রথম real Owner করার জন্য:

1. Mac-এর project Terminal-এ `npm run owner:code` চালাও।
2. অ্যাপের account icon চাপো। **Activate your shop owner** অংশে ওই private code লেখো।
3. **Activate as shop owner** চাপো। নিজের account, password ও history থাকবে; role হবে Owner।

Code chat-এ পাঠাবে না। এটি owner একবার চালু করে এবং sample accounts বন্ধ করে। Sample account-এর নাম বদলালেই নিজের real account হয় না। Password ও PIN নিজেই লিখবে।

## ৫. নিজের profile ও ছবি

Owner, Staff বা Customer—সবার account icon-এর **Your profile** অংশ থেকে নিজের নাম, mobile, address ও profile photo বদলানো যাবে। JPG, PNG বা WebP ছবি দাও; সর্বোচ্চ 5 MB। Owner-এর ছবি **Shop settings → Owner details** থেকেও দেওয়া যায়।

ছবি Mac-এর `.data/uploads` folder-এ থাকে, Firebase-এ যায় না। App server-এর media address দিয়ে সেটি দেখায়। Registered Customer-এর profile সংশ্লিষ্ট customer ledger contact-এর সঙ্গে যুক্ত থাকে; owner-এর Customers list-এ সেই contact/profile দেখা যায়।

## ৬. দোকানের তথ্য ও Staff access

Owner হিসেবে **Shop settings** খোলো। নিজের name/phone ও shop name, contact, address, opening hours বদলে সংশ্লিষ্ট **Save** চাপো। Exact map pin-এর জন্য latitude ও longitude দুটো দাও; দুটো ফাঁকা রাখলে address দিয়ে location খোঁজা হবে।

Staff করতে চাইলে আগে তাকে নিজের account তৈরি করতে বলো। **Shop settings → Staff access**-এ নাম, username বা email দিয়ে খুঁজে **Make staff** চাপো। **Remove staff access** দিলে আবার Customer হবে। Staff stock, sales, expenses ও customer balance-এর কাজ করতে পারে; shop/staff settings Owner-এর।

## ৭. Customer-এর বাকি ও নতুন bill

**Customers → Add customer** থেকে mobile, email ও address-সহ contact দাও। অ্যাপের আগের কোনো পাওনা থাকলে **Opening due**-তে দাও। এটি নতুন sale বা লাভ নয়। Contact edit করা এবং **View ledger** থেকে bills/payments দেখা যায়।

পরে টাকা আদায় হলে payment entry দাও। তা opening balance, তারপর সবচেয়ে পুরোনো unpaid bills কমায়। **New sale**-এ customer বেছে নিলে আগের due দেখায়। যেমন আগের due ৳100, নতুন bill ৳200, পাওয়া টাকা ৳250 হলে ৳100 পুরোনো due আদায় এবং ৳150 নতুন bill payment; নতুন বাকি ৳50। পুরোনো আদায় আবার sale/profit হয় না।

## ৮. আলাদা login, comments ও alert

এক window-এ Owner ও অন্য window-এ Customer একই সময়ে sign in করতে পারে। কারও login/logout অন্য account বদলাবে না। Refresh বা ওই tab restore করলে identity থাকবে; নতুন window অন্য window-এর Owner login নেবে না। Android নিজের session মনে রাখে।

Customer product-এর review/comment দিতে পারে; Owner ও অন্য Customer সেই discussion দেখতে পারে। Like/dislike count live বদলায়। Owner/Staff-এর bell-এ low-stock unread alert আসে। এটি app-এর ভেতরের alert; background phone push নয়।

## ৯. Firebase email ও তথ্যের অবস্থান

Firebase-এর Email/Password verification service যুক্ত আছে। নিজের account থেকে verification identity connect করে **Send verification email** দাও। Inbox-এর link খোলার পরে **Check verification** চাপো। এই কাজের যাচাইয়ে real inbox verification এখনো সম্পন্ন বলে নথিবদ্ধ হয়নি। SMS বন্ধ আছে।

সব username/password, role, customer ও হিসাব local SQLite-এ থাকে; password আসল লেখায় রাখা হয় না। Firebase Console-এর Authentication users-এ শুধু connected verification identities থাকবে। Firestore-এ shop data বা Storage-এ ছবি পাঠানো হয়নি। [বিস্তারিত data guide](docs/DATA_LOCATIONS_BN.md) পড়ো।

## ১০. সমস্যা হলে

```bash
npm run typecheck
npm test
npm run build
```

Final profile/USB পরিবর্তনের আগের full run-এ **৫৩টি পরীক্ষা পাস** করেছে; শেষ যাচাই status-এ থাকবে। Error বুঝতে না পারলে text দেখাও। `.data`, uploads বা private backups মুছবে না। ক্লাসের জন্য [demo checklist](docs/CLASS_DEMO_BN.md) পড়ো।
