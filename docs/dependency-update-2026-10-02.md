# Aktualizace závislostí — 2. 10. 2026

Změna připravená na větvi `chore/dependency-updates-2026-10-02`, bez nasazení do produkce. Prioritou je zachování chování produkční aplikace; změněny jsou manifesty a lockfile, nikoli zdrojový kód, konfigurace aplikace nebo databázové migrace.

## Přímé závislosti

| Balíček | Před | Po |
| --- | --- | --- |
| `@fastify/multipart` | 10.1.1 | 10.1.2 |
| `@fastify/static` | 10.1.3 | 10.1.5 |
| `csv-parse` | 7.0.2 | 7.0.3 |
| `fastify` | 5.12.1 | 5.12.5 |
| `pg` | 8.23.0 | 8.23.1 |
| `tsx` | 4.23.12 | 4.23.15 |
| `@vitejs/plugin-react` | 6.1.0 | 6.1.1 |
| `postcss` | 8.5.26 | 8.5.28 |
| `react-hot-toast` | 2.6.0 | 2.6.1 |
| `react-router-dom` | 7.18.2 | 7.18.4 |

Obnoveny také kompatibilní nepřímé závislosti, zejména `fast-uri` 3.1.6 → 3.1.8 a 4.1.3 → 4.2.1, `ip-address` 10.5.0 → 10.7.3 a `brace-expansion` 5.0.9 → 5.0.12. Plugin `@fastify/static` nově vyžaduje `content-disposition` 3.0.0 s Node.js >=22; odpovídá to zdokumentovanému produkčnímu Node.js 22.16.0 v `render.yaml` i lokálnímu Node.js 24.8.0. Aktuální nastavení vzdáleného runtime nebylo znovu ověřováno.

## Ověření

- Před změnou prošel build a 83 testů; 68 databázových testů bylo bez testovací databáze přeskočeno.
- Po změně prošla instalace `pnpm install --frozen-lockfile --strict-peer-dependencies`.
- `pnpm build` prošel pro shared, API i web. Varování o JS chunku >500 kB bylo přítomné již před aktualizací.
- Všech 151 testů prošlo: API 129 a web 22. Zahrnuje všech 68 databázových integračních testů; žádný test nebyl přeskočen.
- Integrační testy použily nový dočasný PostgreSQL 16 na localhostu, na který bylo aplikováno všech 21 existujících migrací. Produkční databáze nebyla použita. Testovací kontejner byl po ověření odstraněn.
- Smoke test skutečného zkompilovaného API prošel: start, health, přihlášení přes bcrypt, JWT, chráněné endpointy, validace, CORS, statické soubory a limit přihlašovacích pokusů.
- CSS soubor po buildu je bajtově shodný s výchozím buildem (`index-DLQ0SBTN.css`). Neproběhla kompletní vizuální ani prohlížečová E2E kontrola všech uživatelských postupů.
- `git diff --check` prošel.

## Security Exception

Audit se zlepšil z 22 nálezů (12 high, 10 moderate) na 3 (2 high, 1 moderate), bez potlačení upozornění a bez vynucených overrides. Zbývají závislosti přesně připnuté v Prisma CLI 7.10.0:

- `deepmerge-ts` 7.1.5: [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), high; oprava vyžaduje novou hlavní verzi >=8.0.0.
- `mysql2` 3.15.3: [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr), high; opraveno >=3.22.0.
- `mysql2` 3.15.3: [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3), moderate; opraveno >=3.23.1.

Aplikace používá PostgreSQL adapter. To samo o sobě nepotvrzuje nevyužitelnost všech nálezů Prisma CLI. Tyto nálezy nejsou nové; nebylo bezpečné měnit interní přesné závislosti Prisma mimo její vlastní kompatibilní vydání. Při případném PR přenést tento oddíl do popisu a sledovat opravenou stabilní verzi Prisma.

## Záměrně odložené přechody

Prisma CLI, klient a PostgreSQL adapter zůstávají společně na 7.10.0. Registr u Prisma CLI označuje jako `latest` verzi 8.0.0-rc.19; RC nebyla nainstalována. Vitest 5, dotenv 18 a typy Node.js 26 byly odloženy jako hlavní přechody.

React/React DOM a jejich typy zůstávají na řadě 19.2. [React 19.3](https://github.com/react/react/releases/tag/v19.3.0) mění mimo jiné chování číselných vstupů a formulářů; vyžaduje samostatné ověření UI. Zod zůstává na 4.4.3, protože [novější vydání](https://github.com/colinhacks/zod/releases) mění implementaci parsování a některé okrajové případy. Stejně byly odloženy nové minor řady Vite, Lucide, Tailwind Merge a Autoprefixer, aby se nerozšiřoval rozsah změn chování, ikon nebo stylů.

Použit Context7 pro dokumentaci pnpm, Prisma a Vite: aktualizace v semver rozsazích, synchronizace Prisma balíčků/generování klienta a runtime požadavky Vite. Dostupné verze a přesné závislosti byly ověřeny přímo v npm registru.

Testy neprokazují absolutní absenci regresí. Před nasazením je vhodná kontrola skutečného produkčního runtime a hlavních uživatelských postupů v preview/staging prostředí; produkce nebyla v rámci této změny upravena.
