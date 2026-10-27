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

**Svarene er endnu ikke skrevet ned her.** En læsning med klubbens egen `sub` gav `404`, fordi
den nuværende session på albumklubben.dk kun har sagt ja til `openid profile groups`.
Læsningen virker først, når logind med `feed` og `posts` er sat i drift, og et medlem har
logget ind igen. Indtil da står kortlægningen i `server/theta-api.ts` og skal efterprøves.

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

- Svarenes form for opslag og kommentarer (se ovenfor).
- Hvordan en webhook er underskrevet ("Signed events" i interop-README'en).
