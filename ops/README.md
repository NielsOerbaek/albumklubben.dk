# Albumklubben: drift paa denne maskine

## Opbygning

| Hvad | Hvor |
| --- | --- |
| Koerende kode | detached git worktree `/home/theta/albumklubben-live` (egen `node_modules`, `dist/`, `.env`) |
| Data | `/home/theta/albumklubben-data/` (mode 700): `albumklubben.sqlite` og `uploads/{covers,posters,videos}` |
| Hemmeligheder | `/home/theta/albumklubben-live/.env` (`ADMIN_PASSWORD`, `SESSION_SECRET`, `SITE_USER`, `SITE_PASSWORD`, `PORT`, `HOST`, `DB_PATH`, `UPLOAD_DIR`). Aldrig i git. |
| Backups | `/home/theta/albumklubben-backups/<AAAA-MM-DD>/` (mode 700, indeholder personlige fotos), de nyeste 14 beholdes |
| Caddy | `/etc/caddy/Caddyfile` importerer `/home/theta/albumklubben-ops/Caddyfile` (basic auth med bcrypt-hash, noindex, `request_body` 600MB, proxy til `127.0.0.1:3600`). `ops/Caddyfile.example` er den samme blok med hash erstattet af en pladsholder. |
| Tjeneste | user-unit `~/.config/systemd/user/albumklubben.service` (linger er slaaet til) |
| Backup | user-units `albumklubben-backup.service` + `.timer` (hver nat 03:30, `Persistent=true`), symlinket fra live-worktree'ets `ops/` |

Siden: https://albumklubben.dn.osogdata.dk (bruger og kodeord: `SITE_USER` / `SITE_PASSWORD` i `.env`).
Nyt hash: `caddy hash-password`. Aendring af Caddyfilen kraever `caddy validate` foer `systemctl reload caddy`.

## Deploy

    /home/theta/albumklubben/ops/deploy.sh <commit>

Tjekker commit'en ud i live-worktree'et, `pnpm install --frozen-lockfile`, bygger til `dist.new`, bytter den ind som `dist/`, genstarter tjenesten og tjekker `/api/archive` lokalt.
Fejler install, build eller tjekket, ruller scriptet tilbage: forrige commit tjekkes ud igen, `node_modules` geninstalleres, den gamle `dist/` bevares (tjenesten genstartes kun hvis den var skiftet) og scriptet afslutter med fejl. Siden er altsaa uaendret efter en mislykket deploy.
Status: `systemctl --user status albumklubben`, log: `journalctl --user -u albumklubben`.

## Backup

Koeres hver nat. Manuelt: `systemctl --user start albumklubben-backup.service`.
Databasen tages med SQLites online backup (`better-sqlite3`), uploads med `rsync -a --delete --link-dest` mod forrige dag (uaendrede filer er hardlinks).

## Gendan

1. Stop tjenesten: `systemctl --user stop albumklubben`.
2. Vaelg en dag: `D=/home/theta/albumklubben-backups/2026-10-23`.
3. Gem det nuvaerende: `mv /home/theta/albumklubben-data /home/theta/albumklubben-data.broken`.
4. `mkdir -m 700 /home/theta/albumklubben-data && cp $D/albumklubben.sqlite /home/theta/albumklubben-data/ && cp -a $D/uploads /home/theta/albumklubben-data/uploads`
5. Start: `systemctl --user start albumklubben`, tjek `curl -s 127.0.0.1:3600/api/archive | head -c 40`.

Test af en backup uden at roere live: kopier `albumklubben.sqlite` til en temp-sti, aabn med `openDb` og tjek at `listMeetings` giver 22 moeder.
