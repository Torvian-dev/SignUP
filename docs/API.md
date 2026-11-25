# API specification (v1)

The base URL is `https://api.<host>/v1`. All bodies are JSON. Errors look like `{ "error": { "code", "message", "details?" } }`.
Every request needs `Authorization: Bearer <ES256 JWT>` (15 min), except `/auth/*` server-to-server calls.
The browser never holds the JWT: it calls the Next.js BFF at `/api/v1/*`, which adds the token server-side.

Rate limits: `/auth/*` allows 20/min per IP. Everything else allows 300/min per user (Redis-backed, `RateLimit-*` headers).

## Auth
| Method | Path | Who | Body → Response |
|---|---|---|---|
| POST | `/auth/verify-password` | Next.js server (`x-internal-secret`) | `{email,password}` → `{userId, mfaRequired}` · 401 `invalid_credentials` |
| POST | `/auth/exchange` | Next.js server | `{userId, orgId?}` → `{accessToken, refreshToken, expiresIn}`. Creates org + DEK + default policy on first login |
| POST | `/auth/refresh` | Next.js server | `{refreshToken, orgId}` → new pair. Reuse of a rotated token → 401 `token_reuse` and the whole family is revoked |
| POST | `/auth/logout` | user | → 204 (revokes refresh family) |
| GET | `/auth/me` | user | → `{user, currentOrgId, role, organizations[]}` |

## Profiles
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/profiles` | profile:read | Masked list: `{id,label,isDefault,displayName:"J*** S****",email:"j***@x.com",customFieldCount,proxy:{host,health}}` |
| POST | `/profiles` | profile:write | `ProfileInput` (below) → 201 `{id}` |
| GET | `/profiles/:id` | profile:reveal (audited) | Decrypted profile. The proxy password is never returned (`passwordSet: true`) |
| PUT | `/profiles/:id` | profile:write | `ProfileInput & {version}`. Optimistic lock → 409 on conflict. A blank proxy password keeps the existing one |
| DELETE | `/profiles/:id` | profile:delete | Crypto-shred + soft delete |

```jsonc
// ProfileInput
{
  "label": "Profile A – John Smith",
  "firstName": "John", "lastName": "Smith", "email": "john@email.com", "phone": "07123456789",
  "locale": "en-GB", "timezone": "Europe/London", "isDefault": true,
  "addresses": [{ "kind": "primary", "line1": "1 High St", "city": "Leeds", "region": "West Yorkshire", "postcode": "LS1 1AA", "countryCode": "GB" }],
  "proxy": { "type": "http", "host": "gb.proxy.example", "port": 8080, "username": "u", "password": "p",
             "credentialRotateDays": 90, "stickySessionId": "sess-123" },   // one per profile; null removes it
  "customFields": [{ "key": "date_of_birth", "label": "Date of Birth", "type": "date", "value": "1990-03-07", "synonyms": ["DOB"] }]
}
```

## Runs
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/runs` | run:create | `{url, profileId, intent: auto/signup/login/application/contact/onboarding}` → 202 `{id,status}`. 400 bad URL · 422 `policy_violation` (blocked domain, private IP, daily cap, concurrency) |
| GET | `/runs?status=&domain=&cursor=&limit=` | run:read | Keyset pagination by `created_at` |
| GET | `/runs/:id` | run:read | Full run row |
| GET | `/runs/:id/events` | run:read | **SSE**. `event: run` (status, mapping, captcha, navigation, review, manual, done). Add `?screen=1` for `event: frame` (base64 JPEG) during manual takeover |
| GET | `/runs/:id/review` | run:review | `{run:{…,submitButton}, fields:[{id,kind,label,required,options,decision_id,profile_path,transform,confidence,reasoning,source,provider,fill:{status,valid,validationMessage,displayValue}}]}` |
| GET | `/runs/:id/screenshot` | run:review | PNG of the filled form, passwords masked, `no-store` |
| POST | `/runs/:id/approve` | run:approve | `{overrides:[{fieldId, profilePath?|null, transform?, value?}]}` → 202. 409 unless `awaiting_review` |
| POST | `/runs/:id/manual` | run:review | `{type:"manual_done"}` or `{type:"input", event:{kind:"click",x,y} / {kind:"type",text} / {kind:"key",key} / {kind:"scroll",dy}}`. Click `x`,`y` are fractions (0–1) of the viewport |
| POST | `/runs/:id/cancel` | run:cancel | → 202 |
| POST | `/runs/:id/resume` | run:create | Only from `paused`/`failed`. Re-queues at priority 1 from the checkpoint |

## Batch sign-ups
One URL × a roster of profiles, one account per profile, submitted automatically (requires org policy `allow_auto_submit`).
| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/batches` | run:create | `{url, profileIds[], quantity?, intent, onFailure: skip\|pause}` → 202 `{id}`. 422 if auto-submit is disabled |
| GET | `/batches` | run:read | List with `processed/succeeded/failed/quantity` |
| GET | `/batches/:id` | run:read | Batch + its per-profile `runs[]` (sequential) |
| POST | `/batches/:id/cancel` | run:cancel | Stops after the current profile |
| POST | `/batches/:id/resume` | run:create | Resume a batch paused by a failure |

Each profile becomes one `automation_run` with `auto_submit=true`. The agent submits without review when every required field is filled and trusted (learned, deterministic, or high-confidence AI) and the CAPTCHA is solved; otherwise that profile is skipped. Processing is strictly sequential — one account is fully created before the next profile's email and proxy are used.

## Provider credentials (admin)
| Method | Path | Notes |
|---|---|---|
| GET | `/providers/catalog` | `{ai:[claude,openai,gemini], captcha:[2captcha,capsolver,anticaptcha,capmonster,deathbycaptcha,bestcaptchasolver,dispurcaptcha,resolvr,compatible], browser:[browserless,browserbase], proxy:[brightdata,oxylabs,smartproxy], email:[m365,smtp,sendgrid]}` |
| GET | `/providers` | List with `masked: "••••a1B2"`, status and last test. Never returns secrets |
| POST | `/providers` | `{category, provider, label, secret:{apiKey}/{username,password}/{tenantId,clientId,clientSecret}, config:{model?/baseUrl?/…}, priority}`. The same provider+label **rotates** the key (the previous one stays valid for 24 h) |
| PATCH | `/providers/:id` | `{priority?, isActive?, config?}`. Priority sets the failover order |
| DELETE | `/providers/:id` | |
| POST | `/providers/:id/test` | Live check (AI model lookup, CAPTCHA balance, SendGrid scopes, Browserless/Browserbase ping) → `{ok, latencyMs, balanceUsd?, error?}` |

## Analytics, policy, audit
| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/analytics/dashboard` | dashboard:read | `{kpis, runsByDay, captcha, confidenceHist, learning, providerUsage, apiStatus, profiles, recent, timeSaved}` |
| GET / PUT | `/analytics/policy` | read: dashboard:read · write: policy:write | `{requireReviewEveryStep, captchaSolvingEnabled, captchaMaxSpendDailyUsd, maxRunsPerDomainPerDay, maxConcurrentRuns, aiProviderOrder, captchaProviderOrder, autoAcceptConfidence, allowAutoSubmit}` |
| GET | `/analytics/audit?action=&before=&limit=` | audit:read | Includes `hash` for chain verification |

## Health
`GET /healthz` (liveness) · `GET /readyz` (checks Postgres and Redis)
