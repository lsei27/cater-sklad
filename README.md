# Cater sklad (MVP)

Monorepo: `apps/api` (Fastify + Prisma) + `apps/web` (React + Vite) + `packages/shared`.

## Start

1) DB

```bash
docker compose up -d db
```

2) API

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm --filter @cater-sklad/api prisma generate
pnpm --filter @cater-sklad/api prisma migrate deploy
pnpm --filter @cater-sklad/api prisma db seed
pnpm --filter @cater-sklad/api dev
```

3) Web

```bash
pnpm --filter @cater-sklad/web dev
```

Web běží na `http://localhost:3000`, API na `http://localhost:3001`.
Pro nasazení nastav ve webu `VITE_API_BASE_URL` (např. Render URL API).

## Deploy (Vercel)

Doporučené nastavení pro monorepo s `workspace:*`:
- Project root: repo root
- Install: `pnpm install --frozen-lockfile --prod=false`
- Build: `pnpm --filter @cater-sklad/web build`
- Output: `apps/web/dist`
- Env: `VITE_API_BASE_URL=https://<render-api>`

Seed účty:
- `admin@local` / `admin123`
- `em@local` / `em123`
- `chef@local` / `chef123`
- `warehouse@local` / `wh123`

## API examples (curl)

### Login

```bash
curl -s http://localhost:3001/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@local","password":"admin123"}'
```

Ulož token:

```bash
TOKEN="$(curl -s http://localhost:3001/auth/login -H 'content-type: application/json' -d '{"email":"admin@local","password":"admin123"}' | jq -r .token)"
```

### Create event (admin/EM)

```bash
curl -s http://localhost:3001/events \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"Firemní večírek","location":"Praha","delivery_datetime":"2025-01-20T10:00:00.000Z","pickup_datetime":"2025-01-21T10:00:00.000Z"}'
```

### Reserve items (anti-oversell, TX + advisory lock)

```bash
curl -s http://localhost:3001/events/<EVENT_ID>/reserve \
  -H "authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"items":[{"inventory_item_id":"<ITEM_ID>","qty":5}]}'
```

### Confirm chef (chef/admin)

```bash
CHEF_TOKEN="$(curl -s http://localhost:3001/auth/login -H 'content-type: application/json' -d '{"email":"chef@local","password":"chef123"}' | jq -r .token)"
curl -s http://localhost:3001/events/<EVENT_ID>/confirm-chef \
  -H "authorization: Bearer $CHEF_TOKEN" \
  -d '{}'
```

### Export PDF (admin/EM)

```bash
curl -s http://localhost:3001/events/<EVENT_ID>/export \
  -H "authorization: Bearer $TOKEN" \
  -d '{}'
```

### Issue (warehouse/admin)

```bash
WH_TOKEN="$(curl -s http://localhost:3001/auth/login -H 'content-type: application/json' -d '{"email":"warehouse@local","password":"wh123"}' | jq -r .token)"
curl -s http://localhost:3001/events/<EVENT_ID>/issue \
  -H "authorization: Bearer $WH_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"idempotency_key":"issue-1"}'
```

### Return + close (warehouse/admin)

```bash
curl -s http://localhost:3001/events/<EVENT_ID>/return-close \
  -H "authorization: Bearer $WH_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"idempotency_key":"close-1","items":[{"inventory_item_id":"<ITEM_ID>","returned_quantity":3,"broken_quantity":0}]}'
```

### Import CSV (admin)

```bash
curl -s http://localhost:3001/admin/import/csv \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: text/plain" \
  --data-binary $'name;parent_category;category;quantity;return_delay_days;unit;sku;active;notes;image_url\nSklenice voda;Inventář;Sklo;50;0;ks;SKLO-NEW;true;;\n'
```

## Tests

Unit test overlap:
```bash
pnpm --filter @cater-sklad/api test
```

DB integration tests (vyžaduje běžící Postgres + migrace):
```bash
export RUN_DB_TESTS=1
pnpm --filter @cater-sklad/api test
```
