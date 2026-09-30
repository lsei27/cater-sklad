# Vícedenní akce: položky, balení a výdej po dnech

Datum: 2026-09-30

## Problém

U vícedenní akce se dnes všechny položky rezervují na celou dobu akce a sklad je balí a vydává najednou. V provozu to nesedí:

- Některé věci jsou potřeba jen některý den. V sezoně se třeba výdejové stoly v noci seberou a ráno už musí být na jiné akci. Aplikace je ale drží blokované až do konce akce, takže je EM nemůže dát jinam.
- Stejná položka má v různých dnech různý počet (hlavně Kuchyně): 50 židlí den 1, 120 den 2.
- Obejít to jde jen tak, že se každý den zakládá jako samostatná akce.

Fyzickou logistiku (kdy se co sveze, kam jede přes noc) si sklad řeší sám a aplikace ji evidovat nemá. Cílem je, aby EM viděl v aplikaci **přesnou dostupnost po dnech** a sklad věděl, co balit na který den.

## Současný stav

- `Event` má jeden interval `delivery_datetime` až `pickup_datetime`.
- `EventReservation` je unikátní na (akce, položka), `@@unique([eventId, inventoryItemId])`. Na dvojici „položka → počet“ je postavená rezervace (`reserve.ts`), export a jeho snapshot (`export.ts`, `exportPdf.ts`), potvrzení kuchyně, balení (`event_packing`, unikátní na akce + položka), výdej (`POST /events/:id/issue`), doplňkový výdej, uzavření (`returnClose.ts`) i kopírování akce (`duplicateEvent.ts`).
- Dostupnost (`availability.ts`) bere interval akce: rezervace jiné akce blokuje, pokud se její interval překrývá s cílovou akcí. Virtuální návrat vydaného zboží se počítá od `pickup_datetime` akce plus `return_delay_days` položky.

## Rozhodnutí

Akce zůstává jedna. **Každý řádek položky dostane rozsah dnů** `od dne` až `do dne`. Dostupnost, balení i výdej se řídí rozsahem řádku. Stejná položka může mít v akci víc řádků s různými rozsahy.

### Zvažované alternativy

**Vícedenní akce jako skupina denních akcí.** Dostupnost i výdej by fungovaly bez úprav, ale věci, které zůstávají na místě víc dní, by se musely každý den fiktivně vracet a znovu vydávat. Zamítnuto.

**Jen ruční blokace skladem.** EM by v aplikaci nic nového neviděl. Zamítnuto.

**Jeden počet na položku a rozsah dnů.** Jednodušší, ale počet podle nejsilnějšího dne by zbytečně blokoval sklad v ostatních dnech. Zamítnuto, protože různé počty po dnech jsou běžné.

## Část 1: Data a dostupnost

### Dny akce

Žádné nové pole na akci. Den 1 je kalendářní datum závozu, poslední den je datum svozu, obojí v čase `Europe/Prague`. Počet dnů N = rozdíl dat + 1. Jednodenní akce má N = 1 a chová se jako dnes.

### Řádek rezervace

- Nové sloupce `day_from INT NOT NULL DEFAULT 1` a `day_to INT NULL`. `day_to = NULL` znamená „do konce akce“: když EM akci prodlouží, řádky „celá akce“ se prodlouží s ní. Stávající řádky dostanou `day_from = 1`, `day_to = NULL`, takže se nic nemění.
- Unikátní klíč se mění na (akce, položka, `day_from`, `COALESCE(day_to, 0)`). Prisma výrazový index ve schématu neumí, žije jen v migraci (stejná konvence jako check constraint na `events`). Rezervace se stejným rozsahem se sloučí do jednoho řádku.
- Kontrola: `1 <= day_from <= N` a `day_to IS NULL OR day_from <= day_to <= N`, hlídá ji API.
- Když EM změní termín akce a počet dnů klesne, řádky s `day_to > N` se zkrátí na `N` (a sloučí se s případným řádkem se stejným rozsahem). Řádek s `day_from > N` by celý vypadl mimo akci, proto se úprava termínu zamítne s výčtem dotčených položek.

### Interval řádku

- Začátek: `day_from = 1` znamená čas závozu akce, jinak půlnoc dne `day_from` (Europe/Prague).
- Konec: `day_to = N` znamená čas svozu akce, jinak půlnoc po dni `day_to`.

Výpočet intervalu je jedna sdílená funkce v SQL i v TypeScriptu, pokrytá testy (letní i zimní čas).

### Výpočet dostupnosti

- Jedna sdílená implementace v `availability.ts` pro detail akce i pro skladové přehledy v `inventory.ts`. Dnes jsou to tři kopie téhož SQL.
- Blokace se počítá z intervalů řádků, ne z intervalu akce. Blokující interval řádku jiné akce končí až po `return_delay_days` položky od konce řádku. Dnes rezervace blokuje jen do svozu a prodleva se uplatňuje jen u virtuálního návratu vydaného zboží; s rozpadem po dnech by bez toho šly stoly „jen den 1“ s prodlevou 1 den půjčit hned na den 2, i když se ještě nevrátily.
- Dostupnost je fyzický stav plus virtuální návraty minus **špička souběžného vytížení** v cílovém intervalu. Špička se hledá v bodech, kde začíná některý blokující interval (plus začátek cílového intervalu), ne jako součet všech překryvů. Příklad: 50 ks na dny 1 až 3 a 70 ks jen na den 2 blokuje na den 2 celkem 120, na dny 1 a 3 jen 50. V každém bodě se za akci bere větší hodnota z rezervací a ruční blokace, jako dnes.
- Vyloučení při výpočtu:
  - Rezervace a zobrazení „Volné“ u řádku: vynechá se jen řádek se stejným klíčem (akce, položka, rozsah). Ostatní řádky stejné akce se započítávají, jinak by si dva řádky téže akce navzájem nekontrolovaly kapacitu. Ruční blokace vlastní akce se vynechávají jako dnes.
  - Doplňkový výdej: vynechají se jen ruční blokace vlastní akce, její rezervace dál blokují (vydané dny už neblokují, nevydané drží zboží, které se později vydá bez další kontroly).
  - Skladové přehledy: nic se nevynechává.
- Ruční blokace skladem (`warehouse_blocks`) beze změny: blokují do `blocked_until`.
- Virtuální návrat vydaného zboží: od konce řádku výdeje plus `return_delay_days`. `event_issues` dostane `day_from` a `day_to` (obojí nullable). Plánovaný výdej dne zapisuje rozsah řádku, doplňkový výdej zapisuje `NULL` = celá akce. Stávající řádky výdeje dostanou `day_from = 1`, aby vydané akce vypadaly jako „den 1 vydán“.

### Změna výsledků u stávajících akcí

Výsledky dostupnosti se změní ve dvou případech, obojí směrem k přesnosti:

- Dvě akce, které se v cílovém intervalu nepřekrývají navzájem, už se nesčítají (dnes se sečtou, i když by zboží stihlo přejet).
- Rezervace s nenulovou prodlevou blokuje o prodlevu déle.

### Oprava dvojího odečtu vydaného zboží

Vydaná akce, která se překrývá s cílovým intervalem, dnes snižuje dostupnost dvakrát: výdejem ve fyzickém stavu a znovu svou rezervací (10 ks skladem, 5 ks vydaných na probíhající akci, jiná akce ve stejném termínu vidí 0 volných místo 5). Vícedenní akce by problém zhoršily, proto se opravuje v rámci této změny (rozhodnuto uživatelem):

- Řádek rezervace, ke kterému existuje řádek výdeje typu `issued` se stejným klíčem (akce, položka, `day_from`, `day_to`), už neblokuje. Zboží je odečtené výdejem a zpět se počítá virtuálním návratem.
- Nevydané dny vydané akce blokují dál.
- Akce vydané před změnou mají po migraci výdej `day_from = 1`, `day_to = NULL` a jejich řádky „celá akce“ se tak správně spárují.

## Část 2: Práce v aplikaci

### EM: zadávání položek

- U vícedenní akce je nad panelem přidávání položek volba „Pro dny: od [Den X] do [Den Y]“, výchozí je celá akce. Počty zadané v panelu se ukládají pro zvolený rozsah a zobrazená dostupnost platí pro ten rozsah. Jinak se panel nemění.
- Seznam položek akce seskupuje řádky podle rozsahu: „Celá akce“, „Den 1“, „Dny 2–3“…
- API `POST /events/:id/reserve` dostane u položky volitelné `day_from` a `day_to`. Bez nich platí celá akce, takže stávající volání fungují dál.
- Jednodenní akce volbu dnů nezobrazuje.

### Export, PDF, potvrzení kuchyně

- Snapshot exportu nese u řádku `dayFrom` a `dayTo`. Staré snapshoty bez nich se čtou jako celá akce.
- PDF u vícedenní akce dělí položky do oddílů „Balit na den N“ podle `day_from`, tedy podle dne, kdy musí řádek odjet ze skladu.
- Příznak revize exportu porovnává řádky včetně dnů.

### Sklad: balení a výdej

- Detail akce pro sklad má přepínač dnů. Den N ukazuje řádky s `day_from = N`.
- `event_packing` dostane `day_from` a `day_to` se stejnou sémantikou a stejným výrazovým unikátním indexem jako rezervace.
- `POST /events/:id/issue` dostane parametr dne. Výdej dne 1 přepne akci do stavu Vydáno jako dnes. Výdej dalších dnů je povolený i ve stavu Vydáno, dokud má akce nevydané dny. Opakovaný výdej už vydaného dne je idempotentní (vrátí stav, nic nezapíše).
- Balení dalších dnů je povolené i ve stavu Vydáno.
- Kontrola duplicit při výdeji se dělá na (položka, rozsah dnů), ne jen na položku.

- Vydané dny = rozlišné `day_from` řádků výdeje typu `issued`. Doplňkový výdej (`day_from = NULL`) se nepočítá.

### Změny po vydání dne 1

Plán se po prvním výdeji zamyká jako dnes. Změny jdou přes doplňkový výdej, který o dnech neví a blokuje do konce akce. Vědomý kompromis, rozhodnuto uživatelem.

### Vrácení a uzavření

Beze změny: jedno uzavření na konci akce. Vydané počty se pro vracení sčítají přes všechny řádky položky.

### Kopírování akce

Kopíruje řádky včetně dnů. Má-li nová akce méně dnů, řádky se ořízne na její poslední den a řádky zcela mimo rozsah se vynechají s upozorněním.

## Testování

Integrační testy proti testovací DB (stávající vzor `test/*.integration.test.ts`):

- Stoly jen den 1 s nulovou prodlevou jsou volné pro jinou akci začínající dnem 2.
- 50 ks dny 1 až 3 + 70 ks den 2 blokují 120 jen na den 2, na dnech 1 a 3 zbývá kapacita.
- Dva řádky téže akce nepřekročí dohromady fyzický stav.
- Jednodenní akce bez prodlevy dávají stejné výsledky dostupnosti jako před změnou, kromě opraveného dvojího odečtu.
- Vydaná překrývající se akce už neodečítá zboží dvakrát, nevydaný den vydané akce blokuje dál.
- Rezervace s prodlevou 1 den blokuje i den po svozu.
- Výdej po dnech: den 1 přepne stav, den 2 jde vydat ve stavu Vydáno, opakovaný výdej dne nic nezapíše.
- Virtuální návrat po výdeji se počítá od konce řádku.
- Uzavření sečte vydané řádky jedné položky.
- Kopírování akce na kratší akci ořízne řádky.
- Jednotkové testy intervalu dne včetně přechodu na letní a zimní čas.

## Mimo rozsah

- Evidence fyzických svozů a vracení po dnech.
- Vlastní časy závozu a svozu pro jednotlivé dny (hranice dne je půlnoc).
- Úprava plánu pozdějších dnů po vydání dne 1.
