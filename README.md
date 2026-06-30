# 92kamera BE

Express.js + TypeScript API for the 92kamera React frontend.

The frontend already calls these routes:

- `POST /api/auth/login`
- `GET /api/health`
- `GET /api/storage?key=...`
- `PUT /api/storage`
- `GET /api/storage/meta?key=...`
- `POST /api/storage/cas`
- `GET /api/gallery`
- `POST /api/gallery`
- `DELETE /api/gallery`

## Architecture

Code is split by responsibility:

- `src/routes`: only declares URL and middleware.
- `src/controllers`: receives Express request/response.
- `src/services`: business logic such as pricing, booking, catalog, auth.
- `src/repositories`: storage adapters for JSON, MongoDB, Supabase, MySQL.
- `src/types`: shared TypeScript contracts.

## Business APIs

These endpoints model the main website flow more directly than the legacy KV
API:

- `GET /api/catalog`
  Public catalog for home page: cameras, accessories, process steps, photos,
  albums, delivery fees, and public discount info.

- `POST /api/pricing/estimate`
  Calculates temporary price before booking. Supports discount types:
  `fixed` and `percent`. Supports one rental discount and one delivery discount.

- `POST /api/bookings`
  Public booking endpoint. Guest customers can book without an account by
  sending name and phone. The created booking is stored as `pending` so admin
  can contact the customer through Zalo/phone and confirm.

- `GET /api/bookings`
  Admin-only booking/schedule list. Filters: `status`, `from`, `to`, `q`.

- `GET /api/bookings/availability?date=YYYY-MM-DD&days=1&session=full`
  Returns available quantity for each camera/accessory for a selected schedule.

- `PATCH /api/bookings/:id/status`
  Admin-only status update. Valid statuses: `pending`, `confirmed`, `active`,
  `completed`, `cancelled`.

Example pricing request:

```json
{
  "rental": { "date": "2026-07-01", "days": 1, "session": "full" },
  "items": {
    "cameras": [{ "id": 100, "qty": 1 }],
    "accessories": [{ "name": "Hắt sáng  60 cm", "qty": 1 }]
  },
  "delivery": { "type": "selfPickup" },
  "discountCodes": ["SALE20"]
}
```

Example booking request:

```json
{
  "submitKey": "client-generated-idempotency-key",
  "customer": {
    "name": "Nguyen Van A",
    "phone": "0901234567",
    "zalo": "0901234567",
    "address": "Tam Ky"
  },
  "rental": { "date": "2026-07-01", "days": 1, "session": "full" },
  "items": {
    "cameras": [{ "id": 100, "qty": 1 }]
  },
  "delivery": { "type": "selfPickup" },
  "discountCodes": []
}
```

## Local dev

```bash
npm install
cp .env.example .env
npm run dev
```

The API runs on `http://localhost:3000` by default. The FE project in
`D:\92-kameraok\92kamera` already proxies `/api` to `http://localhost:3000`, so
run the FE with:

```bash
cd D:\92-kameraok\92kamera
npm run dev
```

Default local storage is `DB_DRIVER=json`. On first run it creates
`.data/k92-db.json` from `data/seed.json`, which was copied from the FE
`public/data.json`.

Default admin password is `admin92`. Set `ADMIN_PASSWORD_HASH` to override it.

## DB drivers

Set `DB_DRIVER` in `.env`:

- `json`: file DB for local dev, no external service needed.
- `mongodb`: uses `MONGODB_URI`, `MONGODB_DB`, `kv_store`, `gallery_photos`.
- `supabase`: uses `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- `mysql`: uses `MYSQL_URL` or `MYSQL_HOST/MYSQL_USER/MYSQL_DATABASE`.

MySQL tables are created automatically. SQL reference is in
`database/schema.sql`.

## Storage model

The FE stores most business data through a KV API. These keys are preserved:

- `k92_cameras_v2`
- `k92_accessories_v2`
- `k92_orders_v2`
- `k92_site_v2`
- `k92_feedbacks_v1`
- `k92_users_v1`
- `k92_discounts_v1`
- `k92_albums_v1`
- `k92_delivery_fees_v1`

Public writes are allowed only for orders, discounts, feedbacks, and users.
All other writes require the admin bearer token returned by `/api/auth/login`.

`/api/storage/cas` is used by the booking flow for optimistic locking, so do
not bypass it for orders or discount usage.
