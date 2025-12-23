# Cater Sklad - Technical Documentation (agent.md)

Tento dokument slouží jako technický průvodce aplikací **Cater Sklad** pro vývojáře a AI agenty. Popisuje architekturu, databázové schéma, kódovou bázi a procesy.

---

## 🏗 Architektura Projektu

Aplikace je postavena jako **monorepo** s následující strukturou:

- **`apps/api`**: Backend postavený na **Fastify** a **Prisma**.
- **`apps/web`**: Frontend postavený na **React**, **Vite** a **Tailwind CSS**.
- **`apps/shared`**: (Pokud existuje) Sdílené typy a utility mezi backendem a frontendem.
- **`prisma/`**: Definice databázového schématu a migrací.

---

## 🛠 Technologie & Závislosti

### Backend (apps/api)
- **Framework**: Fastify (rychlý a nízkoúrovňový webový framework pro Node.js).
- **ORM**: Prisma (používá PostgreSQL na Renderu).
- **Validace**: Zod (schémata pro API requesty).
- **Autentizace**: JWT (@fastify/jwt) + Bcrypt pro hašování hesel.
- **PDF Generování**: `pdf-lib` (vytváření exportních dokumentů pro sklad).
- **Hlášení změn**: SSE (Server-Sent Events) pro real-time aktualizace skladu.

### Frontend (apps/web)
- **UI Framework**: React + Vite.
- **Styling**: Tailwind CSS + Vanilla CSS.
- **Routing**: React Router DOM.
- **Ikony**: Lucide React.
- **Komponenty**: Vlastní UI komponenty postavené na základech Radix UI (např. Modals/Dialogs).

---

## 🗄 Databázové Schéma (Prisma)

Databáze běží na **Renderu (PostgreSQL)**. Hlavní modely:

### 1. Uživatelé a Role (`User`)
- **Role**: `admin`, `event_manager`, `chef`, `warehouse`.
- **RoleCategoryAccess**: Definuje, ke kterým kategoriím inventáře má daná role (např. kuchař) přístup.

### 2. Inventář (`InventoryItem`, `Category`)
- Položky jsou organizovány do **kategorií** (např. Kuchyň, Mobiliář, Sklo).
- Kategorie mají stromovou strukturu (`parentId`).
- **InventoryLedger**: Loguje každou změnu stavu skladu (příjem, výdej, korekce).

### 3. Akce (`Event`)
- Hlavní entita pro sledování cateringu.
- **Stavy (`EventStatus`)**:
  - `DRAFT`: Příprava akce manažerem.
  - `SENT_TO_WAREHOUSE`: Manažer předal seznam položek skladu.
  - `ISSUED`: Sklad vydal věci na akci.
  - `CLOSED`: Věci se vrátily a akce je uzavřena.
  - `CANCELLED`: Akce zrušena.
- **Pracovní časy**: `deliveryDatetime` (kdy má být na místě) a `pickupDatetime` (svoz).

### 4. Rezervace a Exporty
- **EventReservation**: Tabulka spojující akce a položky s rezervovaným počtem.
- **EventExport**: Snapshot stavu akce v momentě "předání skladu". Obsahuje `snapshotJson` (kompletní data pro PDF) a verzi.

---

## 🚀 Deployment & Provoz

### Render.com
- Backend i Frontend jsou nasazeny na Renderu.
- **Automatický deployment**: Každý push do větve `main` spustí build a deploy.
- **Databáze**: Spravovaná Postgres instance na Renderu.
- **Migrace**: Při buildu se spouští `npx prisma migrate deploy`.

---

## 🔄 Klíčové Procesy & Logika

### Rezervace a Dostupnost (`apps/api/src/services/`)
- **`availability.ts`**: Počítá dostupnost položky v daném čase. Bere v úvahu celkový fyzický stav a existující rezervace v kolizních časech.
- **`reserve.ts`**: Zajišťuje transakční zápis rezervací. Obsahuje logiku pro zamykání řádků (`pg_advisory_xact_lock`), aby nedošlo k overbookingu.

### PDF Exporty (`apps/api/src/pdf/exportPdf.ts`)
- Generuje kompaktní tabulku pro skladníky.
- Používá české formátování data a času.
- Vytváří snapshot, takže i když se později změní cena nebo název položky, export zůstává historicky věrný.

---

## 🔐 Bezpečnost & Role
- **Admin**: Úplný přístup (uživatelé, kategorie, importy).
- **Event Manager**: Vytváří akce, spravuje svůj inventář.
- **Chef**: Má přístup pouze k položkám v kategorii "Kuchyň". Potvrzuje svou část akce.
- **Warehouse**: Vidí seznam akcí k vydání/svozu, značí vydání a návraty.

---

## 💡 Tipy pro vývoj
- **DB Změny**: Po změně v `schema.prisma` spusťte `npx prisma migrate dev --name <nazev>` (lokálně) nebo se spolehněte na auto-deploy migrace (produkce).
- **Real-time**: Sklad sleduje změny přes endpoint `/stream`, který posílá notifikace o nových exportech nebo změnách v ledgeru.
- **Měření/Váhy**: Defaultní jednotka je `ks`, ale podporujeme jakékoliv stringové vyjádření jednotky u položky.
