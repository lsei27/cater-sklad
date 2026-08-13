# Skladník může doplňovat položky do cizí akce

Datum: 2026-08-13

## Problém

Event manager v sezoně dokončí akci a odjede do terénu. Odtud telefonuje na sklad, že do akce potřebuje ještě něco přihodit. Skladník to dnes nemá jak udělat: aplikace mu přidávání položek povolí jen u akcí, které sám založil.

Situace nastává ve dvou stavech akce a každý potřebuje jiné řešení:

- **Předáno skladu**, výdej ještě neproběhl.
- **Vydáno**, zboží se nakládá nebo už odjelo.

## Současný stav

Backend skladníka ve skutečnosti nikde neblokuje. `POST /events/:id/reserve` (`events.ts:569`) má v povolených rolích `warehouse` a vlastnictví akce vůbec neřeší. Totéž `POST /events/:id/export` a `PATCH /events/:id`. Kontrola vlastnictví existuje jen na dvou místech, a ani jedno k přihození položky nepotřebujeme:

- `events.ts:237` — zrušení akce
- `events.ts:679` — potvrzení kuchyně

Blokuje to výhradně frontend přes `canManageEvent` v `EventDetailPage.tsx:164`.

Stav Vydáno blokuje i backend, a to správně: `reserveItemsTx` shodí `EVENT_READ_ONLY` pro `ISSUED`, `CLOSED` i `CANCELLED` (`reserve.ts:28`).

## Rozhodnutí

Skladník dostává na cizí akci **stejná práva jako admin**, tedy může položky přidávat i měnit jejich množství včetně položek zadaných event managerem. Stav Uzavřeno a Zrušeno zůstává zamčený pro všechny.

U vydané akce se přidání řeší jako **doplňkový výdej**, ne jako rezervace. Odpovídá to tomu, co se fyzicky děje: zboží teď odchází ze skladu.

### Zvažované alternativy

**Vrátit akci zpět do stavu Předáno skladu.** Muselo by stornovat výdej, tedy otočit skladové pohyby a smazat řádky výdeje, pak přidat a vydat znovu. Recykluje stávající tok, ale obrací pohyby u zboží, které už fyzicky odjelo. Zamítnuto.

**Přidávat do rezervací i u vydané akce a druhým průchodem výdeje dohnat rozdíl.** Nejvíc účetnictví navíc a nejvíc míst, kde se stav může rozejít. Zamítnuto.

## Část 1: Cizí akce před výdejem

Čistě frontend, čtyři místa. Backend beze změny.

| Soubor | Místo | Změna |
|---|---|---|
| `EventDetailPage.tsx` | `canManageEvent`, ř. 164 | `warehouse` má stejná práva jako `admin` |
| `EventDetailPage.tsx` | deep link `?addItems=1`, ř. 102 | vypustit `warehouse` z kontroly vlastnictví |
| `EventDetailPage.tsx` | editace řádku, ř. 570 | skladník smí editovat i cizí řádky |
| `WarehouseEventDetailPage.tsx` | tlačítko „Upravit akci a položky", ř. 457 | zobrazit skladníkovi bez ohledu na vlastnictví |

Po přidání platí dnešní chování beze změny: nastaví se `exportNeedsRevision` a pokud kuchyň už potvrdila, vygeneruje se nový export automaticky (`events.ts:615`).

## Část 2: Doplňkový výdej u vydané akce

### Endpoint

`POST /events/:id/issue-additional`

- Role: `admin`, `warehouse`
- Akce musí být ve stavu `ISSUED`, jinak `409 BAD_STATUS`

Kontrola data akce v minulosti se **nepoužije**, na rozdíl od `reserve`. Tam dává smysl nebránit plánování do minulosti, tady by ale zablokovala přesně ten případ, kvůli kterému funkce vzniká: akci, která právě běží nebo doběhla včera a sklad na ni ještě dováží. Stav `ISSUED` je jako pojistka dostatečný, protože uzavřená akce už doplňkový výdej nepřijme.

Tělo požadavku:

```json
{
  "idempotency_key": "string",
  "warehouse_id": "uuid (nepovinné)",
  "pallet_count": 3,
  "items": [{ "inventory_item_id": "uuid", "qty": 5 }]
}
```

`pallet_count` je nepovinné. Když chybí, počet palet u akce zůstane nezměněný.

V jedné transakci:

1. Zámek akce přes `SELECT ... FOR UPDATE`, ověření stavu.
2. Pro každou položku `pg_advisory_xact_lock` stejně jako v `reserveItemsTx`.
3. Kontrola dostupnosti přes `getAvailabilityForEventItemTx`. Při nedostatku `409 INSUFFICIENT_STOCK` s polem `available`, stejný tvar jako u `reserve`.
4. Nový řádek do `event_issues` s `type: "issued"` a idempotency klíčem `${idempotency_key}:${eventId}:${itemId}`.
5. Odpis do ledgeru, `deltaQuantity: -qty`, `reason: issue`, poznámka „Doplňkový výdej na akci".
6. Přepočet váhy akce, viz níže.
7. Zápis do `audit_log` s akcí `issue_additional`.

Sklad položky se určí stejně jako u `/issue`: `warehouse_id` z požadavku, jinak výchozí sklad položky, jinak `409 WAREHOUSE_REQUIRED` (`requireWarehouseId`).

Stávající `/events/:id/issue` se nepoužívá záměrně. Ten překlápí stav z Předáno skladu na Vydáno a bere položky z exportu, což je jiná úloha.

### Přepočet váhy

Váha se **přepočítá z celé akce**, ne přičtením váhy přírůstku. Důvod je zaokrouhlování na celá master balení: když se položka vydá nejdřív 10 kusů a pak 5 a v balení je 12, počítáno po dávkách vyjdou 2 balení a stejně tak z celku 15 kusů, ale u jiných čísel se výsledky rozejdou.

Postup: posčítat `issued_quantity` po položkách přes všechny řádky `event_issues` s `type = 'issued'`, teprve pak dopočítat počet balení a váhu.

Výpočet se vytáhne ze `events.ts` do sdílené funkce v `apps/api/src/services/`, kterou budou používat `/issue` i `/issue-additional`. Pro původní výdej se chování nemění, tam je na položku právě jeden řádek.

### Napojení na uzavření akce

Seznam položek u vydané akce se dnes bere z exportu (`events.ts:286`, `warehouseItems`), takže doplňkově vydaná položka by v uzavírací obrazovce chyběla a uzavření by spadlo na `ITEMS_INCOMPLETE` (`returnClose.ts:60`).

Řešení: u akcí ve stavu `ISSUED` se `warehouseItems` postaví z `event_issues` místo z exportu. Dotaz už v kódu existuje jako záložní větev pro případ prázdného exportu (`events.ts:299`), stane se z něj hlavní zdroj pro tento stav.

Uzavírání akce žádnou další úpravu nepotřebuje. `returnCloseTx` sčítá vydané množství přes `SUM(issued_quantity) GROUP BY inventory_item_id`, takže víc řádků výdeje na jednu položku zvládne samo.

### UI

Na `WarehouseEventDetailPage` přibude u akce ve stavu Vydáno tlačítko „Vydat navíc". Otevře stávající výběr položek. Po potvrzení se seznam i váha akce načtou znovu.

## Testy

Integrační test v `apps/api/test/`:

1. Vydat akci, přidat doplňkový výdej, ověřit vznik druhého řádku v `event_issues` a odpis v ledgeru.
2. Uzavřít akci a ověřit, že se sečetlo vydané množství z obou výdejů a správně se dopočítaly vratky i ztráty.
3. Doplňkový výdej nad rámec dostupné zásoby skončí na `INSUFFICIENT_STOCK`.
4. Doplňkový výdej do akce, která není ve stavu Vydáno, skončí na `BAD_STATUS`.

Test na přepočet váhy: dvě dávky téže položky, ověřit, že se váha počítá ze součtu množství, ne po dávkách.

## Mimo rozsah

- Nový export ani PDF u doplňkového výdeje. Sklad má u vydané akce zboží fyzicky u sebe a checklist už odškrtaný.
- Notifikace event managerovi. Změna se zapisuje do `audit_log` a u rezervací je vidět, kdo je založil.
- Doplňkový výdej u uzavřené a zrušené akce.
