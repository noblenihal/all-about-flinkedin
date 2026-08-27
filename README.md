# LinkedIn Profile API

A weekend project: a hosted HTTP API that accepts a LinkedIn profile URL and
returns the profile as structured JSON — name, headline, location, about,
experience, education, skills, certifications, languages, images, and more.

I built this to see how far you can get reverse-engineering LinkedIn's internal
API from the mobile app, and to practise a clean, well-documented Node service
around it.

```
GET /api/v1/profile?url=https://www.linkedin.com/in/williamhgates
```

```jsonc
{
  "success": true,
  "meta": {
    "profileUrl": "https://www.linkedin.com/in/williamhgates/",
    "publicIdentifier": "williamhgates",
    "source": "voyager-graphql",
    "fetchedAt": "2026-08-27T14:10:00.000Z",
    "durationMs": 1018,
    "cached": false,
    "unavailableSections": ["contactInfo"]
  },
  "data": {
    "fullName": "Bill Gates",
    "headline": "Co-chair, Bill & Melinda Gates Foundation",
    "location": { "full": "Seattle, Washington", "country": "United States", ... },
    "about": "...",
    "experience": [ ... ],
    "education": [ ... ],
    "skills": [ ... ],
    "certifications": [ ... ],
    "languages": [ ... ],
    "profilePicture": { "url": "https://media.licdn.com/...", "renditions": [ ... ] },
    ...
  }
}
```

---

## Contents

- [Quick start](#quick-start)
- [Authentication to LinkedIn](#authentication-to-linkedin)
- [API documentation](#api-documentation)
- [Response schema](#response-schema)
- [Deployment](#deployment)
- [Approach — how it works](#approach--how-it-works)
- [Known limitations](#known-limitations)
- [Legal & responsible use](#legal--responsible-use)

---

## Quick start

Requirements: Node.js ≥ 20.

```bash
git clone <your-repo-url>
cd linkedin-profile-api
npm install

cp .env.example .env
#   edit .env — set LINKEDIN_EMAIL + LINKEDIN_PASSWORD (see auth section)

# verify the credentials produce a working LinkedIn session:
npm run login:check
#   optionally end-to-end against a real profile:
npm run login:check -- williamhgates

# run it
npm run dev            # watch mode (tsx)
#   or
npm run build && npm start
```

Then open <http://localhost:8080> for the built-in demo page, or:

```bash
curl "http://localhost:8080/api/v1/profile?url=https://www.linkedin.com/in/williamhgates"
```

---

## Authentication to LinkedIn

LinkedIn has no public profile API, so the service authenticates as a normal
member and calls the same internal endpoints the website and app use. Three ways
to supply a session — you can combine a session method with credentials so that
credentials act as an automatic fallback.

| Method | Env vars | Best for | Notes |
| --- | --- | --- | --- |
| **A. Email + password** | `LINKEDIN_EMAIL`, `LINKEDIN_PASSWORD` | Local dev, long-running servers | The service logs in once and reuses the session. Can hit a verification challenge on a new IP (see below). |
| **B. Full cookie jar** | `LINKEDIN_COOKIE_JAR` | Serverless / Vercel | Zero runtime logins. Generate with `npm run login:export`. |
| **C. `li_at` cookie** | `LINKEDIN_LI_AT` | Quick tests | Copy `li_at` from your browser. Lighter but less reliable than B. |

**Recommended for production:** set **B** (or **C**) *and* the **A** credentials.
If the cookie session is ever rejected, the service falls back to a fresh login
automatically.

### Capturing a cookie jar (method B)

```bash
npm run login:export
# → logs in once and prints a single-line JSON jar to stdout.
# Set it as LINKEDIN_COOKIE_JAR on your host (keep it secret).
```

### About login challenges

A programmatic login can be interrupted by LinkedIn with a verification
challenge — an emailed PIN, a CAPTCHA, or app/SMS 2FA. Automated login cannot
clear these. When it happens the API returns `LINKEDIN_CHALLENGE_REQUIRED` with
a clear message. The fix is to authenticate once from a browser (or from a
machine/IP that has), then use method **B** or **C**. Challenges are most common
from datacenter IPs, which is exactly why serverless deploys should use a
pre-captured cookie jar rather than credentials.

### Session lifetime & reuse

The service persists the session (to `.session/linkedin.json` on a writable host,
or held in memory otherwise) and **reuses it for up to 20 days** rather than
re-logging-in, because re-authentication is the operation most likely to trigger
a challenge. If LinkedIn rejects the session mid-flight (a `401`/`403` or a
redirect to the login wall), the service silently re-authenticates once. A
captured `li_at` typically stays valid for weeks, until you log out, change your
password, or LinkedIn expires it.

---

## API documentation

Base path: `/api/v1`

### `GET /profile`

Fetch a single profile.

| Query param | Required | Description |
| --- | --- | --- |
| `url` | yes | A LinkedIn profile URL, or a bare `/in/` slug. Accepts country subdomains, tracking query strings, and trailing paths. |
| `refresh` | no | `true` bypasses the cache. |
| `fast` | no | `true` skips extra enrichment calls for a quicker, slightly thinner response. |

```bash
curl "http://localhost:8080/api/v1/profile?url=https://www.linkedin.com/in/williamhgates"
```

### `POST /profile`

Fetch one profile, or a small batch (processed sequentially to protect the
account).

```bash
# single
curl -X POST http://localhost:8080/api/v1/profile \
  -H 'content-type: application/json' \
  -d '{"url":"https://www.linkedin.com/in/williamhgates"}'

# batch (max 10)
curl -X POST http://localhost:8080/api/v1/profile \
  -H 'content-type: application/json' \
  -d '{"urls":["williamhgates","satyanadella"]}'
```

| Body field | Description |
| --- | --- |
| `url` | One profile URL. |
| `urls` | Up to 10 profile URLs, returned under a `results[]` array. |
| `refresh`, `fast` | Booleans, as above. |

### `GET /health`

Liveness probe. No upstream calls. Also served at the root path `/health`.

### `GET /status`

LinkedIn session state (authenticated? which method? age? last error?) and cache
stats. No credentials are exposed.

### `GET /docs`

Machine-readable description of the API (endpoints, error codes).

### Authentication (optional)

If `API_KEYS` is set on the server, every `/profile` request must send a matching
key in the `x-api-key` header (or `Authorization: Bearer <key>`). If `API_KEYS`
is empty the API is open.

### Rate limiting

Per-IP: **20 requests/minute** by default (`RATE_LIMIT_MAX`,
`RATE_LIMIT_WINDOW_MS`), with standard `RateLimit-*` and `Retry-After` headers.
Exceeding it returns `429 RATE_LIMITED`.

### Error format

Every error uses the same envelope:

```json
{ "success": false, "error": { "code": "PROFILE_NOT_FOUND", "message": "..." } }
```

| Code | HTTP | Meaning |
| --- | --- | --- |
| `INVALID_URL` | 400 | Not a LinkedIn member profile URL. |
| `UNAUTHORIZED` | 401 | Missing/invalid API key. |
| `RATE_LIMITED` | 429 | Client exceeded the request rate limit. |
| `PROFILE_NOT_FOUND` | 404 | No profile at that slug. |
| `LINKEDIN_AUTH_FAILED` | 502 | Configured credentials/cookie were rejected. |
| `LINKEDIN_CHALLENGE_REQUIRED` | 502 | LinkedIn demanded a 2FA/CAPTCHA login challenge. |
| `LINKEDIN_RATE_LIMITED` | 502 | LinkedIn throttled the backing account. |
| `LINKEDIN_UNAVAILABLE` | 502 | LinkedIn unreachable or blocked the request (e.g. HTTP 999). |
| `INTERNAL_ERROR` | 500 | Unexpected server error. |

---

## Response schema

The full TypeScript schema lives in [`src/types/profile.ts`](src/types/profile.ts).
Design rules applied consistently:

- **Scalars that may be missing are `null`, never absent** — every documented key
  always exists.
- **Collections are always arrays.** An empty array means "none found"; a section
  the account genuinely could not see is listed under `meta.unavailableSections`
  instead (so empty-vs-hidden is unambiguous).
- **Dates are both structured and raw.** Each `dateRange` carries parsed
  `start`/`end` (`{year, month, day}`) *and* the labels LinkedIn rendered
  (`startText`, `endText`, `durationText`), because LinkedIn often supplies only a
  month/year.
- **Images are `{ url, renditions[] }}`** — `url` is the largest rendition; all
  sizes are listed. (LinkedIn image URLs are signed and expire in a few weeks.)

Top-level `data` fields include: `publicIdentifier`, `profileUrl`, `urn`,
`firstName` / `lastName` / `fullName` / `maidenName`, `pronouns`, `headline`,
`about`, `location`, `industry`, the booleans `isPremium` / `isInfluencer` /
`isOpenToWork` / `isHiring` / `isVerified`, `connectionCount`, `followerCount`,
`profilePicture`, `backgroundImage`, and the collections `currentPositions`,
`experience`, `education`, `skills`, `certifications`, `languages`, `projects`,
`publications`, `honors`, `volunteer`, `courses`, `organizations`, `patents`,
`testScores`.

---

## Deployment

The API is a standard Node/Express server and deploys anywhere. **Keep all
secrets out of the repo** — set the `LINKEDIN_*` and `API_KEYS` values in the
host's environment/secret manager.

The single most important deployment factor is the **egress IP**: LinkedIn blocks
many datacenter IP ranges (symptom: `HTTP 999`). If you hit that, set
`LINKEDIN_PROXY_URL` to a proxy (a residential proxy works best).

### Render (config included)

`render.yaml` is provided. Create a Blueprint from the repo, then set the
`LINKEDIN_*` secrets in the dashboard. Health check path: `/api/v1/health`.

### Docker

```bash
docker build -t linkedin-profile-api .
docker run -p 8080:8080 --env-file .env linkedin-profile-api
```

### Vercel (config included)

`vercel.json` + `api/index.ts` wrap the Express app as a serverless function.
Because Vercel's filesystem is ephemeral and its IPs are datacenter ranges:

1. Authenticate with a **cookie jar**, not credentials — `npm run login:export`,
   then set `LINKEDIN_COOKIE_JAR` in the Vercel project settings.
2. If you see `HTTP 999`, add a `LINKEDIN_PROXY_URL`.

```bash
vercel --prod
```

> Trade-off: a long-running host (Render/Fly/Docker VM) is a better fit than
> serverless for this workload — it holds one warm session and a stable IP,
> which is exactly what keeps LinkedIn happy. Vercel works with the cookie-jar
> setup above, but the IP-block risk is higher.

---

## Approach — how it works

**No official API exists**, so the service reverse-engineers LinkedIn's own
internal ("Voyager") API and authenticates as a real member.

1. **Login.** `POST /uas/authenticate` (the endpoint the LinkedIn Android app
   uses) with `session_key`/`session_password`. It returns a small JSON verdict
   (`{"login_result":"PASS"}`) and sets the `li_at` session cookie. This path was
   chosen because the website's login is now a client-side React app with no
   server-rendered CSRF form to post to. The resulting cookie jar is persisted
   and reused.

2. **Fetch.** The primary data source is LinkedIn's **GraphQL** endpoint
   (`/voyager/api/graphql`) using the `FullProfileByMemberIdentity` query. The
   query id and its `memberIdentity` variable were recovered by **decompiling the
   LinkedIn Android APK** and reading its generated GraphQL client — this is what
   makes the integration precise rather than guesswork. A single authenticated
   call returns the entire profile with every section nested inline. It is
   requested with a plain `application/json` Accept header on purpose: the
   "normalized" variant makes LinkedIn's server 500 on records without a type
   discriminator, whereas plain JSON returns cleanly.

3. **Parse.** A dedicated parser maps LinkedIn's deeply-nested,
   frequently-reshaped payloads into the flat, stable schema above. It unwraps
   LinkedIn's "attributed text" envelopes and reconstructs image URLs from the
   `VectorImage` `rootUrl` + artifact segments.

4. **Fallbacks.** If the GraphQL query id is ever rotated by LinkedIn, the
   service transparently falls back to the legacy REST `profileView` and `dash`
   endpoints, and finally to parsing the logged-out public profile page
   (schema.org JSON-LD — thinner data, flagged via `meta.source`). Each attempt
   is recorded in `meta.attempts`.

**Reliability & safety features baked in:**

- **Response cache** (TTL + LRU) so repeat lookups don't spend LinkedIn calls.
- **Outbound throttle** — a minimum gap between LinkedIn requests.
- **Single-flight login** — concurrent requests on a cold instance trigger
  exactly one login, not a burst.
- **Session persistence & reuse** to minimise re-logins (the challenge trigger).
- **Automatic one-shot re-auth** when a session is rejected mid-flight.
- **Inbound rate limiting** and **optional API-key gate**.
- **Secret redaction** in logs; secrets only ever come from the environment.

### Project layout

```
src/
  index.ts              entry point (http server, graceful shutdown)
  server.ts             express app, middleware, routes, static demo page
  config.ts             env-driven configuration
  http/                 cookie jar + throttled fetch client
  linkedin/
    auth.ts             /uas/authenticate login flow
    session.ts          session selection, reuse, fallback ordering
    sessionStore.ts     on-disk session persistence
    voyager.ts          authenticated Voyager REST + GraphQL calls
    profile.ts          strategy orchestration, enrichment, caching
    parse/              payload → schema parsers (graphql, dash, profileView, public page)
  routes/               profile, health, docs endpoints
  middleware/           api-key, rate-limit, error handling
  types/profile.ts      the public response schema
scripts/                login:check, login:export
public/index.html       zero-dependency demo page
api/index.ts            Vercel serverless adapter
```

---

## Known limitations

- **Data visibility follows the logged-in account.** You only get what that
  account can see. Fields restricted by the target's privacy settings, or hidden
  from non-connections, won't appear.
- **Contact info** (email/phone/websites) is reported as unavailable. LinkedIn no
  longer exposes it through a standalone endpoint for arbitrary members; it is
  bundled into UI cards and shown only for your own connections.
- **`connectionCount` caps at 500** for accounts with 500+ (LinkedIn reports
  "500+"); `followerCount` is only present when LinkedIn includes it.
- **Image URLs expire.** They are signed and typically valid for a few weeks —
  fetch/cache the bytes if you need them long-term.
- **IP reputation matters.** From flagged/datacenter IPs LinkedIn may return
  `HTTP 999` or force login challenges. Use `LINKEDIN_PROXY_URL` and/or a
  pre-captured cookie jar.
- **Account-level rate limits.** LinkedIn throttles accounts that fetch too
  aggressively. The built-in cache + outbound throttle mitigate this, but a
  single account is still the bottleneck; heavy use should rotate accounts/proxies.
- **Coupled to LinkedIn internals.** The GraphQL query id and payload shapes can
  change without notice. The fallback chain and APK-derived query ids reduce
  breakage, but this is inherent to any unofficial integration.
- **In-memory cache & session** are per-instance. Horizontal scaling would want a
  shared store (e.g. Redis) for the cache, the outbound throttle, and the session.

---

## Legal & responsible use

This project is for **educational and authorized use**. Scraping LinkedIn may
conflict with its Terms of Service, and personal data is subject to privacy laws
(GDPR/CCPA and others). Use only your own account, fetch only data you are
permitted to access, respect rate limits, and do not store or redistribute
personal data without a lawful basis. You are responsible for how you deploy and
use this software.
