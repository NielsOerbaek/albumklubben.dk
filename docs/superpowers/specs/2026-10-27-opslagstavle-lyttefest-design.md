# Login page, icon, opslagstavle and lyttefest

Date: 2026-10-27. Owner: Niels. Status: built, 2026-10-27. What the building changed is at the
bottom, under "Bygget".

Niels asked for four things and said "go with your own recommendations" for everything he
did not specify. Unless a line says "(Niels)", the choice in it was made by the author of
this document, not agreed with Niels.

## Intent

Albumklubben.dk is the members-only site of a lunch listening club that meets every other
Tuesday. Between meetings, nothing happens on the site: it is an archive. These additions
make it a place the club also uses between Tuesdays:

1. **A login page** with a "Log ind med Theta" button, instead of being thrown straight to
   Theta's SSO. Logging out should really log you out (Niels asked whether the old Theta
   login is cleared; today it is not).
2. **A favicon and app icon**, so the site looks like itself in a tab and on a home screen.
3. **The opslagstavle** (bulletin board): the club's Theta group's latest posts, pinned to
   the bare wall by the door in Klubhuset, where members can read, comment and post. The
   wall was reserved for this (`layout.freeWall`) in the bibliotek design.
4. **The lyttefest** (listening party), which does not exist yet. Niels: "go with your best
   idea". The idea, which Niels approved in chat: a member picks an album and a time; at that
   time everyone presses play on their own speakers or streaming service, and the site
   keeps everyone in step through the tracklist, with live comments per track. It is
   announced on the opslagstavle (as a Theta post) and members say they are coming.

Order of work: 1 and 2 first (small, independent), then 3, then 4 (which builds on 3's
Theta plumbing).

## Goals

- A visitor who is not logged in sees a page that says what this is, with one button.
- Logging out of Albumklubben ends Albumklubben's session and Theta's OIDC session for the
  app, and says plainly what it could not do (see 1. Login page).
- The site has a recognisable icon at 16 px, a home-screen icon, and a web manifest.
- In Klubhuset, the free wall holds a board showing the group's latest posts; aiming at it
  and clicking opens the board as a dialog where a member can read threads, comment and
  write a new post, all as themselves ("via Albumklubben.dk" on Theta).
- The same board dialog is reachable outside the 3D room (from the top bar), because the 3D
  room is not for every device.
- Any member can start a lyttefest for an album that has a tracklist with track lengths.
- The lyttefest is posted in the Theta group with a card and a "Jeg kommer" button that
  works in the Theta web and native apps.
- During the lyttefest, every member's page shows the same current track and position,
  within about a second, and a live comment stream where each comment is tagged with the
  track it was written during.
- Afterwards, the lyttefest stays readable: the album, who came, and the comments under
  each track.

## Non-goals

- Playing audio: no streaming integration, no Spotify/Apple Music API, no previews. Each
  person plays the album themselves. (Unchanged from the original design: "no audio
  previews, no streaming integrations".)
- Avatars, presence or multiplayer in the 3D room. Voice or video chat.
- Pausing or seeking a running lyttefest. It runs on the clock.
- Uploading images or attachments from the board. A post's attachments are shown as a count
  with a link to Theta.
- Theta events (the calendar feature). The lyttefest is an ordinary group post with a card.
- Editing or deleting Theta posts or comments from Albumklubben.

## Anti-goals (a failure even if it works)

- **Personal data in the public repo.** The GitHub repo is public; members' names, posts and
  comments must never land in git: not in fixtures, tests, screenshots or this document.
  Test data uses invented names ("Medlem 1").
- **Spamming the group.** One Theta post per lyttefest. The live per-track comments are NOT
  written to Theta as they happen (each would notify the thread's followers); see
  "Comments" below.
- **Weakening the members-only gate.** Every new route is behind the Theta login except the
  webhook, which is behind Theta's signature.
- **Showing content a member could not see on Theta.** The board reads as the logged-in
  person through the App API, never through a shared cache across people.
- **A board or lyttefest that breaks the room when Theta is down.** Klubhuset and Arkivet
  must load and work without Theta; the board shows that it cannot be fetched.

## Constraints and facts

- **The site:** Fastify + SQLite (`better-sqlite3`), TypeScript run directly by Node
  (`--experimental-strip-types`), Vite + lit-html + three.js frontend, Vitest. The schema
  grows by `CREATE TABLE IF NOT EXISTS` and `addColumn` in `server/db.ts`. One process on
  box (see `ops/README.md`); in-memory state shared between requests is fine.
- **Theta is stage** (`THETA_ISSUER=https://stage.theta.dk/oidc`), where the club's group
  is. Stage runs the App API from theta-app PR #788 with `THETA_INTEROP=1`. The contract is
  `backend/src/modules/interop/README.md` in ogtal/theta-app (sections "Theta as an OIDC
  provider", "Connected apps at work", "Signed events", and the `interop-admin` format).
  What this design uses from it:
  - OIDC scopes `groups` (membership claim, used today), `feed` (read the group as the
    person) and `posts` (post and comment as the person, shown "via Albumklubben.dk").
    Asking for new scopes re-shows Theta's consent page once.
  - An app token: `client_credentials` with scope `app`, same client id and secret.
  - `GET /api/v1/app/groups/:ref/posts?viewer=<sub>` and
    `GET /api/v1/app/posts/:id/comments?viewer=<sub>` (read as a person; every refusal is
    `404`).
  - `POST /api/v1/app/posts` (with an optional card) and
    `POST /api/v1/app/posts/:id/comments`, with `author: {type:"user", sub}`, or
    `{type:"app"}` for the app's own bot; `externalId` for idempotency.
  - `PUT /api/v1/app/cards/:externalId` to update a card.
  - `POST /api/v1/app/notifications` (bell notification, push only).
  - Webhooks, signed CloudEvents: `dk.theta.card.action` (synchronous, 5 s timeout, the
    answer is the new card), `dk.theta.group.posted` (ids only, "refresh").
  - Card format `theta.card/v1` (`apps/card-schema.ts`): title, subtitle, badge, fields,
    body, up to three buttons (with optional confirm), a link.
- **Registration:** `ops/theta-interop.json` gains `webhookUrl`
  (`https://albumklubben.dk/theta/webhook`), `webhookSecret: "env:…"`, and `logoUrl` (the new
  icon, served at a stable public URL that is outside the login gate). Applied to stage with
  `interop-admin` as described in `ops/README.md`. The webhook secret goes into the live
  `.env`.
- **Repo is public:** see anti-goals.

## Decisions

### 1. Login page

- A visitor who is not logged in and navigates to any page gets the login page (status
  401, HTML) at that URL, instead of a 302 to Theta. It shows:
  - the icon, "Albumklubben", one line ("Klubhuset og arkivet for frokostlytteklubben på
    Thoravej 29. Kun for medlemmer af klubbens gruppe på Theta.");
  - one button, "Log ind med Theta", linking to `/auth/login?next=<the URL>`.
  It uses the site's own look (`theme.css`: black, white, Inter Tight), not the current
  bare auth page style; the other auth pages (expired, refused, logged out) get the same
  look.
- `/auth/login` keeps redirecting to Theta as today, now asking for
  `openid profile groups feed posts`.
- **Logout (Niels: "honest page now"):** `/auth/logout` clears the cookie and redirects to
  Theta's `end_session_endpoint` with `id_token_hint` and
  `post_logout_redirect_uri=https://albumklubben.dk/auth/logged-out` (registered in
  `theta-interop.json`; the current `/auth/logout` entry is replaced). This needs the ID
  token, so the session keeps it. The session cookie may become too big. If it does, keep
  the session server-side in SQLite, with the cookie holding only the session id.
  `/auth/logged-out` shows "Du er logget ud af Albumklubben" and the login button.
- **What logout cannot do.** Theta's OIDC logout does not end Theta's own login (the `_t`
  cookie; interop README, "Logout"). Theta's real logout is a POST-only, CSRF-protected
  button that an app cannot send people through. So after logging out here, the next
  "Log ind med Theta" in the same browser gets in as the same Theta account.
  - The logged-out page says this plainly: "Du er stadig logget ind på Theta i denne
    browser. Skal en anden logge ind, så log ud på Theta først." It links to stage Theta's
    front page.
  - Fixing this properly would mean a change in theta-app, for example a "Log også ud af
    Theta" choice on the OIDC logout page. That is out of scope here.
- Login does not send `prompt=login`. Theta would answer it from its own login cookie
  anyway, and a member already logged in to Theta should get in with one click.
- A logout link goes in the top bar (where there is none today).

### 2. Icon

- **Motif:** a vinyl record seen from the front, in the room's PS1 pixel style: hard pixel
  edges, few colours, black record with a few grooves, a coloured centre label. The label
  colour is one of the album card colours. The builder may choose the colour, but it must
  stand out on both a black and a white tab bar.
- **Files** in `web/public/`: an SVG master drawn on a pixel grid (`icon.svg`),
  `favicon.ico` (16 + 32), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png` (the record inside the safe zone, on black), and
  `manifest.webmanifest` (name "Albumklubben", short_name "Albumklubben", `start_url` `/`,
  `display: standalone`, background and theme `#000`).
- All HTML pages link them, the auth pages included. The icon files and the manifest are
  served without login (added to the open paths), so the login page, the browser and Theta
  (`logoUrl`) can fetch them.

### 3. Opslagstavle (the board)

**In the room:**
- A cork board fills most of the free wall (`layout.freeWall`), with a wooden frame, in the
  room's low-resolution style.
- It shows up to six notes: the group's posts in Theta's order (pinned first, then
  newest). The notes are drawn into one canvas texture at the room's low resolution, like
  the flip board.
- Each note shows the author's first name, the title or the first words of the text, and
  "💬 n". A lyttefest post looks different: a coloured note with the album cover.
- Aiming at the board shows a prompt ("Klik for at læse opslagstavlen"). Clicking opens the
  board dialog, using the existing aim/prompt and overlay mechanics.
- The board loads after the room has loaded, so a slow Theta never delays the room. On
  failure, the board shows one note, "Opslagstavlen kan ikke hentes lige nu".

**The dialog** (shared by Klubhuset and a new "Opslagstavle" entry in the top bar):
- A list of posts, each with author, time, title, text (plain, as Theta sends it), the
  attachment count as a link ("3 billeder på Theta"), "Åbn på Theta", and the comment
  count. Paging with "Vis flere" (Theta's cursor).
- Opening a post shows its thread (depth from Theta's `depth`), a reply field under each
  comment and a comment field at the bottom.
- "Skriv et opslag" opens a form with an optional title and the text.
- Writes go as the person (`author: {type:"user", sub}`) with an `externalId` (a UUID made
  when the form opens, so a double click or retry does not post twice).
- A Theta refusal is shown in plain Danish, for example "Theta tog ikke imod opslaget".
  `userNotEligible` reads as "Du kan ikke skrive i gruppen lige nu". A person's post may be
  held by the group's moderation, and Theta's answer then still succeeds. The dialog says
  "Sendt. Det vises, når det er godkendt" when the post does not appear on re-read.
- The text is plain text, rendered as text with line breaks. The site never renders
  Theta's content as HTML.

**The server:**
- New routes behind the login gate, all reading or writing as the session's `sub`:
  - `GET /api/board?cursor=` and `GET /api/board/posts/:id/comments?cursor=`;
  - `POST /api/board/posts` and `POST /api/board/posts/:id/comments`, each with
    `externalId`.
- The app token is fetched with `client_credentials` and kept in memory until shortly
  before it expires.
- A read result is cached **per viewer** for 30 s. The whole cache is dropped when a
  `dk.theta.group.posted` webhook arrives, and also after any write by Albumklubben itself,
  because Theta sends no event for an app's own writes. The board refreshes when the dialog opens and
  every 60 s while Klubhuset is open (and the tab is visible).
- A `404` from a read means the viewer has no `feed` consent, or is no longer a member. The
  API answers 401 with "Log ind igen", and the dialog shows the login button. Logging in
  again re-asks for consent.
- `THETA_GROUP_ID` is the group ref used for reads and writes.

### 4. Lyttefest

**Starting one:**
- The album dialog (in Klubhuset and Arkivet) gets a button, "Start en lyttefest".
- It is enabled only when the album's tracklist has a length on every track (that is what
  the sync runs on). Otherwise it is disabled, with "Kræver en tracklist med spilletider".
- The form:
  - **When:** "Om 10 minutter", or a date and time in Europe/Copenhagen, at least 10
    minutes ahead and at most 60 days ahead;
  - **A note** (optional, ≤ 280 characters).
- Creating it:
  - stores the lyttefest;
  - posts it to the group as the host, "via Albumklubben.dk", with a card.
- If Theta answers `userNotEligible`, nothing is created, and the form says "Du kan ikke
  skrive i gruppen lige nu". There is no fallback to the app's bot: that would let a
  suspended member post past the group's moderation.
- The club's group is in `flag_mode` (checked on stage 2026-10-27), so a member's post
  appears at once. If the group is ever switched to approval mode, the announcement waits
  for a moderator. The bot's follow-up comments ("Flyttet", "Aflyst", the summary) then
  fail with a 404, which is logged and not retried. That is accepted, not designed around.
- **The Theta post** text is short and in Danish: "Lyttefest: <Artist> – <Title>, <dag dato
  kl.>", the note, and the link to the lyttefest page. **The card**:
  - title "Lyttefest";
  - subtitle "<Artist> – <Title> (<year>)";
  - fields Tidspunkt, Vært, Spilletid, Kommer (count);
  - buttons "Jeg kommer" and, for those coming, "Jeg kommer ikke alligevel";
  - the link "Åbn lyttefesten".

  The badge shows the state: "Kommende", "Nu", "Slut" or "Aflyst". It is updated with
  `PUT /cards` when the state changes, along with the Kommer count.
- Card audiences can only limit who sees a button. So "Jeg kommer ikke alligevel" is shown
  only to those coming, but "Jeg kommer" shows for everyone. Pressing it again is a no-op
  that answers "Du er allerede på listen".
- **"Jeg kommer"** works both on Theta (the card action webhook answers with the updated
  card) and on the lyttefest page. The RSVP is stored locally, keyed by `sub`.
- **The host** can, before the start, "Udskyd" it (new time) or "Aflys" it. Either updates
  the card and adds one comment by the app's bot on the post ("Flyttet til …" or
  "Aflyst"). Nobody else can change it.
- **Reminder:** at the start time, a bell notification ("Lyttefesten for <album> starter
  nu") goes to everyone who said they were coming, via `POST /app/notifications`. A timer
  in the server process sends it; on restart, pending ones are rescheduled from the
  database. One reminder only.

**The lyttefest page** (`/lyttefest/:id`, a plain 2D page in the site's look, not inside
the 3D room):
- **Before:**
  - the cover, the album, the host, the note and a countdown;
  - who is coming, with the "Jeg kommer" button;
  - search links for the album on Spotify, Apple Music, YouTube Music and Tidal (plain
    search URLs, no APIs);
  - "Find albummet, og tryk play, når nedtællingen når 0".
- **During:**
  - the current track's number and title, large, with a progress bar and "2:14 / 5:42";
  - the coming tracks below;
  - someone who arrives late sees where to skip to ("Vi er på nummer 4, 1:32 inde");
  - the comment field and the live comment stream.
- **The clock** is the server's. The page measures its offset to the server once on load
  (and again on visibility change), and computes the position as
  `now - startsAt` along the cumulative track lengths. Multi-disc albums run disc after
  disc. There is no pause.
- **After** (when the last track ends):
  - "Lyttefesten er slut";
  - the whole tracklist, with each track's comments under it;
  - who came.

  The page stays available permanently.
- **The room:** while a lyttefest is running, the screen's flip board shows "LYTTEFEST NU",
  the artist and title, and the current track. In the 24 hours before one, it shows
  "LYTTEFEST" and its time. Otherwise it shows the latest meeting, as today. The
  lyttefest's Theta post is on the board like any post, drawn as its own kind of note.
- **The album:** the album dialog lists that album's lyttefester, linking to their pages.

**Comments:**
- Live comments are stored in Albumklubben (SQLite): the lyttefest, the author's `sub` and
  name, the text (≤ 500, plain), the time, and the track index computed on the server at
  receipt.
- They are pushed live with Server-Sent Events (`GET /api/lyttefest/:id/events`), which
  carry new comments, RSVP changes, and state changes (postponed, cancelled, started,
  ended).
- When the lyttefest ends, the app's bot adds **one** comment on the Theta post: a summary
  with each track that got comments and its comments as "Navn: tekst" lines, cut to a
  sensible length with a link to the page. It is idempotent (`externalId`
  `lyttefest-<id>-summary`).

  The point is that the conversation reaches the group once, without notifying anyone per
  comment.
- A comment can be deleted by its author or the host. There is no editing.
- A line under the comment field says so: "Kommentarerne samles i ét opslag i gruppen på
  Theta, når lyttefesten er slut". The summary uses first names.

## Data (SQLite, additive)

- `lyttefester`:
  - `id`, `album_id` (→ albums);
  - `host_sub`, `host_name`;
  - `starts_at` (UTC ISO), `note`;
  - `theta_post_id`, `theta_post_url`, `card_external_id`;
  - `posted_as` (`user` | `app`), `cancelled_at`, `reminded_at`, `summary_posted_at`;
  - `created_at`.
- `lyttefest_rsvps`: `lyttefest_id`, `sub`, `name`, `created_at`, PRIMARY KEY
  (`lyttefest_id`, `sub`).
- `lyttefest_comments`: `id`, `lyttefest_id`, `sub`, `name`, `track_index`, `text`,
  `created_at`, `deleted_at`.
- Total length and track boundaries come from the album's tracklist at the time the
  lyttefest is created, frozen into a `tracks` JSON column on `lyttefester`, so a later
  edit of the tracklist does not move a past party.
- The session's name for a person is Theta's `name` claim, as today.

## Testing

- The Theta side is a fake in the tests, as `tests/server/theta-auth.test.ts` does today:
  discovery, token, userinfo, the app token, the App API routes, and a signed webhook.
- Must be covered:
  - the login page for a logged-out navigation;
  - logout's redirect;
  - the open paths (icons, manifest, webhook) and that nothing else opened up;
  - webhook signature rejection;
  - the per-viewer cache (two viewers never share a read);
  - a 404 from the App API becoming a 401 "log ind igen";
  - `externalId` idempotency on writes;
  - the position function (track and offset at given times, multi-disc, before start,
    after the end);
  - the RSVP via the card action and via the page;
  - postpone and cancel only by the host;
  - the one reminder;
  - the one summary;
  - the room still loading when the board fetch fails.
- Fixtures use invented people only.

## Left to the builder

- The exact pixel drawing and colour of the icon, within the motif above.
- The board's dimensions, note layout and texture resolution, and how a note's text is cut.
- The look of the board dialog and the lyttefest page, within the site's existing style.
- How the webhook signature is verified (follow the interop README's "Signed events").
- SSE details (heartbeat, reconnect) and the in-process pub/sub.
- The summary comment's exact format and length limits.
- Whether the session moves server-side (only if the cookie gets too big with the ID token).
- File and module layout.


## Bygget

All four were built on 2026-10-27. Where the building had to part from this document, it is here.

### The opslagstavle reads; it does not write (Niels)

The design had the board reading threads, writing posts and writing comments. Niels, once it was
up: *"Opslagstavlen should just link into the theta post. We should not render threads in the app.
It is mostly a gimmick in the klubhuset, we would rather things actually happened on theta."*

So the board is a window, not a place:

- A post is a link to itself on Theta. There is no thread view, no comment field and no
  "Skriv et opslag"; the dialog has one link to the group for writing, and says so.
- The server keeps `GET /api/board` only. `POST /api/board/posts`,
  `POST /api/board/posts/:id/comments` and `GET /api/board/posts/:id/comments` are gone, with
  their tests. `/api/board` now also answers `groupUrl`, which is the way in to the group.
- `createComment` and `comments` stay on the Theta client in `server/theta-api.ts`: the lyttefest
  bot writes comments on its own announcement, and the client mirrors the API that
  `docs/theta-app-api.md` documents.

This also settles what "a reply under each comment" would have been — Theta's App API could not
have done it anyway, see below.

### After the first real lyttefest (Niels)

- **The bell rings two minutes before the first track**, not at it, so there is time to find the
  album and press play. If a restart means it rings late, it says "er begyndt" instead of
  pretending otherwise.
- **The host is on the list before the announcement goes up.** They were put there afterwards, so
  the card in the group said nobody was coming and offered the host no way out of it again.
- **The chat is laid out along the album.** Every track that has played has a bar of its own,
  stacked in playing order; a comment sits on its bar at the moment it was written and is stamped
  with the track and the time ("4. Wuthering Heights · 1:32"). Enter sends, shift and enter makes
  a new line, and a chat mark comes up under the pointer at the playhead so a comment can be
  written from where you are looking.
- **"Jeg kommer" on the card in Theta was refused** by this side. Until a real event has been
  seen, the webhook logs what arrived when it refuses — the header names, the signature's own
  value, and the field names of a card action — so one press is enough to put the scheme right.

### Faces on the lyttefest (Niels)

*"I would like to pull in theta user avatars, and when i hover over comment on the timeline, the
comment should show in a tiny hover thing."*

- **A member's face is the avatar Theta has for them**, on the host, on everyone coming, on every
  comment, and on the timeline itself, where the plain white dot is now the writer's face.
- **It comes from the login, not from the App API**, which has no way to look a member up by sub.
  `server/members.ts` writes down name and picture each time someone logs in, and the page's
  faces are read from there — so a member who changes their picture on Theta changes it
  everywhere here at once, and a member who has not logged in since shows their initials. The
  initials are not a placeholder waiting for the real thing: for that member they are it.
- **Hovering a face on the bar shows what was said**, in a card above it. Near either end of a
  track the card hangs from that end rather than from its middle, placed off the percentage the
  mark already has rather than by measuring anything. It is `aria-hidden` and gone on a touch
  screen: every comment is also in the list below, so nothing is reachable only by hovering.

### The App API had less in it than the design assumed

The contract was read off stage by asking the API and reading its own validation errors, and
written down in [docs/theta-app-api.md](../../theta-app-api.md). Two things in it are not what
this document took for granted:

- **A comment cannot answer another comment.** `POST /posts/:id/comments` has no `parent`,
  `parentId`, `replyTo` or `inReplyTo` — they are dropped in silence, which the API does with any
  field it does not know. So the board dialog has **one comment field per post**, not "a reply
  field under each comment". A thread read from Theta still shows its `depth`, indented; we just
  cannot write into it.
- **A post cannot carry attachments or be pinned from here**, which this document never asked for,
  but it is worth knowing: the attachment count is read, never written.

The post's text field is `body`, not `text`, and a notification is `{recipients, text, href}` with
no title. The card is as the design described it, except the buttons are `actions` and the badge is
an object (`{text, tone}`).

### Two things could not be checked, and are marked in the code

- ~~**The shape of a post read back.**~~ Checked once the login was in use, and it was wrong: the
  text is `text` coming out, not `body`, so every post on the board stood empty until it was
  fixed. The read shape is now written down in [docs/theta-app-api.md](../../theta-app-api.md).
  Theta also sends no `pinned` on a post — it puts the pinned ones first in the list instead — so
  that flag in `BoardPost` is always false and the board shows them in Theta's own order.
- **How Theta signs an event.** The interop README was not at hand. `verify` in
  `server/theta-webhook.ts` checks an HMAC-SHA256 over `<timestamp>.<raw body>` from a
  `Theta-Signature: t=…,v1=…` header. It fails closed, so a wrong guess refuses events rather than
  letting anything in, and it is one function to change. The same goes for `readAction` in
  `server/lyttefest.ts`, which reads a `dk.theta.card.action`.

Until both are confirmed, the board still works (it re-reads every half minute instead of hearing
about a post at once) and a lyttefest still works on its own page (the card's buttons in Theta do
not).

### Smaller things

- **The reminder and the summary** are not one timer per lyttefest. A pass runs every ten seconds
  and claims each job in the database before doing it, so each happens exactly once however often
  the pass runs and whatever a restart interrupts. Same promise, less to go wrong.
- **The session keeps the ID token** in the cookie, as the design's first choice. It is only moved
  out if the cookie would pass 3.5 kB, and then logout degrades to local-only rather than the
  browser dropping the session. The session did not have to move to SQLite.
- `ThetaError` does not use a TypeScript parameter property: the server is run by Node's
  strip-only mode, which refuses them. `tests/server/strip-types.test.ts` now loads every server
  module the way Node does, because the test suite compiles with esbuild and would not have
  noticed.
