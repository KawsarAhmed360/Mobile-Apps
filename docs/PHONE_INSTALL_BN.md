# Huawei P10-এ USB দিয়ে SmartShop চালানো

শেষ সিদ্ধান্ত: নিজের **Huawei P10, Android 9**, data cable ও Mac-এর local server ব্যবহার হবে। Emulator এবং paid cloud deployment ব্যবহার করা হচ্ছে না। App-এর interface APK-তে থাকবে; shared data ও ছবির জন্য Mac চালু থাকবে।

## ১. ফোন প্রস্তুত করো

1. **Settings → System → About phone → Build number**-এ ৭ বার চাপো। PIN চাইলে নিজের ফোনেই দাও।
2. **System → Developer options → USB debugging** চালু করো।
3. Data cable দিয়ে Mac-এ যুক্ত করে ফোন unlock রাখো। USB mode হিসেবে **File transfer** বেছে নাও।
4. ফোনে USB debugging prompt এলে নিজের Mac যাচাই করে **Allow** দাও।

EMUI 8/9-এর menu path ও data connection যাচাইয়ের জন্য [Huawei-এর official guide](https://consumer.huawei.com/mu/support/content/en-gb00698619/) ব্যবহার করা হয়েছে। শুধু charge হওয়া data connection-এর প্রমাণ নয়। Data cable ও কাজ করা USB port লাগবে।

## ২. Mac-এর server চালাও

VS Code-এ project-এর `Mobile Apps` folder থেকে Terminal-এ:

```bash
npm run dev
```

এই Terminal চালু রাখো। আগে server চললে একই command দ্বিতীয়বার দেবে না। Browser-এ [SmartShop](http://localhost:5173) খোলা যায়।

## ৩. Terminal-এর QR দিয়ে সর্বশেষ APK নাও

Server চালু হওয়ার পর **SmartShop latest APK** লেখার নিচে QR আসা পর্যন্ত অপেক্ষা করো। প্রতিবার server চালুর সময় নতুন APK build হয়। QR ছবি `output/SmartShop-Latest-QR.png` এবং download address `output/latest-phone-connection.txt`-এ পাওয়া যাবে।

- অনুমতিপ্রাপ্ত Android ফোন cable-এ থাকলে QR-এর address USB দিয়ে কাজ করবে। Cable যুক্ত রাখো।
- USB ফোন পাওয়া না গেলে একই Wi‑Fi-তে থাকা Mac ও ফোনের জন্য local network address ব্যবহার হবে।
- ফোনে QR scan করে `SmartShop-Latest.apk` download ও install করো। আগে অন্য server address সেভ করা থাকলে **Shop connection settings**-এ Terminal-এ দেখানো API address দাও।
- QR build ব্যর্থ হলে Terminal-এর error দেখো। `/downloads/latest.apk` নতুন build প্রস্তুত হওয়া পর্যন্ত অপেক্ষা করতে বলবে।

## সরাসরি USB দিয়ে build ও install

অন্য project Terminal-এ:

```bash
npm run android:usb
```

এই script:

1. অনুমতিপ্রাপ্ত physical phone খুঁজে নেয়; emulator বাদ দেয়।
2. UI bundle করে USB API address `http://127.0.0.1:3001` দিয়ে APK বানায়।
3. `adb reverse tcp:3001 tcp:3001` দিয়ে ফোনের connection Mac-এ পাঠায়।
4. `output/SmartShop-USB.apk` install করে SmartShop চালু করে।

Physical phone পাওয়া না গেলে script থামে; emulator চালায় না। একাধিক ফোন থাকলে সঠিক serial বেছে নিতে হয়। Huawei P10 (Android 9)-এ USB APK install ও launch হয়েছে; ব্যবহারকারী Products screen দেখা যাচ্ছে বলে নিশ্চিত করেছেন। Huawei-এর ক্ষেত্রে script সক্রিয় Android user বেছে নিয়ে non-streaming install করে এবং package সত্যিই install হয়েছে কি না যাচাই করে।

## ৪. USB-তে ব্যবহার

Cable connected, USB reverse active এবং Mac server চালু রাখলে Wi-Fi ছাড়াই local API পাওয়া যায়। ফোনের **Shop connection settings**-এ USB address `http://127.0.0.1:3001` থাকবে। **Test connection** দিয়ে দেখো। Address-এর শেষে `/api` লিখবে না।

Cable খুললে, ফোন restart হলে বা reverse connection হারালে আবার cable লাগিয়ে `npm run android:usb` দাও। APK আবার build না করে connection শুধু ফিরিয়ে আনার command:

```bash
/Users/kawsarahmed/Library/Android/sdk/platform-tools/adb reverse tcp:3001 tcp:3001
```

এটি একটি অনুমতিপ্রাপ্ত physical phone যুক্ত থাকলে ব্যবহার করবে। একাধিক device থাকলে সঠিক ফোন নির্বাচন প্রয়োজন।

## ৫. Cable ছাড়া একই Wi-Fi-তে

Mac-এর server চালু রাখো এবং Mac/ফোন একই Wi-Fi-তে রাখো। Mac-এর বর্তমান private IP দেখো **System Settings → Wi-Fi → Details → TCP/IP** থেকে। App-এর **Shop connection settings**-এ যেমন `http://192.168.1.108:3001` দিয়ে **Test connection → Save and reconnect** করো। এটি কেবল আগের দেখা address; তোমার বর্তমান IP আলাদা হতে পারে।

LAN-এর জন্য নতুন APK চাইলে `npm run android:phone` ব্যবহার করা যায়। Phone download address Terminal ও `output/phone-connection.txt`-এ থাকবে। কিছু guest/classroom Wi-Fi device-to-device connection বন্ধ রাখে।

## ৬. সাধারণ সমস্যা

| যা দেখছ | যা করবে |
| --- | --- |
| ফোন শুধু charge হয় | Data cable, USB port ও File transfer mode পরীক্ষা করো। |
| `unauthorized` | ফোন unlock করে নিজের Mac-এর debugging prompt-এ Allow দাও। |
| কোনো device নেই | Cable আবার লাগাও, USB debugging পরীক্ষা করো। |
| App খোলে, data আসে না | Mac server চালু আছে কি না দেখো; USB reverse আবার চালাও; API address পরীক্ষা করো। |
| Cable খোলার পরে কাজ করে না | Cable আবার যুক্ত করো, অথবা একই Wi-Fi-তে LAN address ব্যবহার করো। |
| Mac বন্ধ | বর্তমান setup-এ shared data/login পাওয়া যাবে না। Mac চালু করো। |

## তথ্য ও account

Owner/Staff/Customer নিজস্ব login ব্যবহার করবে। এক browser window-এর account অন্য window-এ বসে যাবে না। Shared comments সবাই একই product-এ দেখতে পাবে; private হিসাব/contacts অনুমতিসাপেক্ষ।

Profile ও product ছবিগুলো Mac-এর `.data/uploads`-এ, আর account ও হিসাব `.data/smartshop.sqlite`-এ থাকে। Firebase email-verification service ছাড়া cloud data migration হয়নি। [Data locations](DATA_LOCATIONS_BN.md) এবং [সহজ ব্যবহার গাইড](../START_HERE_BN.md) দেখো।
