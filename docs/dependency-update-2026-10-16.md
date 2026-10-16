# Aktualizace závislostí, 16. 10. 2026

Změna připravená na větvi `chore/dependency-updates-2026-10-16`, bez nasazení do produkce. Mění se jen manifesty a lockfile, ne zdrojový kód, konfigurace aplikace ani databázové migrace. Aktualizovány jsou pouze opravné (patch) verze.

## Přímé závislosti

| Balíček | Před | Po |
| --- | --- | --- |
| `@fastify/cors` | 11.3.0 | 11.3.1 |
| `@fastify/jwt` | 10.2.2 | 10.2.4 |
| `@fastify/multipart` | 10.1.2 | 10.1.4 |
| `@fastify/rate-limit` | 11.2.0 | 11.2.1 |
| `@fastify/static` | 10.1.5 | 10.1.6 |
| `@prisma/adapter-pg` | 7.10.0 | 7.10.1 |
| `@prisma/client` | 7.10.0 | 7.10.1 |
| `prisma` | 7.10.0 | 7.10.1 |
| `fastify` | 5.12.5 | 5.12.7 |
| `fastify-plugin` | 6.0.0 | 6.0.1 |
| `@vitejs/plugin-react` | 6.1.1 | 6.1.2 |
| `postcss` | 8.5.28 | 8.5.30 |

Prisma CLI, klient a PostgreSQL adapter se posunuly společně, jak doporučuje dokumentace Prisma (ověřeno přes Context7), a klient byl znovu vygenerován.

## Bezpečnost

`pnpm audit`: z 5 nálezů (3 high, 2 moderate) na 0, bez overrides a bez potlačení.

- `deepmerge-ts` 7.1.5 → 8.0.2 (GHSA-ggr8-5vv4-36mx, high), přes Prisma 7.10.1.
- `mysql2` 3.15.3 → 3.24.4 (GHSA-3f6p-5ww8-9rcr high, GHSA-rgwj-5xj2-c3m3 moderate), přes Prisma 7.10.1.
- `fast-jwt` 6.3.2 → 6.3.5 (GHSA-x937-hj6v-793p, moderate), v rozsahu `@fastify/jwt`.
- `source-map-js` 1.2.1 → 1.2.2 (GHSA-68fv-2mgg-jv7q, high), v rozsahu `@tailwindcss/node`, jen build webu.

Tím je uzavřen i oddíl Security Exception z aktualizace 2. 10. 2026.

## Ověření

- Před změnou i po ní prošlo všech 156 testů (API 134, web 22), včetně 70 integračních testů na dočasném PostgreSQL 16 v Dockeru, na který byly aplikovány všechny migrace. Produkční databáze nebyla použita, kontejner byl po testech odstraněn.
- `pnpm install --frozen-lockfile --strict-peer-dependencies` prošel.
- Build shared, API i webu prošel. Výstup `apps/web/dist` i `apps/api/dist` je bajtově shodný s buildem před aktualizací.
- Smoke test zkompilovaného API: health, přihlášení přes bcrypt, JWT (platný, chybějící, podvržený token), validace, CORS (produkční origin povolen, cizí ne) a limit přihlášení (11. pokus vrací 429). V logu žádné chyby.
- Nové nepřímé závislosti vyžadují nejvýše Node.js >=22 (`cookie` 2.0.1), což odpovídá `.node-version` 22.23.2.

## Záměrně odložené

Stejně jako minule zůstávají beze změny nové minor řady, které mohou měnit chování UI: React/React DOM 19.3 a jejich typy, `@radix-ui/react-dialog` 1.3, `lucide-react` 1.57, `tailwind-merge` 3.7, `autoprefixer` 10.6 a Vite 8.3. Prisma 8 je stále jen RC. Vyplatí se je projít samostatně s ručním testem UI v preview prostředí.

Prisma 7.10.1 si jako volitelnou peer závislost pro Studio dotahuje `@types/react` 19.3.0; jde jen o dev nástroje API, web dál používá 19.2.18.
