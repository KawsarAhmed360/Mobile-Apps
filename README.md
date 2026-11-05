# SmartShop

SmartShop is a single-shop Android app and browser interface for products, purchases, sales, expenses, customer dues and public product discussions. It uses React, TypeScript, Tailwind CSS, Framer Motion and Capacitor, with a permission-checked Express REST API and SQLite accounting database.

Current scope, **5 November 2026**: a free local Mac server and a physical Huawei P10 running Android 9, connected over USB. Permanent cloud deployment and billing setup were cancelled at the user's request. The Mac must stay on while the phone or browser uses shared data.

- [সহজ বাংলা গাইড](START_HERE_BN.md)
- [USB দিয়ে ফোনে install](docs/PHONE_INSTALL_BN.md)
- [ক্লাসের ১২টি requirement](docs/CLASS_DEMO_BN.md)
- [কোন তথ্য কোথায় থাকে](docs/DATA_LOCATIONS_BN.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [ERD PDF](docs/SmartShop_ERD.pdf) and [schema notes](docs/ERD.md)
- [Full course scope](docs/SMARTSHOP_REQUIREMENTS.md)

## Run locally

Use Node.js 24 and run commands from the project root:

```bash
npm install
npm run dev:phone
```

Open [SmartShop](http://localhost:5173). Keep that terminal running. Start only one server instance. The API uses port 3001; the interface uses port 5173.

## Install on the USB phone

Enable USB debugging on the physical phone, connect a data cable and approve your own Mac on the phone. Then, in a second project terminal:

```bash
npm run android:usb
```

The script selects a physical device, builds a bundled-interface APK, connects phone port 3001 to Mac port 3001 with `adb reverse`, installs the APK and starts SmartShop. It never starts or selects an emulator. The USB build is `output/SmartShop-USB.apk` and uses `http://127.0.0.1:3001` through that USB connection.

Keep the cable connected and Mac server running. Shared Wi-Fi is not needed while USB reverse is active. Reconnecting/restarting a device can remove the reverse connection; run the USB command again. Without USB, choose the Mac's current LAN API address in **Shop connection settings** and use the same Wi-Fi. USB installation and real phone checks must be recorded separately from a successful APK build.

## Accounts and pictures

Public registration creates a customer account. The first real owner can activate an existing real customer from **Your account → Activate your shop owner**, using the private code displayed by `npm run owner:code` on the Mac. Activation preserves the account's ID, password and history, and disables sample accounts.

Only the owner can grant/revoke staff under **Shop settings → Staff access**. Staff can manage stock, sales, expenses and customer balances; owner settings and staff management stay owner-only.

Each browser window selects its own session. Refreshing or restoring that tab preserves its identity; a fresh window starts signed out. A Customer window cannot adopt another window's Owner account. Android remembers its own session across app restarts. Logout revokes the selected session. Clearing device storage or revoking an account can require sign-in again.

Owner, Staff and Customer can edit their own profile and profile photo under **Your account → Your profile**. Owner details/photo are also available in **Shop settings**. Uploaded product/profile images are saved on the Mac under `.data/uploads`; SQLite stores their metadata and `/api/media/...` URL. These are local server uploads, not Firebase cloud storage.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local API and browser interface |
| `npm run dev:phone` | Start both for local network/phone testing |
| `npm run android:usb` | Build, connect, install and launch on a physical USB phone |
| `npm run android:phone` | Build a bundled-interface APK for the Mac's LAN address |
| `npm run owner:code` | Display the private, one-time owner activation code locally |
| `npm run typecheck` | Check TypeScript |
| `npm test` | Run session, authorization, accounting, community and upload checks |
| `npm run build` | Check types and build the interface |
| `npm run doctor` | Check local prerequisites |

## Data and verification

Firebase project `smartshop-kawsar-20261104` has Android/web registrations and Email/Password verification setup. Firebase currently supplies the separate email-verification identity. Primary SmartShop accounts, salted password hashes, roles, sessions and accounting records remain in local SQLite. No shop data was migrated to Firestore, no cloud API was deployed, and uploaded images do not go to Firebase Storage.

SMS is off. Real inbox verification has not yet been recorded in this work. The initial course requirement for cloud-backed file uploads remains incomplete even though local photo upload works. See [implementation status](docs/IMPLEMENTATION_STATUS.md) for remaining PDF requirements and test evidence.

Final validation passed all 58 tests in 7 suites, TypeScript and the Android build. The USB APK was installed and launched on the Huawei P10 (Android 9); the user confirmed the Products screen displayed correctly. A real local Git repository exists. A remote repository and hosted workflow run have not been verified. Local data, credentials, backups and APK outputs are ignored by Git. Preserve `.data` and its backups.
