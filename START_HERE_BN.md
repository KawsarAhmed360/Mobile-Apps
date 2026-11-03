# SmartShop শুরু করার সহজ গাইড

## তোমার Mac-এর বর্তমান setup

Node.js 24, project packages, Java 21, Android Studio, Android SDK এবং ARM64 emulator image install হয়েছে। VS Code-এ `Mobile Apps` folder খোলা হয়েছে। এই setup আবার শুরু থেকে করার প্রয়োজন নেই।

প্রতিদিনের কাজ শুরু করতে VS Code-এ **Terminal → New Terminal**, তারপর:

```bash
npm run dev
```

Chrome-এ [SmartShop খোলো](http://localhost:5173)। Server আগে থেকেই চললে একই command দ্বিতীয়বার দেবে না; `Port 5173 is already in use` হলে চলতি server ব্যবহার করো।

Android emulator-এ app update করার সময় আরেকটি Terminal-এ:

```bash
npm run android:sync:emulator
npm run android:build
```

এতে Android development APK তৈরি হবে: `android/app/build/outputs/apk/debug/app-debug.apk`। VS Code-এ code বদলালে চালু emulator-এর preview-ও Vite দিয়ে update হবে। এই preview Mac-এর local server ব্যবহার করে; এটি Play Store-এ দেওয়ার production APK নয়।

এই Mac-এ তৈরি virtual device-এর নাম **Medium Phone API 37.0**, ARM64। API 37 image-টি ভারী; প্রথম cold boot-এ কয়েক মিনিট লাগতে পারে। একসঙ্গে একটি emulator ব্যবহার করো। Performance প্রয়োজনমতো পরে হালকা stable image দিয়ে সামঞ্জস্য করা যাবে।

নিচের অংশগুলো নতুন করে setup করা বা কোনো সমস্যা হলে reference হিসেবে ব্যবহার করবে।

এই project একটি দোকানের Android app তৈরির কাজ। তুমি VS Code-এ কাজ করবে। শুরুতে Mac-এর browser-এ app চালিয়ে দেখব; Android-এ চালানোর জন্য পরে Android Studio ও SDK ব্যবহার করব।

প্রথম সংস্করণে sample দোকানের তথ্য থাকবে। এটি শেখা ও পরীক্ষা করার development version। সব course requirement-এর অবস্থা [পরিকল্পনায়](docs/SMARTSHOP_REQUIREMENTS.md) দেওয়া আছে।

## ১. VS Code-এ project খোলো

1. **Visual Studio Code** খোলো।
2. উপরের menu থেকে **File → Open Folder…** চাপো।
3. এই `Mobile Apps` folder নির্বাচন করো:

   ```text
   /Users/kawsarahmed/Documents/CSE pdf Book /5. Fifth Semester/CSE 510 (SM) Mobile App Lab/Mobile Apps
   ```

4. Project-এর নিজের files যাচাই করে VS Code trust চাইলে সিদ্ধান্ত নাও।
5. **Terminal → New Terminal** চাপো। নিচে লেখার জায়গা খুলবে। পরের command-গুলো সেখানেই লিখবে।

Project-এর `.vscode/settings.json` নতুন VS Code Terminal-এ Homebrew-এর Node 24-এর path যোগ করে। Setup চলার আগে Terminal খোলা থাকলে পুরোনো Terminal বন্ধ করে নতুনটি খোলো।

## ২. Node.js পাওয়া যাচ্ছে কি না দেখো

```bash
node --version
npm --version
```

Node-এর version `v24…` হওয়া দরকার। `command not found` দেখালে এবং Homebrew দিয়ে Node 24 install করা থাকলে একই Terminal-এ এটি দাও:

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
```

তারপর আবার version-এর command দাও। এই পরিবর্তন শুধু বর্তমান Terminal-এর জন্য; নতুন Terminal খুললে আবার দিতে হতে পারে।

Node install করা না থাকলে official [Node.js download](https://nodejs.org/en/download) থেকে Node 24 LTS-এর macOS Apple Silicon/ARM64 installer ব্যবহার করা যায়। এই project-এর setup-এ Node install করা হয়ে থাকলে আবার install করতে হবে না।

## ৩. Project-এর প্রয়োজনীয় packages বসাও

Project-এর Terminal-এ দাও:

```bash
npm install
```

প্রথমবার internet লাগবে। কাজ শেষ হলে আবার লেখার prompt ফিরে আসবে। Packages আগে install করা থাকলে এই ধাপ পুনরায় করার প্রয়োজন নেই, যদি না dependency বদলায়।

## ৪. App চালাও

```bash
npm run dev
```

Terminal চালু রাখো। Chrome-এ খোলো:

[http://localhost:5173](http://localhost:5173)

না খুললে [http://127.0.0.1:5173](http://127.0.0.1:5173) চেষ্টা করো।

এই একটি command app-এর interface এবং তথ্য রাখার local server দুটোই চালায়। বন্ধ করতে Terminal-এ **Control + C** চাপবে। পরে আবার `npm run dev` দিলে চালু হবে।

আরেকটি সহজ উপায়: Finder-এ project folder খুলে **Start SmartShop.command**-এ double-click করো। এটি প্রয়োজন হলে packages install করে server চালাবে। তারপর নিজে Chrome-এ উপরের address খোলো; script browser নিজে খুলবে না। একই সময়ে দুইভাবে server চালানোর প্রয়োজন নেই।

## ৫. Sample account দিয়ে দেখো

Local development-এ এই accounts ব্যবহার করা হবে:

| Account | Email | Password |
| --- | --- | --- |
| Owner | `owner@smartshop.local` | `SmartShop@123` |
| Customer | `customer@smartshop.local` | `Customer@123` |

এগুলো শুধু sample project-এর account। নিজের আসল password এখানে ব্যবহার করবে না।

- Customer হিসেবে product catalog ও shop-এর তথ্য দেখো।
- Owner হিসেবে dashboard, stock ও হিসাবের অংশ দেখো।
- একটি product কেনার entry করে stock বাড়ছে কি না দেখো।
- Sale করে stock ও dashboard বদলাচ্ছে কি না দেখো।
- Customer দিয়ে product review দাও।

প্রথম সংস্করণের login token শুধু app-এর চলতি memory-তে থাকে। Browser refresh করলে আবার login করতে হতে পারে। কিন্তু server-এর `.data` folder-এর database-এ save হওয়া হিসাব থেকে যায়। `.data` folder মুছে দিলে local তথ্য হারাবে।

## ৬. Setup ও build পরীক্ষা

```bash
npm run doctor
```

এতে কোন সফটওয়্যার আছে এবং কোনটি লাগবে দেখা যাবে। Android Studio/SDK এখনো না থাকলেও browser-এ development শুরু করা যাবে।

Project check-এর commands:

```bash
npm run typecheck
npm test
npm run build
```

কোনো error হলে error-এর সম্পূর্ণ text পাঠাবে। Error না বুঝে project-এর file বা database মুছবে না।

## ৭. Mac-এর ভেতরে Android Emulator তৈরি করো

Android app build করতে [Android Studio](https://developer.android.com/studio) এবং Android SDK লাগবে। Code লেখা VS Code-এই চলবে। এই project-এ **Java 21** ব্যবহার করা হয়েছে: বর্তমান Android Studio-র bundled Java 25 দিয়ে Gradle 8-এর build চলে না। `npm run android:build` এই Mac-এর সঠিক Java বেছে নেয়। [Android-এর Java configuration নির্দেশনা](https://developer.android.com/build/jdks)

তোমার নির্বাচিত পথ হলো Mac-এ emulator: কম্পিউটারের screen-এ একটি virtual Android phone খুলবে। এখন একটি device ও একটি system image দিয়েই শুরু করব।

1. Mac-এর **Apple Silicon** version-এর Android Studio install শেষ হলে খোলো। আগে install হয়ে থাকলে আবার install কোরো না।
2. প্রথমবার SDK setup wizard দেখাবে। Download list ও প্রতিটি license পড়ে নিজের সিদ্ধান্ত দেবে।
3. SDK Platform, Platform Tools, Build Tools এবং **Android Emulator** component লাগবে। Project-এর build-এর জন্য Android API 36 SDK ব্যবহার করা হবে।
4. Welcome screen-এ **More Actions → Virtual Device Manager** খোলো। Project খোলা থাকলে **View → Tool Windows → Device Manager** থেকে খোলা যায়।
5. **Create Device / +** চাপো। Phone-এর তালিকা থেকে মাঝারি screen-এর Pixel profile নির্বাচন করো, যেমন Pixel 6a পাওয়া গেলে সেটি। **Next** চাপো।
6. Stable **API 36 / Android 16** system image নির্বাচন করো। **ABI / Architecture-এ `arm64-v8a` বা ARM64** আছে কি না নিশ্চিত হও; Mac M1-এর জন্য x86_64 image বেছো না। Image download না থাকলে download icon চাপো এবং শর্ত পড়ে সিদ্ধান্ত দাও।
7. Device-এর নাম দিতে পারো `SmartShop_Pixel_API36`। Graphics প্রথমে **Automatic** রাখো; অন্য advanced setting শুরুতে বদলানোর দরকার নেই। **Finish** চাপো।
8. Device Manager-এ device-এর পাশের **▶ / Launch** চাপো। প্রথমবার Android চালু হতে কিছু সময় লাগবে। Android-এর home screen দেখা গেলে emulator প্রস্তুত।

[Google-এর virtual device নির্দেশনা](https://developer.android.com/studio/run/managing-avds)। Android Studio-র version অনুযায়ী button-এর নাম সামান্য বদলাতে পারে।

## ৮. Emulator-এ SmartShop চালাও

প্রথম VS Code Terminal-এ server চালু রাখো:

```bash
npm run dev
```

দ্বিতীয় Terminal-এ দাও:

```bash
CAPACITOR_DEV_SERVER_URL=http://10.0.2.2:5173 npm run android:sync
npm run android:open
```

`android` folder এখনো তৈরি না হয়ে থাকলে, একবার `npm run build` এবং `npx cap add android` দিয়ে project তৈরি করতে হবে। তারপর উপরের sync/open commands ব্যবহার করবে।

Android Studio project খুলে Gradle sync শেষ হতে দাও। উপরের device selector-এ তোমার `SmartShop_Pixel_API36` emulator নির্বাচন করে **Run ▶** চাপো। App install ও চালু হওয়া পর্যন্ত অপেক্ষা করো। এটি device test করার ধাপ; এই গাইড নিজে APK পরীক্ষায় pass হওয়ার প্রমাণ নয়।

Emulator-এর Chrome-এ `http://10.0.2.2:5173` খুলেও আগে server-এর connection পরীক্ষা করা যাবে। Emulator-এ `localhost` নিজের virtual phone-কে বোঝায়; `10.0.2.2` দিয়ে Mac-এর local server পাওয়া যায়। [Google-এর networking নির্দেশনা](https://developer.android.com/studio/run/emulator-networking-address)

Server চালু থাকলে React-এর code save করার পর live preview-তে পরিবর্তন দেখা যাবে। Android configuration/native code বদলালে sync ও Run আবার করতে হবে।

Terminal থেকে Java পাওয়া না গেলে Android Studio install থাকার পর বর্তমান Terminal-এর জন্য:

```bash
export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
```

এই emulator setup development-এর জন্য HTTP ব্যবহার করে। Customer-এর release build-এর আগে চলতি Terminal-এ `CAPACITOR_DEV_SERVER_URL` set করা থাকলে `unset CAPACITOR_DEV_SERVER_URL` দেবে, production HTTPS backend configure করবে, তারপর আবার `npm run android:sync` করবে। শুধু emulator-এর development APK customer-কে দেওয়া যাবে না।

## ৯. চাইলে পরে নিজের Android ফোনে পরীক্ষা

এটি local পরীক্ষা। Mac ও ফোন একই Wi-Fi-তে থাকবে এবং Mac-এর server চালু থাকবে। এই server-এ sample data ব্যবহার করবে।

প্রথম Terminal-এ:

```bash
npm run dev:phone
```

Terminal-এর **Network** address অথবা Mac-এর **System Settings → Wi-Fi → Details → TCP/IP** থেকে Mac-এর local IP খুঁজে নাও। যেমন `192.168.1.10`। তোমার IP আলাদা হবে।

ফোনের browser-এ `http://তোমার-Mac-এর-IP:5173` খোলো। উদাহরণ: `http://192.168.1.10:5173`।

Android project-এর ভেতরে একই live preview চালাতে, অন্য Terminal-এ প্রকৃত IP বসিয়ে:

```bash
CAPACITOR_DEV_SERVER_URL=http://192.168.1.10:5173 npm run android:sync
npm run android:open
```

এখানে `192.168.1.10` উদাহরণ; নিজের Mac-এর IP বসাবে। এই setting-এর APK Mac-এর development server-এর ওপর নির্ভর করবে। Release build করার আগে এই setting বাদ দিয়ে production backend যুক্ত করতে হবে।

USB দিয়ে Android Studio থেকে physical phone-এ চালাতে হলে ফোনে Developer options ও USB debugging চালু করতে হবে। ফোনটি Mac-এ লাগিয়ে নিজের Mac-এর debugging request চিনে অনুমতি দেবে; এরপর Android Studio-র device selector থেকে ফোনটি নির্বাচন করা যাবে।

## ১০. App ও server-এর সম্পর্ক

APK install হলেই database internet-এ চলে যায় না। Mac বন্ধ করলে local server-ও বন্ধ থাকবে। Customer-এর নিজের ফোনে যেকোনো জায়গা থেকে app ব্যবহারের জন্য server/database deploy করতে হবে এবং app-এ সেই server-এর HTTPS address দিতে হবে। `.env.example`-এ `VITE_API_URL`-এর নমুনা আছে।

প্রথম milestone-এ email/phone-এর আসল verification, cloud uploads, GraphQL, on-device ML, generative AI, Crystal Reports, সম্পূর্ণ supplier/returns/payment ledger এবং production deployment-এর আলাদা কাজ বাকি থাকবে। এগুলো শেষ ও পরীক্ষা না হওয়া পর্যন্ত working feature হিসেবে জমা দেওয়া যাবে না।

দোকানের আসল নাম, logo, address, map location, contact ও products পরে তোমার তথ্য দিয়ে বসাতে হবে। Sample shop-এর তথ্যকে আসল দোকানের তথ্য ধরে ব্যবহার করবে না।
