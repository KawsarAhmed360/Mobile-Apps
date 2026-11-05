# SmartShop ERD

Generated from the application's **actual in-memory SQLite schema** on 5 November 2026.

- [Scalable vector PDF](SmartShop_ERD.pdf)
- [Editable vector SVG](SmartShop_ERD.svg)

The PDF uses three A3 landscape pages: inventory/accounting on page 1, identity/community/assets on page 2, and customer collections, stock-alert read history and shop settings on page 3. All labels and connectors are vector elements, so the document can be enlarged without raster blur. Reference stubs on page 3 repeat keys from pages 1/2 and are not additional entities.

## Regenerate

Run `scripts/generate-erd.py` with a Python runtime containing ReportLab. The script loads `createApp` into an isolated in-memory database and reads SQLite table, foreign-key and unique-index metadata. It does not copy customer records, tokens, passwords or production data.

## Important modelling decisions

- `users` are login identities; `customers` are shop ledger contacts. `customers.user_id` optionally joins a registered login to its ledger contact.
- A sale may have no customer for walk-in purchases. When set, `sales.customer_id` references a customer.
- `stock_movements.reference_id` and `activity.detail` are application-managed reference/display data. They are not declared foreign keys.
- `requests` has composite primary key `(kind, request_id)` for transaction idempotency.
- `reviews` is unique per `(product_id, user_id)`; comment reactions have composite primary key `(comment_id, user_id)`.
- `customer_receipts` stores later collections against existing dues; `opening_amount` is the portion applied to the customer's opening balance, and `receipt_allocations` connects the rest to sales.
- `receipt_allocations` has composite primary key `(receipt_id, sale_id)`. Collections do not create a new sale.
- `stock_alert_reads` has composite primary key `(user_id, product_id)`, with stock/reorder snapshots at the time that user marked the alert read.
- `customers.opening_due` represents debt recorded before app invoices. Receipts reduce this balance first; only the remainder is allocated FIFO to prior sales.
- `sales.paid` is immutable checkout history. Current invoice settlement is `sales.paid + SUM(receipt_allocations.amount)`; outstanding due subtracts that settlement from the sale total.
- Later collections increase cash received while leaving sales revenue and profit unchanged.
- `user_sessions` stores current/previous refresh-token hashes, never raw secrets. Access JWTs last one day; the persistent session is revoked on explicit logout. A 30-second grace makes concurrent refreshes converge.
- `users.role` is resolved from the database for every authorized request. Only an owner can grant/revoke staff access; the owner account cannot be demoted through that endpoint.
- `shop` is an independent singleton. Its `map_location_set` flag makes the public coordinates nullable without rewriting the original NOT NULL SQLite coordinate fields.
- Firebase handles contact verification. Photo bytes use the configured provider: this free setup uses local files, while SQLite stores upload metadata and profile/product links.
- Currency amounts are integer paisa; timestamps are ISO strings and reporting dates use the shop's Dhaka timezone.

## Schema audit

Tables represented: **19**. Every declared SQL foreign key is listed below; cross-page references are explicit in the diagram.

| Child field | Parent key | Optional parent | Delete action |
| --- | --- | --- | --- |
| `comment_reactions.user_id` | `users.id` | No | `CASCADE` |
| `comment_reactions.comment_id` | `product_comments.id` | No | `CASCADE` |
| `customer_receipts.user_id` | `users.id` | No | `NO ACTION` |
| `customer_receipts.customer_id` | `customers.id` | No | `NO ACTION` |
| `customers.user_id` | `users.id` | Yes | `NO ACTION` |
| `product_comments.user_id` | `users.id` | No | `NO ACTION` |
| `product_comments.product_id` | `products.id` | No | `CASCADE` |
| `products.upload_id` | `uploads.id` | Yes | `NO ACTION` |
| `purchases.product_id` | `products.id` | No | `NO ACTION` |
| `receipt_allocations.sale_id` | `sales.id` | No | `NO ACTION` |
| `receipt_allocations.receipt_id` | `customer_receipts.id` | No | `CASCADE` |
| `reviews.user_id` | `users.id` | No | `NO ACTION` |
| `reviews.product_id` | `products.id` | No | `NO ACTION` |
| `sale_items.product_id` | `products.id` | No | `NO ACTION` |
| `sale_items.sale_id` | `sales.id` | No | `NO ACTION` |
| `sales.customer_id` | `customers.id` | Yes | `NO ACTION` |
| `stock_alert_reads.product_id` | `products.id` | No | `CASCADE` |
| `stock_alert_reads.user_id` | `users.id` | No | `CASCADE` |
| `stock_movements.product_id` | `products.id` | No | `NO ACTION` |
| `uploads.user_id` | `users.id` | No | `NO ACTION` |
| `user_sessions.user_id` | `users.id` | No | `NO ACTION` |
| `users.avatar_upload_id` | `uploads.id` | Yes | `NO ACTION` |

## Entity fields

- **activity**: `id` INTEGER (PK); `type` TEXT; `title` TEXT; `detail` TEXT; `amount` INTEGER; `created_at` TEXT.
- **comment_reactions**: `comment_id` INTEGER (PK, FK); `user_id` INTEGER (PK, FK); `value` INTEGER.
- **customer_receipts**: `id` INTEGER (PK); `customer_id` INTEGER (FK); `user_id` INTEGER (FK); `amount` INTEGER; `opening_amount` INTEGER; `method` TEXT; `note` TEXT; `business_date` TEXT; `created_at` TEXT.
- **customers**: `id` INTEGER (PK); `name` TEXT; `phone` TEXT; `email` TEXT; `address` TEXT; `created_at` TEXT; `user_id` INTEGER (FK, nullable); `opening_due` INTEGER.
- **expenses**: `id` INTEGER (PK); `title` TEXT; `amount` INTEGER; `business_date` TEXT; `created_at` TEXT.
- **product_comments**: `id` INTEGER (PK); `product_id` INTEGER (FK); `user_id` INTEGER (FK); `body` TEXT; `created_at` TEXT; `updated_at` TEXT.
- **products**: `id` INTEGER (PK); `name` TEXT; `category` TEXT; `unit` TEXT; `price` INTEGER; `cost` INTEGER; `stock` INTEGER; `reorder_level` INTEGER; `description` TEXT; `emoji` TEXT; `created_at` TEXT; `image_url` TEXT (nullable); `upload_id` INTEGER (FK, nullable).
- **purchases**: `id` INTEGER (PK); `product_id` INTEGER (FK); `quantity` INTEGER; `unit_cost` INTEGER; `reference` TEXT; `created_at` TEXT.
- **receipt_allocations**: `receipt_id` INTEGER (PK, FK); `sale_id` INTEGER (PK, FK); `amount` INTEGER.
- **requests**: `kind` TEXT (PK); `request_id` TEXT (PK); `digest` TEXT; `response` TEXT.
- **reviews**: `id` INTEGER (PK); `product_id` INTEGER (FK); `user_id` INTEGER (FK); `rating` INTEGER; `body` TEXT; `created_at` TEXT.
- **sale_items**: `id` INTEGER (PK); `sale_id` INTEGER (FK); `product_id` INTEGER (FK); `quantity` INTEGER; `unit_price` INTEGER; `unit_cost` INTEGER.
- **sales**: `id` INTEGER (PK); `customer_id` INTEGER (FK, nullable); `total` INTEGER; `paid` INTEGER; `cost` INTEGER; `created_at` TEXT; `business_date` TEXT.
- **shop**: `id` INTEGER (PK); `name` TEXT; `tagline` TEXT; `address` TEXT; `phone` TEXT; `opening_hours` TEXT; `latitude` REAL; `longitude` REAL; `email` TEXT; `configured` INTEGER; `map_location_set` INTEGER.
- **stock_alert_reads**: `user_id` INTEGER (PK, FK); `product_id` INTEGER (PK, FK); `stock_at_read` INTEGER; `reorder_at_read` INTEGER; `read_at` TEXT.
- **stock_movements**: `id` INTEGER (PK); `product_id` INTEGER (FK); `quantity` INTEGER; `type` TEXT; `reference_id` INTEGER (nullable); `created_at` TEXT.
- **uploads**: `id` INTEGER (PK); `user_id` INTEGER (FK); `url` TEXT; `storage_path` TEXT; `original_name` TEXT; `mime_type` TEXT; `size` INTEGER; `provider` TEXT; `purpose` TEXT; `created_at` TEXT.
- **user_sessions**: `id` TEXT (PK); `user_id` INTEGER (FK); `created_at` TEXT; `expires_at` TEXT; `revoked_at` TEXT (nullable); `refresh_token_hash` TEXT (nullable); `previous_refresh_token_hash` TEXT (nullable); `previous_refresh_valid_until` TEXT (nullable); `refresh_rotated_at` TEXT (nullable).
- **users**: `id` INTEGER (PK); `name` TEXT; `username` TEXT; `email` TEXT; `password_hash` TEXT; `role` TEXT; `created_at` TEXT; `phone` TEXT; `email_verified` INTEGER; `phone_verified` INTEGER; `firebase_uid` TEXT (nullable); `is_demo` INTEGER; `disabled` INTEGER; `avatar_url` TEXT; `avatar_upload_id` INTEGER (FK, nullable); `address` TEXT.
