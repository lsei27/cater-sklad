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
- **Modal body layout**: `Modal` podporuje `bodyClassName` pro řízení scrollu a layoutu obsahu u specifických oken.
- **Notifikace**: react-hot-toast.

---

## 🗄 Databázové Schéma (Prisma)

Databáze běží na **Renderu (PostgreSQL)**. Hlavní modely:

### 1. Uživatelé a Role (`User`)
- **Role**: `admin`, `event_manager`, `chef`, `warehouse`.
- **Jméno uživatele**: `User.name` (volitelné, ale v admin UI je nyní vyžadováno při vytvoření uživatele).
- **RoleCategoryAccess**: Definuje, ke kterým kategoriím inventáře má daná role (např. kuchař) přístup.

### 2. Inventář (`InventoryItem`, `Category`)
- Položky jsou organizovány do **kategorií** (např. Kuchyň, Mobiliář, Sklo).
- Kategorie mají stromovou strukturu (`parentId`).
- **InventoryLedger**: Loguje každou změnu stavu skladu (příjem, výdej, korekce).

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
- **Databáze**: Spravovaná Postgres instance na Renderu.
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

---

## 🔐 Bezpečnost & Role
- **Admin**: Úplný přístup (uživatelé, kategorie, importy).
- **Event Manager**: Vytváří akce, spravuje položky jen ve svých akcích; může upravovat položky i po potvrzení kuchyně (dokud není ISSUED/CLOSED/CANCELLED). Akce může pouze rušit (jen svoje), mazání je jen pro admina.
- **Chef**: Má přístup pouze k položkám v kategorii "Kuchyň". Potvrzuje svou část akce.
- **Warehouse**: Vidí seznam akcí k vydání/svozu, značí vydání a návraty.

---

## 💡 Tipy pro vývoj
- **DB Změny**: Po změně v `schema.prisma` spusťte `npx prisma migrate dev --name <nazev>` (lokálně) nebo se spolehněte na auto-deploy migrace (produkce).
- **Real-time**: Sklad sleduje změny přes endpoint `/stream`, který posílá notifikace o nových exportech nebo změnách v ledgeru.
- **Měření/Váhy**: Defaultní jednotka je `ks`, ale podporujeme jakékoliv stringové vyjádření jednotky u položky.
- **Event list**: Náhledy akcí jsou v UI seskupené podle stavu (DRAFT nahoře, CLOSED dole) a v rámci sekce podle data.
- **UI obrázky**: Miniatury položek se zobrazují při přidávání položek do akce i ve skladovém detailu. Do PDF exportů se obrázky nepřidávají.
- **Add-items modal UX**: Přidání položek v `EventDetailPage` používá tichý refresh, aby modal neprobliknul; na desktopu se roloval pouze seznam skladu vlevo a panel "Položky v akci" zůstává viditelný (scrolluje jen při přetečení).
