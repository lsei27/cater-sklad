# Cater Sklad - Technical Documentation (agent.md)

Tento dokument slouží jako technický průvodce aplikací **Cater Sklad** pro vývojáře a AI agenty. Popisuje architekturu, databázové schéma, kódovou bázi a procesy.

---

## 🏗 Architektura Projektu

Aplikace je postavena jako **monorepo** s následující strukturou:

- **`apps/api`**: Backend postavený na **Fastify** a **Prisma**.
- **`apps/web`**: Frontend postavený na **React**, **Vite** a **Tailwind CSS**.
- **`packages/shared`**: Sdílené typy a utility mezi backendem a frontendem (pokud se používají).
- **`apps/api/prisma`**: Definice databázového schématu a migrací.

---

## 🛠 Technologie & Závislosti

### Backend (apps/api)
- **Framework**: Fastify 5.8.4 (rychlý a nízkoúrovňový webový framework pro Node.js).
- **ORM**: Prisma 7.6.0 (používá PostgreSQL na Renderu s PrismaPg adapterem).
- **Validace**: Zod 4.3.6 (schémata pro API requesty).
- **Autentizace**: JWT (@fastify/jwt 10.0.0) + Bcrypt 6.0.0 pro hašování hesel.
- **PDF Generování**: `pdf-lib` 1.17.1 (vytváření exportních dokumentů pro sklad).
- **Hlášení změn**: SSE (Server-Sent Events) pro real-time aktualizace skladu.
- **QR Kódy**: `qrcode` 1.5.3 pro generování štítků položek.
- **TypeScript**: 6.0.2
- **Prisma Konfigurace**: Prisma 7 vyžaduje `prisma.config.ts` pro datasource konfiguraci a PrismaPg adapter pro PostgreSQL připojení.

### Frontend (apps/web)
- **UI Framework**: React 19.2.4 + Vite 8.0.3.
- **Styling**: Tailwind CSS 4.2.2 (s @tailwindcss/postcss pluginem) + Vanilla CSS.
- **Routing**: React Router DOM 7.13.2.
- **Ikony**: Lucide React 1.7.0.
- **Komponenty**: Vlastní UI komponenty postavené na základech Radix UI (např. Modals/Dialogs).
- **Modal body layout**: `Modal` podporuje `bodyClassName` pro řízení scrollu a layoutu obsahu u specifických oken.
- **Notifikace**: react-hot-toast 2.6.0.
- **TypeScript**: 6.0.2

---

## 🗄 Databázové Schéma (Prisma)

**⚠️ DŮLEŽITÉ - Prisma 7 Migrace (prosinec 2024):**
- Prisma 7 vyžaduje `prisma.config.ts` soubor pro konfiguraci datasource (místo `url` v `schema.prisma`).
- Prisma Client je generován do custom output path: `../generated/prisma`.
- Všechny importy Prisma klienta musí používat relativní cestu: `../../generated/prisma/client.js` (s `.js` příponou pro ESM).
- PrismaClient vyžaduje PrismaPg adapter pro PostgreSQL připojení (předáno v konstruktoru).
- Linked dependency `db@./generated/prisma` je přidána pro čistší importy (aktuálně nepoužíváno, preferujeme relativní cesty).

Databáze běží na **Supabase (PostgreSQL)** přes Session pooler (IPv4 kompatibilní). Hlavní modely:

### 1. Uživatelé a Role (`User`)
- **Role**: `admin`, `event_manager`, `chef`, `warehouse`.
- **Jméno uživatele**: `User.name` (volitelné, ale v admin UI je nyní vyžadováno při vytvoření uživatele).
- **RoleCategoryAccess**: Definuje, ke kterým kategoriím inventáře má daná role (např. kuchař) přístup.

### 2. Inventář (`InventoryItem`, `Category`)
- Položky jsou organizovány do **kategorií** (např. Kuchyň, Mobiliář, Sklo).
- Kategorie mají stromovou strukturu (`parentId`).
- **InventoryLedger**: Loguje každou změnu stavu skladu (příjem, výdej, korekce).
  - **Automatizace**: Výdej (`issue`) a návrat (`return`) jsou automaticky logovány při změně stavu akce.
  - **Důvody**: Rozšířeno o `issue`, `return`, `conversion`, `audit`.

### 3. Akce (`Event`)
- Hlavní entita pro sledování cateringu.
- **Stavy (`EventStatus`)**:
  - `DRAFT`: Příprava akce manažerem.
  - `READY_FOR_WAREHOUSE`: Legacy stav, aktuálně nepoužívaný ve filtrech UI.
  - `SENT_TO_WAREHOUSE`: Manažer předal seznam položek skladu.
  - `ISSUED`: Sklad vydal věci na akci.
  - `CLOSED`: Věci se vrátily a akce je uzavřena.
  - `CANCELLED`: Akce zrušena.
- **Pracovní časy**: `deliveryDatetime` (kdy má být na místě) a `pickupDatetime` (svoz).
- **Vazba na manažera**: `createdBy` (uživatel, který akci vytvořil). Jméno manažera se zobrazuje v UI i PDF; fallback na email, pokud není name.

### 4. Rezervace a Exporty
- **EventReservation**: Tabulka spojující akce a položky s rezervovaným počtem.
- **EventExport**: Snapshot stavu akce v momentě "předání skladu". Obsahuje `snapshotJson` (kompletní data pro PDF) a verzi.
- **ExportSnapshot**: obsahuje `event.managerName` pro header PDF.

---

## 🚀 Deployment & Provoz

### Render.com
- Backend i Frontend jsou nasazeny na Renderu.
- **Automatický deployment**: Každý push do větve `main` spustí build a deploy.
- **Databáze**: Spravovaná Postgres instance na **Supabase** (přesunuto z Renderu). Backend se připojuje přes Session pooler (IPv4 kompatibilní, connection string v `prisma.config.ts`).
- **Migrace**: Při buildu se spouští `npx prisma migrate deploy`.

### Vercel
- Frontend lze nasazovat i na Vercel (build: `apps/web`, používá `vercel.json`).
- Build příkaz: `pnpm --filter @cater-sklad/web build`.

---

## 🔄 Klíčové Procesy & Logika

### Rezervace a Dostupnost (`apps/api/src/services/`)
- **`availability.ts`**: Počítá dostupnost položky v daném čase. Bere v úvahu celkový fyzický stav a existující rezervace v kolizních časech.
- **`reserve.ts`**: Zajišťuje transakční zápis rezervací. Obsahuje logiku pro zamykání řádků (`pg_advisory_xact_lock`), aby nedošlo k overbookingu.
- **Automatický export po změně**: Pokud je akce `SENT_TO_WAREHOUSE` a kuchyň už potvrdila, přidání položek Event Managerem vytvoří nový export (verze se zvyšuje) a přes SSE se propaguje změna.

### PDF Exporty (`apps/api/src/pdf/exportPdf.ts`)
- Generuje kompaktní tabulku pro skladníky.
- Používá české formátování data a času.
- Vytváří snapshot, takže i když se později změní cena nebo název položky, export zůstává historicky věrný.
- Header obsahuje `Event Manager: <jméno>` (fallback na email).
- Názvy PDF souborů jsou sanitizované kvůli hlavičkám (ASCII safe).
- **Inventory Ledger Automation**: Endpointy `/events/:id/issue` a `/events/:id/return-close` automaticky vytvářejí záznamy v ledgeru pro každý řádek položky, čímž zajišťují reálný přehled o stavu skladu.

### QR Kódy & Štítky
Aplikace umožňuje generování fyzických štítků pro označení inventáře.
- **Formát**: 50x30mm PDF štítek.
- **Obsah**: Název položky, SKU a QR kód s unikátním identifikátorem.
- **Generování**: Knihovna `qrcode` na backendu v rámci služby `exportPdf.ts`.
- **UI**: Tlačítko 🔳 **Štítek** v `InventoryPage` (dostupné pro role `admin` a `warehouse`).

---

## 🔐 Bezpečnost & Role
- **Admin**: Úplný přístup (uživatelé, kategorie, importy).
- **Event Manager**: Vytváří akce, spravuje položky jen ve svých akcích; může upravovat položky i po potvrzení kuchyně (dokud není ISSUED/CLOSED/CANCELLED). Akce může pouze rušit (jen svoje), mazání je jen pro admina.
- **Chef**: Má přístup pouze k položkám v kategorii "Kuchyň". Potvrzuje svou část akce.
- **Warehouse**: Vidí seznam akcí k vydání/svozu, značí vydání a návraty.

---

## 💡 Tipy pro vývoj
- **DB Změny**: Po změně v `schema.prisma` spusťte `npx prisma migrate dev --name <nazev>` (lokálně) nebo se spolehněte na auto-deploy migrace (produkce).
- **Prisma Generate**: Po změnách v schema nebo po aktualizaci Prisma spusťte `npx prisma generate` v `apps/api` pro regeneraci klienta.
- **Prisma 7 Importy**: Všechny importy Prisma klienta musí používat relativní cestu s `.js` příponou: `import { PrismaClient } from "../../generated/prisma/client.js"`.
- **PrismaPg Adapter**: PrismaClient v Prisma 7 vyžaduje adapter v konstruktoru. Používáme `PrismaPg` z `@prisma/adapter-pg` s `pg` Pool instancí.
- **Real-time**: Sklad sleduje změny přes endpoint `/stream`, který posílá notifikace o nových exportech nebo změnách v ledgeru.
- **Měření/Váhy**: Defaultní jednotka je `ks`, ale podporujeme jakékoliv stringové vyjádření jednotky u položky.
- **Event list**: Náhledy akcí jsou v UI seskupené podle stavu (DRAFT nahoře, CLOSED dole) a v rámci sekce podle data. Oddělovače mezi sekcemi používají `border-t border-slate-100` pro jemné vizuální oddělení. Čára pod tlačítky přepínání zobrazení také používá `border-slate-100` pro konzistentní vzhled.
- **UI obrázky**: Miniatury položek se zobrazují při přidávání položek do akce i ve skladovém detailu. Do PDF exportů se obrázky nepřidávají.
- **Add-items modal UX**: Přidání položek v `EventDetailPage` používá tichý refresh, aby modal neprobliknul; na desktopu se roloval pouze seznam skladu vlevo a panel "Položky v akci" zůstává viditelný (scrolluje jen při přetečení).
- **Automatické filtrování ve skladu**: Filtry na stránce skladu (`InventoryPage`) fungují automaticky - při změně kategorie (Typ/Kategorie) nebo při psaní názvu se výsledky načítají okamžitě bez nutnosti klikat na tlačítko. Vyhledávání má 300ms debounce pro optimalizaci API volání. Tlačítko "Obnovit" slouží pro manuální refresh (např. po změně časového rozsahu).
- **Hesla v adminu a nastavení**: V admin UI a na stránce změny hesla je toggle pro zobrazení/skrývání hesla při zadávání.
- **Seed a demo přihlašování**: Hesla pro seed uživatele bereme z env (`ADMIN_SEED_PASSWORD`, `EM_SEED_PASSWORD`, `CHEF_SEED_PASSWORD`, `WAREHOUSE_SEED_PASSWORD`). Demo přepínače na loginu jsou řízené `VITE_DEMO_USERS`.
- **Repo hygiene**: `node_modules`, `generated/` (Prisma Client output) a build cache jsou ignorované a nemají být commitované; po čistění stačí znovu spustit `pnpm install` a `npx prisma generate`.
- **Tailwind CSS 4**: Používá `@tailwindcss/postcss` plugin a `@import "tailwindcss"` v CSS místo `@tailwind` direktiv.
- **Bunny.net CDN**: Obrázky používají protokol `bunny://`, který frontend v `lib/api.ts` převádí na URL CDN (přednastaveno na `caterskladinventory.b-cdn.net`). Vyžaduje `VITE_BUNNY_CDN_URL` v prostředí Vercelu pro případnou změnu.
- **Excel Sync**: Skript `scripts/syncFromExcel.ts` je "source of truth". Při spuštění čistí duplicity a synchronizuje kategorie i položky z `Sklad_new.xlsx`.

---

## 📦 Aktualizace Závislostí (prosinec 2024)

Aktualizace provedena přes Context7 MCP server pro zjištění nejnovějších verzí.

### Backend Aktualizace
- **Fastify**: 5.2.0 → 5.6.2
- **@fastify/cors**: 10.1.0 → 11.2.0 (major)
- **@fastify/multipart**: 9.2.1 → 9.3.0
- **@fastify/static**: 8.2.0 → 9.0.0 (major)
- **Prisma**: 6.19.1 → 7.2.0 (major) - vyžaduje `prisma.config.ts` a PrismaPg adapter
- **@prisma/client**: 6.19.1 → 7.2.0 (major)
- **@prisma/adapter-pg**: 7.2.0 (nový, vyžadován pro Prisma 7)
- **pg**: 8.16.3 (nový, vyžadován pro PrismaPg adapter)
- **bcrypt**: 5.1.1 → 6.0.0 (major)
- **csv-parse**: 5.6.0 → 6.1.0 (major)
- **dotenv**: 16.4.5 → 17.2.3 (major)
- **zod**: 3.25.0 → 4.2.1 (major)
- **typescript**: 5.7.2 → 5.9.3
- **tsx**: 4.19.2 → 4.21.0
- **vitest**: 2.1.8 → 4.0.16 (major)
- **@types/bcrypt**: 5.0.2 → 6.0.0 (major)
- **@types/node**: 22.10.0 → 25.0.3 (major)
- **@types/pg**: 8.16.0 (nový)

### Frontend Aktualizace
- **React**: 18.3.1 → 19.2.3 (major)
- **react-dom**: 18.3.1 → 19.2.3 (major)
- **react-router-dom**: 6.28.0 → 7.11.0 (major)
- **Vite**: 5.4.11 → 7.3.0 (major)
- **@vitejs/plugin-react**: 4.3.3 → 5.1.2 (major)
- **Tailwind CSS**: 3.4.15 → 4.1.18 (major) - vyžaduje `@tailwindcss/postcss`
- **@tailwindcss/postcss**: 4.1.18 (nový, vyžadován pro Tailwind CSS 4)
- **typescript**: 5.7.2 → 5.9.3
- **autoprefixer**: 10.4.20 → 10.4.23
- **postcss**: 8.4.49 → 8.5.6
- **@types/node**: 22.19.3 → 25.0.3 (major)
- **@types/react**: 18.3.12 → 19.2.7 (major)
- **@types/react-dom**: 18.3.1 → 19.2.3 (major)

### Shared Aktualizace
- **zod**: 3.25.0 → 4.2.1 (major)

### Breaking Changes & Migrace
1. **Prisma 7**: 
   - Datasource URL přesunuta z `schema.prisma` do `prisma.config.ts`
   - PrismaClient vyžaduje PrismaPg adapter v konstruktoru
   - Custom output path: `../generated/prisma`
   - Všechny importy musí používat relativní cestu s `.js` příponou

2. **React 19**: 
   - Spuštěny React 19 codemody (žádné změny potřeba - kód byl kompatibilní)
   - TypeScript typy aktualizovány

3. **Tailwind CSS 4**: 
   - PostCSS konfigurace změněna na `@tailwindcss/postcss` plugin
   - CSS import změněn z `@tailwind` direktiv na `@import "tailwindcss"`

4. **Vite 7**: 
   - Hladký upgrade, žádné breaking changes v konfiguraci

### Konfigurační Změny
- **apps/api/prisma.config.ts**: Nový soubor pro Prisma 7 datasource konfiguraci
- **apps/api/prisma/schema.prisma**: Odstraněn `url` z datasource, změněn provider na `prisma-client`, přidán output path
- **apps/web/postcss.config.js**: Změněn plugin z `tailwindcss` na `@tailwindcss/postcss`
- **apps/web/src/styles.css**: Změněn import z `@tailwind` direktiv na `@import "tailwindcss"`
- **.gitignore**: Přidána `generated/` složka pro Prisma Client output

### UX Vylepšení (prosinec 2024)
- **Jemnější oddělovače v UI**: Všechny oddělovače mezi sekcemi a pod tlačítky používají `border-slate-100` místo silnějších čar pro konzistentní a jemnější vzhled.
- **Automatické filtrování ve skladu**: Filtry na stránce skladu (`InventoryPage.tsx`) fungují automaticky:
  - Při změně kategorie (Typ/Kategorie) se výsledky načítají okamžitě
  - Při psaní názvu se filtruje s 300ms debounce pro optimalizaci
  - Tlačítko "Obnovit" slouží pro manuální refresh (např. po změně časového rozsahu)
  - Implementováno pomocí `useCallback` a `useEffect` hooků s refy pro časové parametry

---

## 📦 Aktualizace Závislostí (duben 2026) - Warehouse Ops

Finální fáze integrace skladu a QR logistiky.

### Backend Změny
- **qrcode**: 1.5.3 (nový)
- **pdf-lib**: Použita pro generování 50x30mm štítků.
- **Endpointy**:
  - `GET /inventory/items/:id/label-pdf`: Streaming PDF štítku.
  - `POST /events/:id/issue`: Přidána automatická dedukce ze skladu přes Ledger.
  - `POST /events/:id/return-close`: Přidán automatický návrat do skladu přes Ledger.

### Frontend Změny
- **Icon Library**: Přidána ikona `QrCode` do globální knihovny Icons.
- **Inventory UI**: Přidána tlačítka "Štítek" do dlaždicového i tabulkového zobrazení.
- **CDN API**: Robustnější ošetření `bunny://` fallbacku v `apiUrl`.

### Datová Synchronizace
- **syncFromExcel.ts**: Optimalizováno pro jednosměrný import z Excelu s automatickým párováním obrázků na Bunny.net (slugify name).
