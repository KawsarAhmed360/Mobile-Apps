# SmartShop — implementation status

Updated: **5 November 2026**. Final scope: free local Mac server and a physical Huawei P10 on Android 9 over USB. The user cancelled Mac-off operation, paid billing and cloud deployment. No shop data migration occurred.

## Application features

- React/TypeScript interface, Tailwind CSS, Framer Motion and Capacitor Android packaging.
- Express REST API with role checks and persistent local SQLite accounting data.
- Customer registration and unique username checks. The first real owner can activate a new or existing real account with the private code, preserving an existing account's ID, password and history. Activation disables sample accounts.
- Owner-managed staff access; the server checks the current role on each request. Staff manage stock, sales, expenses and customer balances. Shop/staff settings require the owner.
- One-day access JWTs and persistent, revocable refresh sessions. Server-side refresh tokens are stored as hashes. Race handling prevents late replies restoring a signed-out account or using another account's credentials.
- Independent accounts in separate browser windows. Refresh/tab restoration preserves the selected identity; a fresh window starts signed out. Android remembers its selected session across app restarts.
- Public catalog, search/category filtering, pagination, details and availability. Private stock quantities, cost/profit and customer contacts/dues require staff access.
- Persistent public product comments visible to owner, other customers and visitors. Real-time invalidations, comment pagination, author edits/owner moderation and one current like/dislike reaction per account are implemented.
- Star reviews and live aggregate refresh.
- Inventory, stock receipts/purchases, weighted-average cost, sales with sale-time price/cost snapshots, expenses and the daily dashboard.
- Editable owner/shop contact and location; user profile fields and profile photos for Owner, Staff and Customer. Owner photo settings are also available under Shop settings.
- Registered customer accounts link to customer ledger records through `customers.user_id`. Their profile contact/photo can appear in the owner customer directory without merging their login or due history.
- Customer phone/address editing, opening dues, invoice/payment ledger and collection of existing dues. Opening debt is collected first, then oldest unpaid invoices. Checkout shows prior dues and allocates received money before the new bill. Collections increase cash, not sales/profit.
- Per-user in-app low-stock bell, unread count and mark-read state. Stock/threshold changes can reset an alert. Background Android push notifications are not implemented.
- Free local image storage: actual files under `.data/uploads`, metadata in `uploads`, media served by `/api/media/<generated-id>`. Product uploads require staff; profile uploads are bound to the current account. This is local server storage, not cloud storage.

## Tests and Android evidence

Final validation passed **58 tests in 7 suites**, TypeScript, Vite and the Android debug build. Coverage includes independent window sessions, persistence, owner activation, staff access, accounting/dues, concurrency, idempotency, comments/reactions, profile ownership, actual local image save/serve, legacy upload migration and media-path protection.

`output/SmartShop-USB.apk` bundles the interface, uses `http://127.0.0.1:3001` over USB reverse, and includes the configured Firebase Authentication plugin. Installed successfully on the **Huawei P10 / Android 9** using non-streaming installation into its active Android user. Package path was verified; launching returned **Status: ok**. The user confirmed the Products screen displayed correctly. Further Android testing uses the physical phone only.

Browser QA used an isolated in-memory test shop: Customer profile photo upload/save worked, a fresh window started signed out, and signing in as Owner in that window left the Customer window signed in after refresh. The test shop did not alter actual shop records. Real owner/customer passwords and email verification were left for the user to enter.

ERD regenerated from the actual schema: **19 entities, 22 declared foreign keys, three A3 vector pages**. All three pages were rendered and visually checked. A private local backup was saved before deployment preparation; no data migration or paid deployment occurred.

## Firebase's actual role

Project **`smartshop-kawsar-20261104`** has Android/web registrations, Android SHA-1/SHA-256 certificates and Email/Password verification setup. The official sign-in endpoint returned `INVALID_LOGIN_CREDENTIALS` for an intentional invalid-account probe. Real inbox-verification completion has not been recorded in this work.

Primary SmartShop username/password hashes, roles, account profiles, sessions, customer contacts and accounting records are stored in local SQLite. Firebase Authentication currently handles the separate email-verification identity only. Its Users list is not automatically the full SmartShop account list. No shop records were migrated to Firestore, no cloud app/API was deployed and pictures were not uploaded to Firebase Storage. SMS remains off.

Cloud/billing work was cancelled, not left as an active deployment milestone. It can be reconsidered only if requested later. [Data locations](DATA_LOCATIONS_BN.md) explains what is local and what Firebase currently holds.

## Today's 12 course items

| # | Requirement | Status |
| --- | --- | --- |
| 1 | ERD | Three-page vector PDF/SVG generated from the real schema. Use the latest regeneration after the profile/customer link changes. |
| 2 | Git / modern workflow | Real local repository and actual commit history; Vite/npm, lockfile and workflow file. Remote repository and hosted CI run unverified. |
| 3 | Modern frontend | React implemented. |
| 4 | Working REST API | Actual health, products, auth, sales and other endpoints. |
| 5 | Multiple textboxes/dropdowns | Registration, profile, product, customer, checkout and settings forms. |
| 6 | Pagination | Catalog, product comments and account directory. |
| 7 | Session / JWT | Signed access JWT, checked/refreshable/revocable sessions and isolated clients tested. |
| 8 | Live username check | Debounced API/UI plus database uniqueness. |
| 9 | Email **and** phone verification | Email service configured; real inbox completion unverified. SMS off. Combined requirement incomplete. |
| 10 | Upload with cloud storage | Photo upload uses the free local Mac server. It does not satisfy the cloud-storage part; incomplete. |
| 11 | Real-time comments | Persistent shared discussion and server-pushed invalidations. |
| 12 | Live like/dislike | Persistent per-account reaction and live count updates. |

## Wider PDF scope

External tutorial playback, on-device ML/model evaluation, GraphQL, genuine Crystal Reports, generative AI and a successful hosted CI run remain incomplete. A low-stock threshold is business logic, not ML; an ordinary PDF export is not Crystal Reports. Cloud hosting/storage were excluded from the final free local scope, so their original course requirements remain unmet.

Supplier/payables, returns, invoice export, tax/discount workflows, fractional quantities/unit conversion and a full backup/reporting interface require further work. Preserve `.data`, uploaded files and private backups. [The original requirement plan](SMARTSHOP_REQUIREMENTS.md) remains a design plan, not a completion claim.
