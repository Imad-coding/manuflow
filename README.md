# ManuFlow



Shopify-connected manufacturing production board. Syncs Shopify orders into a local SQLite database and lets merchants manage production statuses.



ManuFlow is a **standalone Node.js app** — it connects to Shopify via credentials in your `.env` file. There is no OAuth, install flow, App Bridge, or billing.



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

| `PORT` | Server port (default: `3000`) |



## Demo mode vs connected mode



| Mode | When | Behavior |

|------|------|----------|

| **Demo mode** | `SHOPIFY_SHOP_DOMAIN` or `SHOPIFY_ADMIN_ACCESS_TOKEN` is missing/invalid | Sample manufacturing data; sync shows a clear error |

| **Connected mode** | Both env vars are set and the shop domain is valid | Sync pulls live orders from Shopify via Admin API |



Check **Settings** for a credential checklist and connection status.



## Connect Shopify (custom app via `.env`)



ManuFlow uses a **Shopify custom app** access token — not a public/installable app.



### 1. Create a custom app in Shopify Admin



1. Log in to your Shopify store admin.

2. Go to **Settings → Apps and sales channels**.

3. Click **Develop apps** (enable custom app development if prompted).

4. Click **Create an app** and name it (e.g. `ManuFlow`).

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



## Troubleshooting



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



The response is a downloadable CSV file (`Content-Type: text/csv`, filename `manuflow-production-orders.csv`).

