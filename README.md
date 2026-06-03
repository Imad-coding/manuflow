# FulfillForge

**Production workflow for Shopify merchants.**

[fulfillforge.store](https://fulfillforge.store)

FulfillForge syncs Shopify orders into a local SQLite database and lets merchants manage production statuses across dashboard, board, and order detail views.

FulfillForge is a **standalone Node.js app** — it connects to Shopify via credentials in your `.env` file. There is no OAuth, install flow, App Bridge, or billing.



## Stack



- Node.js + Express.js (Node 22.5+ for built-in `node:sqlite`)

- EJS templates + Tailwind CSS (CDN)

- SQLite via Node.js built-in `node:sqlite` module

- Shopify Admin GraphQL API



## Setup



```bash

npm install

cp .env.example .env

npm run dev

```



Open [http://localhost:3000](http://localhost:3000)



## Environment variables



| Variable | Description |

|----------|-------------|

| `SHOPIFY_SHOP_DOMAIN` | Your shop domain (e.g. `my-store.myshopify.com`) |

| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Admin API access token from a Shopify custom app |

| `SHOPIFY_API_VERSION` | API version (default: `2026-01`) |

| `SQLITE_DATABASE_PATH` | SQLite file path (default: `./data/manuflow.sqlite3`) |

| `BACKUP_DIR` | Backup output directory (default: `./backups`) |

| `PORT` | Server port (default: `3000`) |

| `APP_LOGIN_USERNAME` | Admin login username (default: `admin`) |

| `APP_LOGIN_PASSWORD` | Admin login password (**required in production**) |

| `SESSION_SECRET` | Secret for signing session cookies (**required in production**) |

| `SHOPIFY_WEBHOOK_ENABLED` | Enable webhook processing (`true` / `false`) |

| `SHOPIFY_WEBHOOK_SECRET` | HMAC secret for FullfilForge-registered webhooks (custom app Client secret) |

| `SHOPIFY_MANUAL_WEBHOOK_SECRET` | Optional HMAC secret for manually created Shopify Admin webhooks |

| `APP_BASE_URL` | Public app URL for webhook callbacks (e.g. `https://fullfilforge.store`) |



### Production login



Set these before deploying to a public URL:



```env

APP_LOGIN_USERNAME=admin

APP_LOGIN_PASSWORD=your_strong_password

SESSION_SECRET=your_random_secret

```



All dashboard pages and API routes require sign-in. `/health` stays public for uptime checks.



## Shopify Custom App Webhooks



FullfilForge can register Shopify webhooks automatically using your custom app credentials in `.env` (no OAuth or install flow).



### Required env vars



```env

SHOPIFY_WEBHOOK_ENABLED=true

SHOPIFY_WEBHOOK_SECRET=your_custom_app_client_secret

SHOPIFY_MANUAL_WEBHOOK_SECRET=

APP_BASE_URL=https://fullfilforge.store

```



Also ensure `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_ADMIN_ACCESS_TOKEN`, and `SHOPIFY_API_VERSION` are set. Your custom app needs the **`write_webhooks`** Admin API scope (in addition to order/location scopes).



### Webhook signing secrets



| Source | Env variable | When to use |

|--------|--------------|-------------|

| FullfilForge **Register webhooks** (GraphQL API) | `SHOPIFY_WEBHOOK_SECRET` | Set to your custom app **Client secret** (API credentials) |

| Manually created in **Shopify Admin → Settings → Notifications → Webhooks** | `SHOPIFY_MANUAL_WEBHOOK_SECRET` | Set to the signing secret shown when you create the Admin webhook |



FullfilForge tries `SHOPIFY_WEBHOOK_SECRET` first, then `SHOPIFY_MANUAL_WEBHOOK_SECRET` if the first fails. Invalid HMAC is always rejected.



**Recommended production setup:** use only FullfilForge-registered webhooks (`Register webhooks` in Settings) and delete any duplicate manual webhooks in Shopify Admin to avoid double deliveries.



### Setup steps



1. Add the env vars above on your VPS

2. Restart PM2: `pm2 restart fulfillforge`

3. Open **Settings** in FullfilForge

4. Click **Register webhooks** — missing subscriptions are created via Shopify Admin GraphQL

5. Click **Refresh list** to verify topics and callback URLs appear

6. Create or update an order in Shopify

7. FullfilForge should sync automatically and connected browsers receive live updates (no manual refresh required)



### Webhook callback URLs



| Topic area | Callback URL |

|------------|--------------|

| Orders create / update / cancel | `https://fullfilforge.store/webhooks/shopify/orders-create` (and `-updated`, `-cancelled`) |

| Fulfillment order events | `https://fullfilforge.store/webhooks/shopify/fulfillment-orders-updated` |



Optional fulfillment-order topics are registered when supported; failures are logged without breaking order webhooks.



## Demo mode vs connected mode



| Mode | When | Behavior |

|------|------|----------|

| **Demo mode** | `SHOPIFY_SHOP_DOMAIN` or `SHOPIFY_ADMIN_ACCESS_TOKEN` is missing/invalid | Sample manufacturing data; sync shows a clear error |

| **Connected mode** | Both env vars are set and the shop domain is valid | Sync pulls live orders from Shopify via Admin API |



Check **Settings** for a credential checklist and connection status.



## Connect Shopify (custom app via `.env`)



FulfillForge uses a **Shopify custom app** access token — not a public/installable app.



### 1. Create a custom app in Shopify Admin



1. Log in to your Shopify store admin.

2. Go to **Settings → Apps and sales channels**.

3. Click **Develop apps** (enable custom app development if prompted).

4. Click **Create an app** and name it (e.g. `FulfillForge`).

5. Open **Configuration → Admin API integration**.

6. Enable these **Admin API access scopes**:

   - `read_orders`

   - `read_locations`

   - `read_fulfillments`

7. Click **Save**.

8. Go to **API credentials** and click **Install app** (for your store only).

9. Reveal and copy the **Admin API access token** (starts with `shpat_`). Store it securely — Shopify only shows it once.



### 2. Add credentials to `.env`



Edit `.env` in the project root:



```env

SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com

SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

SHOPIFY_API_VERSION=2026-01

```



Use your **`.myshopify.com`** domain, not a custom storefront URL. You can enter just the store handle (e.g. `your-store`) — it will be normalized to `your-store.myshopify.com`.



### 3. Restart the server



Env vars are read at startup:



```bash

npm run dev

```



### 4. Verify on Settings



1. Open [http://localhost:3000/settings](http://localhost:3000/settings).

2. Confirm **Connected mode** and green checkmarks for both env vars.

3. Click **Sync Shopify Orders**.



### 5. Sync behavior



- Locations are imported from Shopify first.

- Open, unfulfilled, and partially fulfilled orders are fetched.

- One **production order** is created per Shopify order + fulfillment location.

- Existing production orders are updated (status, priority, and notes are preserved).



## Sync errors



The sync API returns specific messages for common issues:



| Error | Cause | Fix |

|-------|-------|-----|

| Missing credentials | Env vars not set | Add both vars to `.env` and restart |

| Invalid shop domain | Wrong domain format | Use `store.myshopify.com` |

| Invalid access token | Token wrong or revoked | Regenerate token in Shopify Admin |

| Missing scopes | App lacks API scopes | Add scopes listed above and reinstall app |

| GraphQL error | Shopify API returned errors | Read the message; check API version |

| No orders found | Store has no matching open orders | Normal if all orders are fulfilled/closed |



## Scripts



| Command | Description |

|---------|-------------|

| `npm run dev` | Start with nodemon (development) |

| `npm start` | Start production server |

| `npm run backup` | Create a timestamped SQLite backup in `./backups` |



## Database backup



Create a safe copy of the SQLite database (WAL checkpoint, then file copy):



```bash

npm run backup

```



Backups are written to `./backups/` by default (override with `BACKUP_DIR` in `.env`). Production example:



```env

BACKUP_DIR=/home/fullfil/manuflow/backups

```



Filename format:



```

fullfilforge-backup-YYYY-MM-DD-HH-mm.sqlite3

```



The script reads `SQLITE_DATABASE_PATH` from `.env` (default: `./data/manuflow.sqlite3`), runs `PRAGMA wal_checkpoint(FULL)` before copying, keeps the **14 most recent** backup files, and deletes older ones automatically (`backup.log` is never removed). Backups stay outside `public/` and are **not** served over HTTP.



### Scheduled backups (cron)



```cron

0 3 * * * cd /home/fullfil/manuflow && npm run backup >> /home/fullfil/manuflow/backups/backup.log 2>&1

```



Restore by stopping the app, replacing the database file with a backup copy, and restarting.



### Settings still shows Demo mode after adding `.env`



Restart the server — Node only loads `.env` at startup.



### 401 / invalid access token



Regenerate the Admin API access token in your custom app and update `.env`.



### 403 / access denied / missing scopes



Edit the custom app scopes (`read_orders`, `read_locations`, `read_fulfillments`), save, reinstall the app, and paste the new token.



### 500 error on page load



Ensure you are on **Node.js 22.5 or newer**:



```bash

node -v

npm install

npm run dev

```



## Pages



- `/dashboard` — Production orders table with filters

- `/export/production-orders.csv` — CSV export of the filtered production list (see below)

- `/production-board` — Kanban board by status

- `/orders/:id` — Order detail with status, priority, and notes

- `/settings` — Connection status, sync, and locations



## CSV export



From the **Dashboard**, click **Export CSV** in the filter toolbar. The download uses the same filters currently applied on the page (status, location, search, and priority when active).



You can also open the export URL directly:



```

GET /export/production-orders.csv?status=In%20Production&location=1&search=SKU123

```



**Format:** One row per production order (same grouping as the dashboard). If an order has multiple products, they appear in a single **Products** column, for example:

`Product A (SKU123, Red / Large, Qty 2); Product B (SKU456, Qty 1)`

**Columns:** Order Number, Order Date, Due Date, Customer Name, Products, Item Count, Total Quantity, Assigned Location, Production Status, Priority, Internal Notes.



- **Connected mode** — exports only your Shopify shop's production data (demo data is excluded).

- **Demo mode** — exports the sample demo data.



The response is a downloadable CSV file (`Content-Type: text/csv`, filename `fulfillforge-production-orders.csv`).

