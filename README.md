# Albumklubben.dk

Klubhuset og arkivet for frokostlytteklubben på Thoravej 29: hvert møde, de to albums
der blev lyttet til, plakaterne og medlemmernes nostalgialbums. Siden kører på
https://albumklubben.dk og er kun for medlemmer af klubbens gruppe på
[Theta](https://theta.dk) (log ind med Theta, OIDC).

- **Forsiden** er arkivet: møderne i rækkefølge med covers, kort og plakater.
- **/klubhuset** er et lille 3D-klubhus (three.js) med albummene på hylder efter genre og en bog med plakaterne.
- **/admin** er redigering af møder, albums og plakater, bag sin egen adgangskode.

## Opbygning

| Mappe | Indhold |
| --- | --- |
| `server/` | Fastify-server: API (`/api/archive`), uploads, billedskalering (`/thumb`, `/tex`), admin og login med Theta (`theta-auth.ts`). SQLite via `better-sqlite3`. |
| `web/` | Frontenden (Vite, lit-html, three.js). Bygges til `dist/`, som serveren leverer. |
| `shared/` | Typer og logik som både server og web bruger (genrer, datoer, tracklister). |
| `tools/` | `fetch-tracklists.ts` henter tracklister fra MusicBrainz; `smoke.mjs` er et røgtjek mod en kørende side. |
| `ops/` | Drift: systemd-units, backup, deploy og Caddy. Se [ops/README.md](ops/README.md). |
| `tests/` | Vitest, for server, web og shared. |

TypeScript køres direkte af Node (`--experimental-strip-types`), der er intet build-trin for serveren.

## Data, som ikke er i git

Klubbens rigtige data (`data/`: eksporten fra Figma-prototypen med covers, plakater,
hvem der valgte hvad og deres historier) er personlige oplysninger og ligger derfor
ikke i repoet, heller ikke i historikken. Den ligger på serveren.

- `tests/fixtures/seed/` er en syntetisk erstatning: de samme 22 møder og 44 albums, men
  med ternede covers i albummets kortfarve, ingen plakater og medlemmer der hedder "Medlem 1" osv.
- `tests/fixtures/archive.json` er et `/api/archive`-svar, anonymiseret på samme måde.
- `tests/server/seed.test.ts` kører kun med de rigtige data (`data/` eller `ALBUMKLUBBEN_DATA=<sti>`), ellers springes den over.

## Kom i gang

Kræver Node 22+ og pnpm.

    pnpm install
    cp .env.example .env          # udfyld THETA_* og PUBLIC_URL, se nedenfor
    ALBUMKLUBBEN_DATA=tests/fixtures/seed pnpm seed
    pnpm start                    # serveren på 127.0.0.1:3600
    pnpm exec vite                # frontenden med hot reload, proxy til serveren

Serveren starter ikke uden `THETA_ISSUER`, `THETA_CLIENT_ID`, `THETA_CLIENT_SECRET`,
`THETA_GROUP_ID` og `PUBLIC_URL`: hele siden er kun for gruppens medlemmer. Til lokal
udvikling skal en klient være registreret på en Theta-instans med
`http://localhost:3600/auth/callback` som redirect (se `ops/theta-interop.json`).

Øvrige kommandoer:

    pnpm test        # vitest
    pnpm typecheck   # tsc --noEmit
    pnpm build       # vite build til dist/
    pnpm tracklists --db var/albumklubben.sqlite   # udfyld tomme tracklister fra MusicBrainz

## Drift

Siden kører på `box` (89.167.55.197) som brugeren `niels`, som en systemd user-service
bag den fælles Caddy. Deploy, backup og gendannelse står i [ops/README.md](ops/README.md).
