# SmartShop

A single-shop Android application with an owner/staff workspace and a customer-facing product catalog. Built with React, TypeScript, Tailwind CSS and Capacitor, with an Express API and a local SQLite database for the first development milestone.

For the guided Mac/VS Code setup, read **[START_HERE_BN.md](START_HERE_BN.md)**. The full scope and course requirement mapping are in **[docs/SMARTSHOP_REQUIREMENTS.md](docs/SMARTSHOP_REQUIREMENTS.md)**.

## Local development

Use **Node.js 24 LTS**. From this project folder:

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite development server proxies `/api` to the local API on port 3001. Both processes must remain running.

If Homebrew's keg-only Node installation is not on the current terminal's path:

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
```

The project VS Code settings include that Node path for newly created integrated terminals. Alternatively, double-click `Start SmartShop.command` in Finder to start the local server, then open the browser address above manually.

Development accounts:

| Role | Email | Password |
| --- | --- | --- |
| Owner | `owner@smartshop.local` | `SmartShop@123` |
| Customer | `customer@smartshop.local` | `Customer@123` |

These are local demonstration credentials. Use sample data for development. Authentication tokens are held in memory; refreshing may require signing in again. Persistent local data is stored under `.data/`, which is ignored by Git.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run doctor` | Check local prerequisites |
| `npm run dev` | Start local API and browser app |
| `npm run dev:phone` | Expose the development interface on the local network |
| `npm run typecheck` | Type-check the project |
| `npm test` | Run backend tests |
| `npm run build` | Check types and build the interface |
| `npm run android:sync` | Build and copy interface files into the existing Android project |
| `npm run android:sync:emulator` | Sync with the Mac emulator's local preview URL |
| `npm run android:build` | Build a debug APK using the installed Java 21 |
| `npm run android:open` | Open the Android project in Android Studio |
| `npm run android:run` | Run the Android project on an available device |

## Android development

This Mac now has Android Studio, Java 21, SDK 36/37 and a `Medium_Phone_API_37.0` ARM64 emulator installed. A debug APK was built, installed and launched in that emulator. Current Android Studio bundles Java 25; this project's Gradle version needs Java 21 instead. `npm run android:build` selects the installed Homebrew Java 21. Android Studio uses the project's local Java configuration. Follow the [Android virtual device guide](https://developer.android.com/studio/run/managing-avds) if creating another device.

If the `android/` project has not been generated yet, run `npm run build` and `npx cap add android` once. Subsequent interface changes use `npm run android:sync`.

Keep `npm run dev` running in one terminal. In another terminal, point the Android development container at the Mac through the emulator's host alias:

```bash
npm run android:sync:emulator
npm run android:build
npm run android:open
```

Select the emulator in Android Studio and press Run, or use the already installed SmartShop icon. The emulator's Chrome can also open `http://10.0.2.2:5173` to check connectivity. See [Android emulator network addresses](https://developer.android.com/studio/run/emulator-networking-address). On this 8 GB Mac the API 37 image is resource intensive; use one emulator and allow time for the first boot. Routine interface work can use the browser preview.

A physical phone is an optional second test target. For a phone preview, run `npm run dev:phone` and replace the example address below with the Mac's actual LAN IP:

```bash
CAPACITOR_DEV_SERVER_URL=http://192.168.1.10:5173 npm run android:sync
npm run android:open
```

These development configurations depend on the Mac remaining online. Before release, unset `CAPACITOR_DEV_SERVER_URL` if set, configure the deployed HTTPS backend through `VITE_API_URL`, and sync again. Packaging does not deploy the API or database. Emulator and APK test completion must be recorded separately.

## Milestone scope

The first implementation includes the shop dashboard, inventory, purchases, sales, expenses, customer records, catalog and reviews. Eleven automated checks pass. The Android debug build, installation, activity startup and WebView connection to the Mac development server were verified. Native end-to-end interaction coverage remains limited; see [implementation status](docs/IMPLEMENTATION_STATUS.md).

Remaining course integrations include real email and phone verification, cloud uploads, GraphQL, on-device ML, generative AI, Crystal Reports and the deployment pipeline. Complete supplier, returns and payment-ledger workflows are also separate work. Do not treat sample data or placeholders as completed integrations. See the requirement plan for the detailed mapping.

Official setup references: [Capacitor environment](https://capacitorjs.com/docs/getting-started/environment-setup), [Android Studio](https://developer.android.com/studio), [Node.js](https://nodejs.org/en/download).
