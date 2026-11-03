# SmartShop — implementation status

Date: 3 November 2026. Milestone: first local development build.

## Available in the first version

- React/TypeScript app with responsive customer and owner/staff screens, Tailwind CSS and Framer Motion.
- Node.js/Express REST API and persistent SQLite database in `.data/smartshop.sqlite`.
- Demo owner/customer login, customer registration, live username lookup and role-checked API routes. JWT stays in memory; refresh requires sign-in again.
- Public product catalog, search, categories, pagination, product details and availability.
- Customer product reviews and star ratings saved in the database; SSE invalidates catalog/review views without a page reload.
- Inventory list, product creation, opening stock and configurable low-stock threshold per product.
- Purchases increase stock and update weighted-average cost.
- Sales decrease stock, preserve sale-time price/cost, support partial payment and show customer dues.
- Customer contact records and purchase/due summaries.
- Expenses with datepicker, daily sales/gross profit/expenses/net profit, seven-day chart, low-stock list and recent activity.
- Embedded Google map and directions for an explicitly labelled **sample** shop location.
- Capacitor Android project generated. Native build/run depends on SDK setup.
- Local startup launcher, VS Code tasks/settings and a Bangla beginner guide.

This is sample-data development software, not a production shop deployment. The server intentionally refuses `NODE_ENV=production` until real account provisioning, verification and deployment are implemented. Public registration currently creates unverified customer accounts; no OTP delivery is simulated.

## Course requirement checklist

| PDF # | Current status |
| --- | --- |
| 1 | ERD design/export to scalable PDF pending. |
| 2 | Review records refresh live; separate threaded comments pending. |
| 3 | Like/dislike reactions and counts pending. |
| 4 | Live username API and debounced UI check implemented. |
| 5 | Actual email and phone verification pending. |
| 6 | Multiple form inputs and dropdowns implemented. |
| 7 | Database-backed star ratings and live refresh implemented. |
| 8 | Customer catalog pagination implemented; large private histories need pagination later. |
| 9 | External audio/video tutorial playback pending. |
| 10 | Embedded map/directions implemented with labelled demo coordinates; real shop configuration pending. |
| 11 | JWT login and in-memory client logout implemented; production session hardening/revocation pending. |
| 12 | On-device model, inference integration and evaluation pending. Low-stock threshold is ordinary logic, not ML. |
| 13 | Cloud-backed image/file uploads pending; current product art uses emoji. |
| 14 | Expense datepicker implemented. |
| 15 | Framer Motion transitions implemented. |
| 16 | Tailwind CSS integrated. |
| 17 | Vite/npm workflow and lockfile implemented; Git repository/remote setup pending. |
| 18 | GraphQL/modern API layer beyond REST pending. |
| 19 | Actual REST endpoints implemented. |
| 20 | Genuine Crystal Reports integration pending. |
| 21 | React implemented. |
| 22 | GitHub Actions build/test workflow written; remote repository and successful hosted run pending. |
| 23 | Generative AI integration pending. |
| 24 | Instructor's additional requirements unknown. |

## Remaining business workflows

Supplier accounts/payables, collecting existing customer dues, sale/purchase returns, product editing, settings UI, invoice export, discount/tax handling, staff provisioning/permissions, data backups and audit reporting remain future work. Quantities are whole units in this first milestone; fractional weights and unit conversion require an accounting/storage extension.

## Environment and verification

- Mac architecture: Apple Silicon ARM64.
- VS Code detected; project terminal settings include Homebrew Node 24.
- Node.js 24 installed and packages installed with a lockfile.
- Android Studio, Java 21, Android SDK platforms 36/37, build tools and API 37 ARM64 emulator image installed. License files are present; the user explicitly authorized both SDK/image licenses.
- Capacitor Android source generated. `assembleDebug` succeeded with Java 21, producing `android/app/build/outputs/apk/debug/app-debug.apk`. The current APK uses the emulator-only development URL `http://10.0.2.2:5173`.
- The Medium Phone API 37.0 emulator completed its first boot. APK installation returned `Success`; launching `com.smartshop.app/.MainActivity` returned `Status: ok`. Process logs confirmed the WebView loaded the Mac URL and Vite connected. Native end-to-end interaction coverage remains limited; the functional sale workflow was exercised in the browser.
- TypeScript and Vite production build passed.
- Browser smoke: public catalog loaded, demo owner authenticated, daily dashboard displayed, and a sample ৳95 sale with ৳50 paid / ৳45 due was confirmed successfully.
- Mobile viewport 390px: no horizontal overflow; catalog/dashboard/checkout checked; both expense and purchase actions remain accessible after layout fixes.
- Automated tests: **11 passed, 0 failed**, including stock/financial transactions, privacy/role enforcement, concurrent overselling, retries, persistence, real-time invalidation, Dhaka date boundaries and the HTTP-emulator request-ID fallback.
- `npm run android:sync:emulator` passed. Dependency installation reports zero known vulnerabilities after patched transitive dependency overrides.

No external database, account, cloud hosting, payment provider or paid AI service has been provisioned. All seeded shop/customer details are sample data.
