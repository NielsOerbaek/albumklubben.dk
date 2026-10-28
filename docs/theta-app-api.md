# Theta App API, som den svarer på stage

Skrevet ned 2026-10-27 ved at spørge `https://stage.theta.dk` med appens eget token og læse
dens valideringsfejl. Kontrakten står i `backend/src/modules/interop/README.md` i
ogtal/theta-app; det her er kun, hvad Albumklubben.dk bruger, og hvad der faktisk kom retur.

Intet medlemsindhold er læst eller skrevet undervejs: alle kald var enten opslag, der blev
afvist af valideringen, eller læsninger, hvor strengene blev maskeret.

## Token

    POST <token_endpoint>   (fra /oidc/.well-known/openid-configuration)
    Authorization: Basic base64(clientId:clientSecret)
    grant_type=client_credentials&scope=app
    -> { access_token, expires_in, scope: "app", token_type: "Bearer" }

Alle kald nedenfor er `Authorization: Bearer <access_token>` mod `https://stage.theta.dk`.

## Fejl

Samme indpakning hver gang:

    { "error": { "code", "message", "fields": [{ "path", "code", "message" }] | null,
                 "retryAfter": null },
      "meta": { "requestId" } }

Sete koder: `badRequest` (400) og `notFound` (404). Kontrakten nævner også `userNotEligible`.
Hver afvisning af en læsning er en `404` — også når grunden er, at personen ikke har sagt ja
til `feed`. Ukendte felter i et opslag bliver smidt væk uden fejl.

## Læsninger (som en person)

    GET /api/v1/app/groups/:ref/posts?viewer=<sub>[&limit=<tal>][&cursor=<streng>]
    GET /api/v1/app/posts/:id/comments?viewer=<sub>[&limit=<tal>]

`viewer` er påkrævet, og validering af forespørgslen sker, før personen slås op. `cursor` skal
være mindst ét tegn.

Svaret, læst på stage 2026-10-27, da logind med `feed` var i drift:

    { posts: [ {
        id: string,
        url: string,                  // opslaget på Theta
        author: { sub, name, picture },
        title: string | null,
        text: string,                 // ← teksten hedder `text` på vej ud
        createdAt: string,            // ISO
        editedAt: string | null,
        commentCount: number,
        attachmentCount: number,
        viaApp: { name: string, postedAsApp: boolean } | null,
      } ],
      nextCursor: string | null }

Kommentarer kommer som `{ comments: [...], nextCursor }`.

**Teksten hedder `text`, når den kommer ud, og `body`, når den skal ind.** API'et er ikke
symmetrisk om det, og et `body` læst af et opslag findes slet ikke. Det kostede en omgang:
de første opslag på tavlen stod tomme.

Der er heller **ingen `pinned`** på et opslag, der læses. Theta lægger selv de hæftede øverst i
listen, så rækkefølgen bærer det, og `pinned` i `BoardPost` er altid falsk.

`viaApp` siger, hvilken app et opslag er skrevet igennem, og om det var appens egen bot.

## Ansigter

`picture` på en forfatter er den samme avatar, som OIDC'ens `userinfo` (`/oidc/me`) giver under
`profile`-scopet. Det står i udbyderens `claims_supported`: `sub`, `name`, `picture`, `email`,
`email_verified`, `verifications`, `groups`, `sid`, `auth_time`, `iss`.

App API'et kan **ikke** slå et medlem op på en `sub`, så der er ingen vej til et ansigt på en,
der ikke lige har skrevet noget. Derfor skriver `server/members.ts` navn og billede ned ved hvert
logind, og lyttefesten henter ansigterne derfra. Et medlem, der ikke har været logget ind siden,
har ingen avatar her, og så tegnes deres initialer i stedet.

En avatar-URL ser sådan ud og kan hentes af enhver, uden logind på Theta (tjekket 2026-10-28,
`200 image/jpeg`):

    https://stage.theta.dk/api/v1/media/<id>/s256

Browseren henter den altså direkte, uden cookies og uden referrer.

## Skrivninger

    POST /api/v1/app/posts
    { group: string, author: Author, body: string,
      title?: string, externalId?: string, card?: Card }

    POST /api/v1/app/posts/:id/comments
    { author: Author, body: string, externalId?: string }

`Author` er `{ type: "app" }` eller `{ type: "user", sub: string }`. Teksten hedder `body`,
ikke `text`. `externalId` er til at gentage et kald uden at skrive to gange.

Der er **ingen** felter til at svare på en kommentar (hverken `parent`, `parentId`, `replyTo`
eller `inReplyTo`), og ingen til at hæfte filer på eller pinne et opslag. Kommentarer, som
appen skriver, ligger altså altid direkte på opslaget.

    PUT /api/v1/app/cards/:externalId
    { card: Card }      // 404 hvis kortet ikke findes

    POST /api/v1/app/notifications
    { recipients: string[] (mindst én sub), text: string, href: string }

Der er ingen titel på en notifikation, og den peger kun via `href`.

## Kort (`theta.card/v1`)

    Card = {
      version: "theta.card/v1",
      externalId: string,
      title: string,
      subtitle?: string,
      body?: string,
      badge?: { text: string, tone: "neutral"|"info"|"success"|"warning"|"danger" },
      fields?: { label: string, value: string }[],
      actions?: {
        id: string,
        label: string,
        style: "primary"|"secondary"|"danger",
        confirm?: string,      // teksten, der skal bekræftes
        audience?: string[],   // de subs, der kan se knappen
      }[],
      link?: { label: string, url: string },
    }

## Mangler stadig

- Hvordan en webhook er underskrevet ("Signed events" i interop-README'en). `verify` i
  `server/theta-webhook.ts` er det ene sted, der ved det, og den fejler lukket.
- Formen på `dk.theta.card.action` (`readAction` i `server/lyttefest.ts`, samme sted-princip).
- Om `comments` har `depth` på en kommentar. Opslaget, der blev kigget på, havde ingen
  kommentarer, så listen kom tom tilbage. `depth` læses som 0, hvis den ikke er der.
