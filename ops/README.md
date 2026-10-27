# Albumklubben: drift paa box

Siden koerer paa `box` (89.167.55.197, `ssh niels@89.167.55.197`) som brugeren `niels`
(sudo uden adgangskode, kun SSH-noegle). Flyttet fra theta-dev den 2026-10-27; det gamle
navn albumklubben.dn.osogdata.dk 301-redirecter til https://albumklubben.dk.

## Opbygning

| Hvad | Hvor |
| --- | --- |
| Repo | `~/albumklubben` (`main`, remote `origin` = github.com/NielsOerbaek/albumklubben.dk) |
| Koerende kode | detached git worktree `~/albumklubben-live` (egen `node_modules`, `dist/`, `.env`) |
| Data | `~/albumklubben-data/` (mode 700): `albumklubben.sqlite` og `uploads/{covers,posters,videos}` |
| Seed-data | `~/albumklubben/data/` (gitignored, ikke paa GitHub): Figma-eksporten med medlemmernes valg. Kun til `pnpm seed` og `tests/server/seed.test.ts`. |
| Hemmeligheder | `~/albumklubben-live/.env` (`ADMIN_PASSWORD`, `SESSION_SECRET`, `THETA_ISSUER`, `THETA_CLIENT_ID`, `THETA_CLIENT_SECRET`, `THETA_GROUP_ID`, `PUBLIC_URL`, `PORT`, `HOST`, `DB_PATH`, `UPLOAD_DIR`). Aldrig i git. |
| Backups | `~/albumklubben-backups/<AAAA-MM-DD>/` (mode 700, indeholder personlige fotos), de nyeste 14 beholdes |
| Tjeneste | user-unit `albumklubben.service` (linger er slaaet til), node er systemets `/usr/bin/node` |
| Backup | user-units `albumklubben-backup.service` + `.timer` (hver nat 03:30, `Persistent=true`) |

Alle tre units er symlinks fra `~/.config/systemd/user/` til live-worktree'ets `ops/`, saa en
deploy der aendrer dem kraever `systemctl --user daemon-reload`.

## Caddy

Caddy koerer i Docker (`/opt/caddy`, se `/root/CLAUDE.md`) og ejer port 80/443 for alle sider
paa maskinen. Blokken for albumklubben.dk staar i `/opt/caddy/Caddyfile`; `Caddyfile.example`
her er den samme. Containeren naar appen via `host.docker.internal`, derfor lytter appen paa
docker0 (`HOST=172.17.0.1`) og ikke paa 127.0.0.1. Porten er ikke aaben udadtil.

Efter en aendring:

    sudo docker exec caddy-caddy-1 caddy validate --config /etc/caddy/Caddyfile
    sudo docker exec caddy-caddy-1 caddy reload --config /etc/caddy/Caddyfile

## Log ind med Theta

Hele siden er kun for medlemmer af Albumklubben-gruppen paa Theta (`server/theta-auth.ts`). Serveren starter ikke uden `THETA_*` og `PUBLIC_URL` i `.env`.
Theta er OIDC-udbyder; appen beder om `openid profile groups` og lukker ind, naar `groups`-claimet indeholder `THETA_GROUP_ID`. En session varer et doegn, saa tjekkes medlemskabet igen (stille, mens man er logget ind paa Theta).
Kun `/auth/*`, `/healthz` og `/robots.txt` er aabne. `/admin` kraever derudover sit eget `ADMIN_PASSWORD`.

Appen er registreret paa Theta (i dag stage) med `interop-admin` og filen `ops/theta-interop.json`:

    ssh theta-stage@135.181.147.111 'bash -lc "cd ~/theta-stage/backend && set -a && . ./.env && set +a && ALBUMKLUBBEN_CLIENT_SECRET=<hemmelighed> DATABASE_URL=\$DATABASE_ADMIN_URL node --experimental-strip-types tools/interop-admin.ts <sti>/theta-interop.json"'

Hemmeligheden er den samme som `THETA_CLIENT_SECRET` i live-`.env`. Ny hemmelighed eller nyt domaene: skift begge steder og koer filen igen.

## Deploy

    cd ~/albumklubben && git pull && ops/deploy.sh main

Tjekker commit'en ud i live-worktree'et, `pnpm install --frozen-lockfile`, bygger til `dist.new`, bytter den ind som `dist/`, genstarter tjenesten og tjekker `/healthz` lokalt.
Fejler install, build eller tjekket, ruller scriptet tilbage: forrige commit tjekkes ud igen, `node_modules` geninstalleres, den gamle `dist/` bevares (tjenesten genstartes kun hvis den var skiftet) og scriptet afslutter med fejl. Siden er altsaa uaendret efter en mislykket deploy.
Status: `systemctl --user status albumklubben`, log: `journalctl --user -u albumklubben`.

## Backup

Koeres hver nat. Manuelt: `systemctl --user start albumklubben-backup.service`.
Databasen tages med SQLites online backup (`better-sqlite3`), uploads med `rsync -a --delete --link-dest` mod forrige dag (uaendrede filer er hardlinks).
Backupperne ligger paa samme disk som siden (og disken er ~90 % fuld), saa de beskytter mod fejl i appen, ikke mod at maskinen gaar tabt.

## Gendan

1. Stop tjenesten: `systemctl --user stop albumklubben`.
2. Vaelg en dag: `D=~/albumklubben-backups/2026-10-28`.
3. Gem det nuvaerende: `mv ~/albumklubben-data ~/albumklubben-data.broken`.
4. `mkdir -m 700 ~/albumklubben-data && cp $D/albumklubben.sqlite ~/albumklubben-data/ && cp -a $D/uploads ~/albumklubben-data/uploads`
5. Start: `systemctl --user start albumklubben`, tjek `curl -s 172.17.0.1:3600/healthz`.

Test af en backup uden at roere live: kopier `albumklubben.sqlite` til en temp-sti, aabn med `openDb` og tjek at `listMeetings` giver 22 moeder.
