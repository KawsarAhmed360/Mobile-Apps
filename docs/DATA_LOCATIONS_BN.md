# SmartShop-এর কোন তথ্য কোথায় থাকে

আপডেট: **৫ নভেম্বর ২০২৬**। শেষ সিদ্ধান্ত অনুযায়ী SmartShop সম্পূর্ণ বিনাখরচের **local Mac server** ব্যবহার করছে। Cloud deployment, billing ও data migration বাতিল হয়েছে। Firebase project যুক্ত থাকলেও সব app data Firebase-এ নেই।

## Account, password ও হিসাব

| তথ্য | প্রকৃত জায়গা | কী থাকে |
| --- | --- | --- |
| Owner, Staff ও Customer login | Mac-এর `.data/smartshop.sqlite`, `users` table | Name, username, email, mobile, address, role, verification status ও photo link। একই table-এ role দিয়ে তিন ধরনের account আলাদা। |
| SmartShop password | `users.password_hash` | Salt ও scrypt hash। আসল লেখা password রাখা হয় না; আগের password database দেখে পড়া যায় না। |
| Staff/Owner permission | `users.role` | Owner পরিবর্তন করেন; protected request-এ server বর্তমান role যাচাই করে। |
| Saved login | নিজের browser window/ফোনের app storage এবং SQL `user_sessions` | Device credential এবং server-এ refresh-token hash/revocation। এক window অন্য account বেছে নেয় না। |
| Customer mobile/address/opening due | `customers` | Shop ledger contacts। Registered customer-কে `customers.user_id` দিয়ে তার login profile-এর সঙ্গে যুক্ত করা হয়; login ও ledger এক record নয়। |
| Products/stock/purchases/sales/expenses/dues | SQLite-এর সংশ্লিষ্ট tables | Integer paisa, stock movement, invoice ও payment allocation। |
| Reviews/comments/like-dislike | `reviews`, `product_comments`, `comment_reactions` | Shared product discussion; private contact ও financial তথ্য আলাদা অনুমতিতে থাকে। |
| Owner ও shop location/contact | `users` এবং `shop` | Shop-এর public profile customer দেখতে পায়। |
| Private local backups | `.data/backups` | Mac-এর database-এর সংরক্ষিত copy; cloud migration হয়নি। |

## যেকোনো ছবি upload করলে কোথায় যায়

বর্তমান provider **`local`**। Product এবং Owner/Staff/Customer-এর profile ছবি Mac-এর **`.data/uploads`** folder-এ file হিসেবে থাকে। Database-এর **`uploads`** table-এ uploader, filename/path, MIME type, size, purpose ও URL থাকে। App file দেখায় **`/api/media/<generated-id>`** address দিয়ে। Profile/product record সেই image-এর link ধরে রাখে।

এগুলো Firebase Storage বা অন্য cloud-এ পাঠানো হয় না। Mac বন্ধ থাকলে এই image server-ও পাওয়া যাবে না। Profile ছবি app-এ দেখানোর জন্য ব্যবহারকারী নিজে বেছে দেন; এটি private receipt/document vault নয়।

## Firebase Console-এ কী থাকবে

Project: **`smartshop-kawsar-20261104`**। [Firebase Console খোলো](https://console.firebase.google.com/project/smartshop-kawsar-20261104/overview)।

- **Project settings → Your apps**: Android/web app configuration এবং Android certificate fingerprints।
- **Authentication → Sign-in method**: Email/Password verification service configured।
- **Authentication → Users**: নতুন signup থেকে email verification শুরু করলে Firebase identity এখানে তৈরি হয়। পুরোনো SmartShop account নিজের verification identity connect করলে সেটিও এখানে দেখা যাবে।
- **Firestore Database**: এই কাজের মধ্যে shop account, customer, product, bill বা comment records migrate/create করা হয়নি।
- **Storage**: বর্তমান uploaded ছবিগুলো এখানে নেই; সেগুলো Mac-এ। Firebase Storage upload চালু করা হয়নি।

SmartShop-এর প্রধান login custom SQL/JWT system। Firebase Authentication নতুন signup-এর email identity ও verification status পরিচালনা করে। Signup-এ একই password ব্যবহার করা হয়। যাচাইয়ের পরে Firebase UID ও verified status Mac-এর account record-এর সঙ্গে যুক্ত হয়। পুরোনো account-এর login ও verification flow নিজের account থেকে পাওয়া যাবে। SMS বন্ধ।

## Phone ও browser কীভাবে একই তথ্য পায়

Mac-এর browser local API ব্যবহার করে। USB phone `adb reverse` দিয়ে ফোনের `127.0.0.1:3001` থেকে Mac-এর port 3001-এ যায়। Cable ও Mac server চালু থাকলে shared Wi-Fi লাগে না। Cable ছাড়া একই Wi-Fi-তে Mac-এর LAN API ব্যবহার করা যায়।

Mac বন্ধ হলে shared data, login ও image server বন্ধ থাকে—এই ব্যবহারই এখন চূড়ান্ত scope। কোনো permanent public API/site deploy হয়নি। ভবিষ্যতে আলাদা করে চাইলে cloud ব্যবস্থা বিবেচনা করা যাবে; এখন সেটি চলতি কাজ নয়।

## তথ্য সংরক্ষণ

`.data`, uploads ও backups মুছবে না। আসল password, OTP, owner activation code বা private key Git/chat/screenshot-এ দেবে না। App-এ Customer কেবল public catalog/shop/discussion দেখে; অন্য customer-এর address/dues, password hash ও owner profit server-side permission দিয়ে সুরক্ষিত থাকে।
