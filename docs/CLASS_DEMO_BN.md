# SmartShop ক্লাসে দেখানোর গাইড

আপডেট: **৫ নভেম্বর ২০২৬**। শেষ scope হলো বিনাখরচের local Mac server ও USB-তে Huawei P10। Cloud deployment/billing বাতিল হয়েছে। যতটুকু চলছে ও পরীক্ষা হয়েছে, সেটুকুই completed বলবে।

## Demo শুরু

Project Terminal-এ `npm run dev:phone` চালু রাখো। [Browser app খোলো](http://localhost:5173)। ফোনে USB debugging ও নিজের Mac-এর অনুমতি দিয়ে অন্য Terminal-এ `npm run android:usb` দাও। Mac server ও cable চালু থাকবে। USB reverse কাজ করলে shared Wi-Fi লাগে না। Emulator ব্যবহার করবে না।

দুটি আলাদা browser window-এ Owner ও Customer sign in করো। এক window অন্য account নেবে না। Refresh-এ ওই window-এর login থাকবে; নতুন window আলাদাভাবে sign in করবে। নিজের password নিজের হাতে লিখবে।

## ম্যামের ১২টি requirement

| বিষয় | কী দেখাবে | বর্তমান সীমা |
| --- | --- | --- |
| ERD | `docs/SmartShop_ERD.pdf` zoom করে PK/FK ও relationships দেখাও। | সর্বশেষ schema regeneration ব্যবহার করবে। |
| Git / workflow | VS Code Source Control history বা `git log --oneline`। | Hosted remote/CI run যাচাই হয়নি। |
| Frontend framework | React interface, `src/App.tsx` ও `package.json`। | React/TypeScript, Tailwind ও Framer Motion। |
| REST API | `http://localhost:3001/api/health` এবং `/api/products`। | Local API; cloud URL নেই। |
| Textboxes/dropdowns | Profile, product, customer, checkout ও settings forms। | Server validation আছে। |
| Pagination | Catalog, comments ও Staff directory page controls। | সব history paginated নয়। |
| Session/JWT | একই সময়ে Owner/Customer দুই window, refresh ও Customer-only logout। | অন্য window-এর account বদলাবে না। |
| Username | Registration-এ taken/available username feedback। | Database uniqueness-ও duplicate রোধ করে। |
| Email + phone | Account verification screen ও Firebase Authentication setup। | Email service configured; real inbox proof নেই। SMS বন্ধ। সম্পূর্ণ নয়। |
| Cloud upload | Product/profile photo upload ও পুনরায় display। | Files Mac-এর local disk-এ; cloud-storage requirement পূরণ হয়নি। |
| Live comments | একই product-এ Customer comment; Owner/অন্য Customer তা দেখতে পাবে। | Private হিসাব/contact public নয়। |
| Like/dislike | Reaction বদলে অন্য window-এর live count দেখাও। | প্রতি account এক সময়ে একটি reaction। |

## ব্যবসা ও profile দেখানো

1. **Shop settings** থেকে owner তথ্য ও shop contact/address/map দেখাও। **Staff access** থেকে অনুমোদিত real account-কে Staff করা/সরানো দেখানো যায়।
2. Owner, Staff ও Customer-এর **Your account → Your profile** থেকে নিজের name, mobile, address ও photo দেখাও। Owner photo Shop settings-এও আছে। Customer profile তার ledger contact-এর সঙ্গে যুক্ত থাকে।
3. **Customers**-এ mobile/address, opening due ও **View ledger** দেখাও। Opening due নতুন sale নয়। আদায় করলে cash বাড়ে, sales/profit বাড়ে না।
4. **New sale**-এ customer বেছে previous due দেখাও। Amount received আগে পুরোনো due, পরে নতুন bill মেটায়। Demo sale save করলে আসল local database-এ record হবে; বাস্তব হিসাবের মধ্যে ইচ্ছেমতো sample sale দেবে না।
5. Dashboard-এ sales, profit, expenses, cash ও dues আলাদা দেখাও। Low-stock bell-এর unread/read দেখাও। এটি in-app alert, background push নয়।

## ফোন ও data-এর সত্যিকারের অবস্থান

`npm run android:usb` physical phone-এ install করে; emulator বাদ দেয়। Device পাওয়া ও অনুমতি শেষ হওয়ার আগে physical installation সফল দাবি করবে না। Cable খোলার পরে USB reverse হারালে আবার যুক্ত/চালু করতে হবে। Cable ছাড়া একই Wi-Fi ও Mac LAN API লাগবে। Mac বন্ধ হলে বর্তমান shared data/login চলবে না।

ছবি `.data/uploads`-এ, account ও হিসাব `.data/smartshop.sqlite`-এ। Firebase শুধু contact-verification identity-এর জন্য যুক্ত। Firestore-এ shop data বা Firebase Storage-এ ছবি পাঠানো হয়নি। Cloud/billing কাজ বাতিল—এটিকে চলতি deployment বলে দেখাবে না।

## প্রমাণের files

- [ERD PDF](SmartShop_ERD.pdf), [SVG](SmartShop_ERD.svg), [schema notes](ERD.md)
- [Implementation status](IMPLEMENTATION_STATUS.md)
- [Data locations](DATA_LOCATIONS_BN.md)
- [USB phone guide](PHONE_INSTALL_BN.md)
- [সহজ ব্যবহার](../START_HERE_BN.md)

শেষ যাচাই: **৫৮টি পরীক্ষা, ৭টি suite, সব পাস**। TypeScript, Android build, USB install ও activity launch সফল। Huawei P10-এ Products screen দেখা যাওয়াও ব্যবহারকারী নিশ্চিত করেছেন। আলাদা পরীক্ষার browser window-এ Customer photo upload/save এবং Owner login-এর পরেও Customer-এর account বজায় থাকা যাচাই করা হয়েছে।
