# SmartShop — Android app requirements and development plan

Updated: 3 November 2026

## 1. ব্যবহারকারীর নিশ্চিত করা সিদ্ধান্ত

- নাম: **SmartShop**।
- Platform: **Android**।
- একটি নির্দিষ্ট দোকানের জন্য অ্যাপ।
- দোকানের purchase, sales, products/stock ও customer details রাখা হবে।
- Smart dashboard-এ today's sales, profit, expenses ও low-stock alerts থাকবে।
- Customer-ও অ্যাপ install করে দোকানের available products দেখতে পারবেন।
- Customer পণ্যে review দিতে এবং দোকানের location দেখতে পারবেন।

এই সিদ্ধান্তগুলো ব্যবহারকারীর কথা থেকে নেওয়া। নিচের বিস্তারিত workflow মূল design plan। প্রথম local development milestone এখন code-এ তৈরি হয়েছে; কোন feature চালু আর কোনটি বাকি, তার জন্য [implementation status](IMPLEMENTATION_STATUS.md) দেখো।

## 2. প্রস্তাবিত ব্যবহারকারী ও screen structure

### Customer

- Home: দোকানের পরিচিতি, category ও product search।
- Catalog: paginated product list; category, price ও availability filter।
- Product details: ছবি, description, unit, selling price ও availability।
- Reviews: star rating, লিখিত review, review-এর নিচে real-time comments এবং like/dislike count।
- Shop: address, contact, opening hours, map ও directions।
- Profile: registration, email ও phone verification, username check, login/logout।
- Help: externally hosted tutorial audio/video।

প্রস্তাব: catalog ও shop details sign-in ছাড়াই দেখা যাবে; review/comment/reaction দেওয়ার জন্য verified account লাগবে। Customer-কে exact stock quantity দেখানো হবে কি না, সেটি পরে নির্ধারণ করা যাবে; প্রাথমিক UI-তে availability দেখানো হবে।

### Owner

- Dashboard: sales, gross profit, expenses, net profit, cash collected, dues ও low stock।
- Products: category, unit, ছবি, SKU/barcode, pricing ও reorder threshold।
- Purchases: supplier, line items, cost, paid amount ও payable balance।
- Sales/POS: line items, discount, payment, customer ও invoice।
- Customers: contact, purchase history, dues ও receipts।
- Suppliers: contact, purchase history, outstanding balance ও payments।
- Stock/returns: sale return, purchase return এবং কারণ-সহ stock adjustment।
- Expenses, date-filtered reports, shop settings ও staff permissions।
- AI assistant ও on-device prediction-এর আলাদা feature।

### Staff — প্রস্তাবিত role

Owner অনুমতি দেবেন। Sales/purchase/stock-এর কোন কাজ করতে পারবেন তা permission দিয়ে নিয়ন্ত্রিত হবে। Public registration দিয়ে owner বা staff role পাওয়া যাবে না।

## 3. হিসাব ও stock-এর নিয়ম

- Draft sale/purchase stock বদলাবে না। Confirmed purchase stock বাড়াবে; confirmed sale stock কমাবে।
- একই transaction retry হলে duplicate sale, payment বা stock movement হবে না।
- Sale ও purchase confirmation database transaction-এ হবে; একই পণ্য একাধিক staff বিক্রি করলে stock consistency বজায় থাকবে।
- প্রস্তাব: confirmation-এর সময় negative stock প্রতিরোধ করা হবে।
- প্রতিটি confirmed stock change-এর জন্য auditযোগ্য stock movement থাকবে।
- Customer payment আলাদা record: পরে বাকি আদায় হলে নতুন sale তৈরি হবে না। Supplier payment-ও একইভাবে আলাদা।
- Return মূল sale/purchase-এর সঙ্গে যুক্ত থাকবে; ফেরতের quantity অবশিষ্ট returnable quantity ছাড়াবে না। Stock, revenue/cost, dues ও refund সঠিকভাবে সমন্বয় হবে।
- Money database-এ exact decimal অথবা integer minor unit হিসেবে সংরক্ষণ করতে হবে; binary floating-point দিয়ে ledger হিসাব নয়।
- একাধিক unit-এর পণ্য সমর্থনের জন্য quantity-তে প্রয়োজনমতো decimal precision থাকবে। Unit conversion আলাদা সিদ্ধান্ত।
- প্রস্তাবিত costing: weighted-average purchase cost; sale line-এ বিক্রির সময়কার cost snapshot থাকবে। পরে purchase cost বদলালেও পুরোনো sale-এর profit বদলাবে না।
- Gross profit = net sales revenue minus cost of goods sold, returns সমন্বয় করে। Net profit = gross profit minus period expenses।
- Purchase payment-কে expense ধরে আবার পুরোটা profit থেকে বাদ দেওয়া যাবে না; cash flow, sales ও profit পৃথক হিসাব।
- Low stock: available quantity নির্ধারিত reorder threshold-এর সমান বা কম হলে owner/staff alert পাবেন।
- Today's metrics দোকানের configured timezone ধরে হিসাব হবে; প্রাথমিক প্রস্তাব Asia/Dhaka। Currency ও shop identity settings-এ থাকবে।

## 4. তথ্যের দৃশ্যমানতা ও live updates

- Customer শুধু public product fields, review এবং shop profile দেখতে পারবেন।
- Purchase cost, profit, expenses, supplier balances এবং অন্য customer-এর personal data/dues server-side permission দিয়ে সুরক্ষিত থাকবে।
- Sales/purchase commit হওয়ার পর catalog availability ও dashboard-এর অনুমোদিত live data আপডেট হবে।
- Username-এর live availability check-এর পাশাপাশি database-level uniqueness বাধ্যতামূলক।
- Review, comment ও reaction database-এ স্থায়ীভাবে সংরক্ষিত হবে এবং অন্য signed-in device-এ reload ছাড়া দেখা যাবে।
- একজন user একটি target-এ একই সময়ে একটি reaction রাখতে পারবেন: like, dislike অথবা none। Like বদলে dislike করলে count সঠিকভাবে সমন্বয় হবে।
- প্রস্তাব: প্রতি customer প্রতি product-এ একটি editable rating/review; purchased-only review লাগবে কি না, পরে ঠিক হবে।
- API keys, SMS provider secrets ও LLM credentials APK-তে রাখা যাবে না।

## 5. PDF requirement coverage plan

Source: [Mobile Apps Requrement.pdf](../Mobile%20Apps%20Requrement.pdf)। PDF-এর instruction শিক্ষার্থীর project requirement হিসেবে নথিবদ্ধ; কোনো form submission করা হয়নি।

নিচের table হলো requirement coverage design। Feature-এর বর্তমান বাস্তব অবস্থা [implementation status](IMPLEMENTATION_STATUS.md)-এ আলাদা করে রাখা হয়েছে। এই design checklist-কে সম্পূর্ণ বাস্তবায়নের দাবি হিসেবে পড়া যাবে না।

| PDF # | Requirement | SmartShop-এ প্রস্তাবিত implementation |
| --- | --- | --- |
| 1 | ERD in scalable PDF | Relational schema থেকে vector ERD export; entity relationships ও keys দেখানো। |
| 2 | Real-time database-backed comments | Product review-এর নিচে comments; database persistence ও server-pushed updates। |
| 3 | Live like/dislike counts | Review/comment reactions; per-user unique reaction ও live aggregate counts। |
| 4 | Real-time unique username verification | Debounced server check এবং database unique constraint; page reload ছাড়া feedback। |
| 5 | Email and phone verification | দুটোর জন্য actual verification flow; provider setup ও device test লাগবে। |
| 6 | Multiple textboxes and dropdowns | Product, customer, purchase ও sale forms-এ dependent fields ও validation। |
| 7 | Real-time rating | Product star ratings ও live average/count। |
| 8 | Pagination | Catalog, reviews এবং transaction history-তে pagination। |
| 9 | External audio/video | External tutorial source থেকে embedded playback; actual source/config দরকার। |
| 10 | Google Maps/location | Shop map, customer location permission-সহ directions; embedded map minimum requirement মেনে রাখা। |
| 11 | Session/JWT login/logout | Backend-validated session/JWT, protected endpoints, logout এবং role checks। |
| 12 | On-device real-time ML | Android LiteRT/TFLite model inference; candidate feature sales-demand prediction। Dataset/model ও validation লাগবে; simple threshold alert বা LLM call এই requirement পূরণ করবে না। |
| 13 | Cloud-backed image/file upload | Product images ও purchase receipts upload/display; real cloud storage, access policy ও validation। |
| 14 | Datepicker | Purchase, expense, payment এবং report date filters। |
| 15 | GSAP or Framer Motion | React UI-তে specified library দিয়ে animation। |
| 16 | SASS or Tailwind CSS | Tailwind দিয়ে mobile layout ও styling। |
| 17 | Modern workflow tools | Git এবং Vite-based build workflow। |
| 18 | GraphQL or modern API layer | Catalog/dashboard read queries-এর জন্য GraphQL; backend permissions একই থাকবে। |
| 19 | RESTful/SOAP APIs | Sales, purchases, uploads ও auth-এর জন্য RESTful endpoints। |
| 20 | Crystal Report | Actual Crystal Reports template ও supported reporting runtime থেকে report generation; ordinary PDF export দিয়ে এই শর্ত পূরণ হয়েছে বলা যাবে না। |
| 21 | Modern frontend framework | React। |
| 22 | Containerization/deployment pipeline | Build/test workflow via GitHub Actions; actual workflow execution evidence দরকার। |
| 23 | Generative AI | Server-mediated LLM assistant; role অনুযায়ী shop data নিয়ে উত্তর, financial records পরিবর্তনের স্বয়ংক্রিয় অনুমতি নয়। |
| 24 | Additional task-specific features | TBD; ম্যামের পরবর্তী নির্দেশ পেলে এই plan আপডেট করতে হবে। |

PDF-তে topic form-এর deadline 09/09/26 লেখা। এটি app submission deadline হিসেবে ধরা হয়নি। Topic approval বা updated course deadline এই chat-এ নিশ্চিত হয়নি।

## 6. প্রস্তাবিত technology direction

Android target ধরে প্রাথমিক প্রস্তাব:

- **App UI:** React + TypeScript + Vite, Tailwind CSS, GSAP অথবা Framer Motion।
- **Android packaging:** Capacitor, Android Studio project ও installable APK। এটি Android WebView-তে React UI চালাবে এবং প্রয়োজনমতো native Android plugin ব্যবহার করবে।
- **Backend:** প্রথম milestone-এ Node.js 24 + TypeScript + Express, local SQLite relational database, permission-checked REST endpoints এবং SSE real-time event channel। GraphQL পরবর্তী integration।
- **On-device ML:** Android native plugin দিয়ে LiteRT/TFLite inference; trained model ও input/output contract ঠিক করার পর integration।
- **Uploads, email/SMS, maps ও LLM:** নির্বাচিত provider-এর actual service integration; accounts/configuration প্রয়োজন।
- **Reporting:** Crystal Reports-compatible reporting service; supported runtime, license এবং Windows environment আলাদা করে যাচাই করতে হবে।

প্রথম milestone-এ React/Capacitor, Tailwind ও Framer Motion ব্যবহার করা হচ্ছে। React/Capacitor বাছার কারণ হলো Android target-এর পাশাপাশি PDF-এর সরাসরি web-library requirements রাখা। External-service selections ও reporting runtime এখনো চূড়ান্ত নয়।

Verified references:

- [Capacitor overview](https://capacitorjs.com/docs)
- [Capacitor native plugins](https://capacitorjs.com/docs/plugins)
- [TensorFlow Lite inference overview](https://github.com/tensorflow/tensorflow/blob/master/tensorflow/lite/g3doc/guide/inference.md)
- [SAP Crystal Reports for Visual Studio supported platforms](https://www.sap.com/documents/2016/06/f871031e-757c-0010-82c7-eda71af511fa.html)

## 7. Development milestones ও যাচাই

1. **Design and schema:** screen flow, database schema, permission matrix ও scalable ERD।
2. **Core accounting:** products, purchases, sales, stock ledger, customers/suppliers, payments, expenses, returns ও dashboard। Sale/payment retry, concurrent sale, partial payment, returns এবং cost calculation যাচাই।
3. **Customer experience:** catalog, detail, reviews, rating, comment/reaction, location ও verification। দুই device-এ real-time update এবং role/privacy checks।
4. **Course integrations:** uploads, tutorials, GraphQL/REST, on-device ML, generative AI, Crystal Report এবং CI pipeline। Actual service/model execution verify করতে হবে।
5. **Android delivery:** clean Android build, emulator/physical-device test, APK installation এবং end-to-end demonstration।

Demo/sample data ব্যবহার করলে তা চিহ্নিত থাকবে। Mock OTP, simulated prediction, sample report বা static counters-কে working integration বলে দেখানো হবে না।

## 8. যেসব সিদ্ধান্ত বা input পরে প্রয়োজন

- দোকানের display name, logo, address, contact, coordinates ও opening hours।
- App-এর UI language এবং initial product categories/units।
- Staff permissions ও verified-purchase review policy।
- Backend/provider selection, service configuration এবং প্রযোজ্য usage costs।
- ML prediction-এর final feature, usable training data ও evaluation।
- Crystal Reports-এর supported runtime/license environment ও course demonstration arrangement।
- PDF #24-এর নতুন শর্ত এবং current submission deadline।

বর্তমানে app code, local backend ও Capacitor Android project তৈরি হয়েছে। Scalable ERD PDF, সম্পূর্ণ course integrations ও tested Android APK এখনো বাকি; সর্বশেষ setup/test অবস্থা implementation status-এ দেখো।
