# WooPulse CRM: Conclusions

What we built, how every part works, where the data comes from and where it lives, how it is secured, and what Redis does. Each point in `docs/video-talking-points.md` is mapped to its implementation at the end. Statements are based on the code at the time of writing (October 13, 2026) and on the evidence in `CRM_ISSUES.md` / `audit/results/`. Where something is **not** implemented, this document says so.

---

## 1. What the product does

**WooPulse is a CRM for WooCommerce stores.** It connects to a store, keeps a live copy of its customers and orders, and turns store events into customer operations:

| Capability | What the user gets |
|---|---|
| **Live sync** | Customers and orders are imported once over the WooCommerce REST API, then kept up to date in real time by signed WooCommerce webhooks. |
| **Customer 360** | One page per customer: contact details, lifetime value, order count, average order value, tags, risk flags, order history, and a single timeline of orders, status changes, notes, tasks, emails and AI insights. |
| **Order tracking** | Filter orders by status, amount, date and customer. Each order shows line items, payment method, its status history (built from webhook transitions), the automations that ran for it, and why it is at risk. |
| **At-risk detection** | Deterministic rules flag orders such as a high-value order on hold, on hold for more than 24 h, processing for more than 72 h, failed payment, a loyal customer cancelling, or a refund pattern. |
| **Automated workflows** | Trigger → conditions → actions, for example "order goes on hold → send an apology email and open a support task". Every run is logged. |
| **AI assistant** | Grounded customer summaries, follow-up email drafts, and a tool-using copilot. The AI can draft but **never sends**; a person approves every email. |
| **Team access** | Admin and Agent roles, with login brute-force protection. |
| **Sync health** | Store connection, sync status, the webhook event log, queue and cache status, and a retry button for failed events. |

---

## 2. Tech stack

| Layer | Technology | Used for |
|---|---|---|
| Language | TypeScript (server and client) | One typed language end to end |
| Backend | Node.js 24, Express 5 | REST API, webhook receiver, serves the built UI |
| Validation | Zod | Every request body/query, workflow definition and AI tool argument |
| Database | SQLite through Prisma ORM 6 | Persistent CRM data (PostgreSQL-portable schema) |
| Queue | BullMQ 6 on Redis 7 (in-process fallback without Redis) | Webhook processing in a separate worker |
| Cache & rate limits | Redis 7 via ioredis (in-memory fallback) | Dashboard/at-risk cache, login lockout counters |
| Auth | JSON Web Tokens (jsonwebtoken), bcryptjs | Login sessions, password hashing |
| Frontend | React 19, Vite, Tailwind CSS 4, TanStack Query, React Router, lucide-react | CRM UI, data fetching with polling |
| AI | Any OpenAI-compatible API; default Groq `openai/gpt-oss-120b` | Summaries, drafts, copilot agent |
| Tests | Vitest + Supertest | 48 unit and integration tests |
| Packaging | Dockerfile, docker-compose (Redis/API/worker; local WordPress + WooCommerce) | Deployment and local store |

---

## 3. Architecture at a glance

```
 WooCommerce store ──REST (import)──────────────▶ Sync service ─┐
 (real, or built-in mock) ──signed webhooks──▶ Webhook receiver │
                                               │ 1 verify HMAC  │
                                               │ 2 save event   │
                                               │ 3 enqueue      │
                                               ▼                ▼
                                        Redis / BullMQ ──▶ Worker process ──▶ SQLite (Prisma)
                                                           upsert, status       ▲
                                                           events, workflows    │
 React UI ──HTTP + JWT──▶ Express API ──────────────────────────────────────────┘
                              │   ▲
                              │   └─ Redis cache (dashboard, at-risk) + login rate limits
                              └────▶ LLM API (Groq) for summaries, drafts, copilot
```

**Processes:**
- **API** (`server/src/server.ts`): HTTP API, webhook intake, serves the UI in production.
- **Worker** (`server/src/worker.ts`, `npm run worker`): consumes the BullMQ queue. Without Redis the API processes the queue itself.
- **Frontend** (`client/`): Vite dev server in development; static files served by the API in production.
- **Redis**: a separate server (WSL or Docker) when `REDIS_URL` is set.

---

## 4. Where the data comes from and how it is fetched

### 4.1 From WooCommerce into WooPulse
| Path | How | Code |
|---|---|---|
| **Initial import / full resync** | The API calls `GET /wp-json/wc/v3/customers` and `/orders`, 50 per page, following the `X-WP-TotalPages` header. Customers first, then orders oldest-first. Retries on HTTP 429/5xx with exponential backoff. | `server/src/integrations/woocommerce/woocommerce.client.ts`, `server/src/modules/sync/sync.service.ts` |
| **Authentication to WooCommerce** | Over **HTTPS**: consumer key/secret as HTTP Basic auth. Over plain **HTTP** (local stores), WooCommerce requires **OAuth 1.0a**, so every request is signed with HMAC-SHA256. | `woocommerce.client.ts`, `woocommerce.oauth.ts` |
| **Real-time changes** | WooCommerce **pushes** `order.created/updated` and `customer.created/updated` webhooks to `POST /api/webhooks/woocommerce`. We never poll the store. | `server/src/modules/webhooks/` |
| **Mapping** | Webhook and REST payloads have the same shape, so one mapper converts them (GMT dates, money strings → numbers, guest detection). | `woocommerce.mapper.ts` |
| **Which store** | `WOO_STORE_URL` + keys in `server/.env`. If empty, the **built-in mock WooCommerce store** at `/mock-woo` is used. It implements the same REST endpoints, checks OAuth signatures, and sends signed webhooks. | `server/src/mock-woo/` |

### 4.2 From WooPulse to the browser
- The React app talks **only** to the WooPulse API (`/api/*`), never to WooCommerce, Redis or the LLM. This was verified in the audit by scanning `client/src`.
- Every request carries the JWT in an `Authorization: Bearer` header (`client/src/lib/api.ts`).
- **TanStack Query** caches responses and **polls** (every 3 s on the dashboard, orders and order detail; 4–5 s elsewhere). Polling is how the UI shows webhook changes without a page refresh; there are no WebSockets.

### 4.3 From WooPulse to the AI
- The server builds a compact **JSON snapshot** of one customer's real data (profile, metrics, orders, risk flags, recent activity) and sends it to the LLM with instructions to use only that data and cite order numbers.
- The copilot doesn't receive the database. It asks for data by **calling typed tools** (for example `search_customers` or `get_at_risk_orders`), which run normal service functions on the server.

---

## 5. How and where the data is stored

### 5.1 SQLite database (the source of truth)
A single SQLite file (`server/prisma/dev.db` locally), accessed only through Prisma (`server/prisma/schema.prisma`):

| Table | Holds | Key integrity rules |
|---|---|---|
| `User` | CRM logins: email, name, **bcrypt password hash**, role | unique email |
| `Store` | Sync status, last sync time, last error | single row |
| `Customer` | Contact details, guest flag, tags (JSON text) | unique `wooCustomerId` (null for guests), unique email |
| `Order` | Status, total, currency, payment method, line items (JSON text), created/modified dates | unique `wooOrderId`; `wooModifiedAt` used to ignore stale events |
| `OrderStatusEvent` | Every status transition: previous → new, source (`SYNC`/`WEBHOOK`/`CRM`), time | written in the **same transaction** as the order update |
| `Activity` | Notes, tasks, emails (`DRAFT`/`SENT`), AI summaries, with origin (`user`/`ai`/`workflow:<key>`) | linked to customer (and optionally order) |
| `Workflow` | Trigger, conditions and actions (JSON text), active flag | unique `key` |
| `WorkflowRun` | Every execution with per-action results | **unique (workflow, webhook event)**, so a retry can't run a workflow twice |
| `WebhookEvent` | Every raw webhook delivery, its status, attempts, sanitized error, and **saved outcome** | unique delivery ID |

- **Derived, not stored:** lifetime value, order count and average order value are computed from the orders table. WooCommerce REST v3 no longer returns these, and guest orders never appear in `/customers`. LTV counts `processing`, `on-hold` and `completed` orders and excludes `pending`, `cancelled`, `refunded` and `failed`.
- **Why SQLite:** zero infrastructure for a judge to run. Changing the Prisma `provider` to PostgreSQL is the production path, and the schema avoids SQLite-only features. PostgreSQL is **not** used today.

### 5.2 Redis (temporary data only)
Queued jobs, cached dashboard/at-risk results, cache statistics and login-attempt counters (details in §7). Nothing in Redis is the only copy of anything important. Every webhook is in SQLite before it reaches Redis.

### 5.3 Other places
| Where | What |
|---|---|
| Server memory | The mock WooCommerce store's data (regenerated on every restart) and, without Redis, the fallback queue and cache |
| Browser `localStorage` | The login token (JWT) only |
| `server/.env` (git-ignored) | Secrets: WooCommerce keys, webhook secret, JWT secret, LLM key, Redis URL |
| Local WooCommerce containers (optional) | MySQL data of the test store, in Docker volumes |

---

## 6. Security: hashing, signing and encryption

| Mechanism | Algorithm / tool | Protects |
|---|---|---|
| **Password hashing** | **bcrypt** (bcryptjs), cost factor 10, per-password salt | Stored passwords. Only the hash is stored and it is never returned by the API (audited). |
| **Session tokens** | **JWT signed with HMAC-SHA256** (`HS256`) using `JWT_SECRET`, 12 h expiry | Who you are and your role. Tampering with the role claim is rejected (audited). Note: JWTs are **signed, not encrypted**. They contain id, email, name and role, nothing secret. |
| **Webhook authenticity** | **HMAC-SHA256** over the **raw request body** with the webhook secret, compared with **`crypto.timingSafeEqual`** | Forged "order cancelled" events. Forged requests get 401 and change nothing (audited). |
| **Requests to WooCommerce over HTTP** | **OAuth 1.0a**, HMAC-SHA256 signature, random nonce and timestamp | Proves our requests come from the key holder |
| **Brute-force protection** | Redis counters: 5 failed logins per IP + email per 15 min → 429 + `Retry-After`; a correct password doesn't bypass the lockout | Password guessing |
| **Authorization** | Role checks (`ADMIN`/`AGENT`) on every admin-only endpoint, mirrored by disabled controls in the UI | Resync, retry events, toggling workflows |
| **Input validation** | Zod schemas on all inputs, including AI tool arguments | Malformed or oversized input |
| **AI safety** | No send-email tool and no SQL; drafts need human approval | Autonomous emails, data damage |
| **Secret handling** | Secrets only in server environment variables; `.env` is git-ignored; no secret is ever sent to the browser or returned by an endpoint (audited) | Key leakage |
| **Error sanitization** | Stored webhook errors are reduced to short messages (no file paths or database internals) | Information leakage |

**Not implemented: encryption at rest.** Be precise about this:
- The SQLite file is **not encrypted**.
- WooCommerce credentials live in plain environment variables and are **not encrypted at rest** (MR-06).
- **TLS/HTTPS** is not handled by the app. It must come from the hosting platform or a reverse proxy.
- Open security findings: the mock store is enabled by default even in production and its admin page is unauthenticated (AUD-009); default secrets are accepted in production (AUD-010); CORS allows any origin (AUD-017).

---

## 7. What Redis does in our server

Redis does **three separate jobs**. All three were verified live on October 13, 2026 against Redis 7.0.15 running in WSL Ubuntu.

### 7.1 Message queue (BullMQ): decouples receiving from processing
1. **API:** verifies the webhook signature and saves the event to `WebhookEvent` as `PENDING`.
2. **API:** adds a BullMQ job `{ eventId }` to the queue `woopulse-webhooks` in Redis. The **job ID is the event ID**, so the same event can't be queued twice. It then replies **202** in milliseconds.
3. **Worker process:** takes the job, upserts the customer/order, records the status transition, **saves the outcome (including the workflow trigger)**, runs the workflows, marks the event `PROCESSED`, and invalidates the cache.
4. **Retries:** 3 attempts with exponential backoff (500 ms base). After the last one the event is marked `FAILED` with a sanitized reason and can be retried from *Sync health*.
5. **Ordering:** the worker runs with concurrency 1, so status changes for an order are applied in arrival order.

Redis keys you can see: `bull:woopulse-webhooks:*`.
Live proof: the "apology email" for order #5051 was printed by the **worker** process, not the API.

### 7.2 Shared cache (cache-aside)
- The dashboard and the store-wide at-risk scan are stored in Redis for **30 s** (`woopulse:cache:dashboard:v1`, `woopulse:cache:at-risk:all:v1`).
- **Invalidation across processes:** after each processed webhook, the **worker** deletes those keys, so the API's next request recomputes fresh numbers. That's why the cache must live in Redis and not in a variable inside one process. Syncs and new activities also invalidate it.
- Hit/miss counters (`woopulse:cache:stats`) are shown on *Sync health*.
- If Redis fails, the cache **fails open**: the value is recomputed.
- Honest note: at demo data size this demonstrates the pattern; we haven't measured a speed-up.

### 7.3 Login rate limiting
- Key `woopulse:ratelimit:login:<ip>:<email>`, using `INCR` + `EXPIRE` in one atomic `MULTI`.
- Every API instance shares the same counter, and the keys delete themselves after 15 minutes.
- If Redis fails, it **fails open**, so users aren't locked out of the CRM.

### 7.4 When Redis is unavailable
- **`REDIS_URL` empty:** the same code uses an in-process queue and an in-memory cache. Tests and a quick start need no Redis.
- **`REDIS_URL` set but Redis down:** every queue call has a 1 s limit. The webhook is still saved as `PENDING` and acknowledged in about 1 s, and a sweeper re-queues `PENDING` events every 30 s once Redis is back. This was a real bug found by our audit (AUD-022, requests hung) and fixed with a regression test.
- **Why the database stays the source of truth:** Redis keeps data in memory and can lose its most recent writes in a crash, so no webhook exists *only* in Redis.

### 7.5 Why not Kafka
Kafka is for high-volume event streams with many independent consumers and long-term replay. We have one consumer type and a store's order volume. BullMQ is a job queue, which is exactly the problem.

---

## 8. Key flows, step by step

**Order changes status in WooCommerce:** WooCommerce sends a signed webhook → HMAC check → saved `PENDING` → queued in Redis → 202 → worker applies it. A stale event is `IGNORED`. Otherwise the order update and the `OrderStatusEvent` are written in one transaction → outcome saved → matching workflows run (each at most once per event; a broken one fails alone) → emails and tasks appear on the timeline → cache invalidated → the UI picks it up on its next poll (≤ 3 s).

**Agent asks for an AI summary:** the API builds a JSON snapshot of the customer → LLM returns summary, behaviour, risks, next best action and cited order numbers → stored as an `AI_SUMMARY` activity → shown with its sources. Without an LLM key it falls back to a rule-based summary.

**AI drafts an email:** the draft is saved as an `EMAIL` activity with status `DRAFT` → the agent edits it in the timeline → *Approve & send* → status `SENT`. The current transport records and logs the email; no real mail is delivered (no SMTP).

**Login:** bcrypt compare → on failure, the Redis counter goes up (lockout after 5) → on success the counter resets and a 12 h JWT is issued.

---

## 9. Talking points vs. implementation

| Talking point (`docs/video-talking-points.md`) | How we implemented it | Status |
|---|---|---|
| §1 Problem: scattered customer knowledge | CRM with Customer 360, timeline, risks, workflows, AI | ✅ Built |
| §2 Tech stack | As listed in §2 of this document | ✅ Built (SQLite, not PostgreSQL) |
| §3.1 Signed webhooks, raw body, timing-safe | `woocommerce.signature.ts`, raw-body route in `webhook.routes.ts` | ✅ Verified (tests + audit) |
| §3.2 Creation ping | `webhook_id=` ping → 200 | ✅ Verified |
| §3.3 Guest checkout by normalised email | `mapGuestCustomerFromOrder`, `upsertCustomer` | ✅ Verified. ⚠️ A *second* guest order **without any email** is lost (AUD-003, open) |
| §3.4 LTV computed from our own orders | `customer.metrics.ts` | ✅ Verified (dashboard revenue = Σ LTV) |
| §3.5 OAuth 1.0a over HTTP | `woocommerce.oauth.ts` | ✅ Works against the mock (which verifies signatures); ⏳ not yet tested against a real WooCommerce store |
| §4 Persist first, then queue | `webhook.service.ts`, `queues/webhook-queue.ts` | ✅ Verified live with Redis |
| §4 Why Redis + BullMQ | Separate worker, job-ID deduplication, retries, ordering | ✅ Verified live |
| §4 Database as source of truth / Redis down | Timeout-bounded queue calls + PENDING sweeper | ✅ Fixed and verified (AUD-022) |
| §4 Retry safety | Saved outcome + unique run per (workflow, event) + per-workflow isolation | ✅ Verified (AUD-002 fixed) |
| §4 Redis cache | Cache-aside, worker invalidation, hit/miss stats | ✅ Verified live |
| §4 Rate limiting | Redis `INCR`/`EXPIRE` lockout | ✅ Verified (AUD-016 fixed) |
| §4 Fallback without Redis | In-process queue and memory cache behind one interface | ✅ Verified (whole test suite runs without Redis) |
| §5 Keys and secrets | WooCommerce keys, webhook secret, JWT secret, Groq key, `REDIS_URL` in `server/.env` | ✅ `.env` loading fixed (AUD-001). Default model updated after Groq retired the old one (AUD-020) |
| §6a Dockerfile | Two-stage image, API serves UI | ⏳ Written, **not built yet** (Docker unusable on the dev machine) |
| §6b docker-compose (Redis/API/worker) | `docker-compose.yml` | ⏳ Written, not run. Redis was run natively in WSL instead |
| §6c Local WooCommerce store | `docker-compose.woocommerce.yml`, WP-CLI provisioning, must-use plugin | ⏳ Written, not run (same Docker problem) |
| §6d Mock store + webhook simulator | `/mock-woo`, `npm run simulate` | ✅ Used throughout testing and the demo |
| §7 Workflows | 5 seeded workflows, run log, failures isolated | ✅ All 5 verified. ❌ No delayed/scheduled workflows; ❌ no real SMTP |
| §8 AI layer | Rules decide, AI explains; grounded summaries; tool-using copilot; no send tool; no SQL | ✅ Summaries and drafts verified with the live LLM. ⚠️ **Copilot can crash** when the model sends `null` for an optional tool argument (AUD-021, open) |
| §9 Engineering quality | Tests, audit plan, issues log, architecture doc | ✅ 48 tests; two audit runs. ⚠️ `docs/architecture.md` is outdated about Redis (AUD-023) |
| §10 What NOT to claim | PostgreSQL, SMTP, encrypted credentials, Playwright, delayed workflows, production-readiness | Still accurate. "We use Redis/BullMQ" **can now be claimed**; it was verified live |

## 10. What we added beyond the talking points

- **A continuous QA audit** (`CRM_AUDIT_PLAN.md`, `CRM_ISSUES.md`, `audit/`): 124 traced requirements. Every defect has reproduction steps, evidence, a fix and a regression test. Two audit runs (R1, AUDIT-R2) found **23 defects**; **7 were fixed and verified** (AUD-001, 002, 004, 015, 016, 020, 022).
- **Production defaults probing:** the audit showed which insecure defaults remain (AUD-009/010), rather than assuming.
- **A Redis-outage regression test** that runs the real intake path against a closed Redis port.
- **Retry-safe workflows** with at-most-once side effects per event.
- **A design-system pass on the UI:** neutral palette with one accent, avatars, aligned figures, grouped navigation, global customer search, and a live sync indicator.
- **Sanitized error storage** and observable queue/cache health on *Sync health*.

## 11. Known limitations (open as of this document)

| ID | Severity | Limitation |
|---|---|---|
| AUD-003 | HIGH | A second guest order without any billing email is not ingested |
| AUD-021 | HIGH | Copilot aborts on some model tool calls (summaries and drafts are unaffected) |
| AUD-005/006 | MEDIUM | WooCommerce requests have no timeout; network errors aren't retried |
| AUD-007/008 | MEDIUM | Customer email collisions and concurrent first upserts can fail |
| AUD-009/010 | MEDIUM | Mock store and default secrets are enabled in production by default |
| AUD-011 | MEDIUM | "Time in status" for imported orders is measured from creation |
| AUD-019 | MEDIUM | LLM-cited sources aren't validated against real records |
| MR-01…MR-11 | — | Not built: PostgreSQL, migrations/seed, SMTP, delayed workflows, encrypted credentials, Playwright, separate queues per job type |

**Overall:** WooPulse is a working, tested prototype. The core path (sync → signed webhook → Redis queue → worker → status history → workflows → AI summary and human-approved draft) was verified end to end. It is **not production-ready**. See `CRM_ISSUES.md` for the full list and the prioritised plan.

---

## 12. 3-minute product demo: what to show and what to say

A screen-by-screen script for a video that shows **how the product looks and works**. Every step uses a path that was verified working. Speak in your own words; the *Say* lines are guides, about 400 words in total, which is roughly 3 minutes at a natural pace.

### Before you press record (2 minutes)
- [ ] **Redis is running:** the Ubuntu window with `redis-server` is open (`redis-cli ping` → `PONG`).
- [ ] **The app is running:** http://localhost:5173 loads. The worker is running (the *Sync health* page shows **Queue: BullMQ (Redis)**).
- [ ] **Two browser tabs:** Tab 1 is the CRM (http://localhost:5173), logged in as `admin@woopulse.dev` / `demo1234`. Tab 2 is the mock store admin (http://localhost:4000/mock-woo/).
- [ ] **Pick your demo order in Tab 2 now:** one whose status is `processing`. Note its number. Only use orders listed on that page, because the mock store resets when the app restarts.
- [ ] **Customer for the AI part:** Priya Sharma (she has an on-hold order and a risk flag).
- [ ] **Don't open the AI Copilot page** on camera (known bug AUD-021). Summaries and drafts are safe.
- [ ] Browser zoom at 110–125% so text is readable; close other tabs and notifications.

### The script

| Time | Screen and action | Say |
|---|---|---|
| **0:00–0:15** | **Dashboard.** Don't click yet. | "Store owners on WooCommerce see orders, but not customers: who's valuable, who's at risk, who needs a follow-up. WooPulse is a CRM that connects to a WooCommerce store and turns its live events into customer operations." |
| **0:15–0:40** | **Dashboard.** Point at the KPI strip, then the coloured status bar, then *Needs attention*. Point at the green **Live** indicator in the top bar. | "This is live store data: revenue, orders, customers and open tasks. The bar shows every order by status. Below, *Needs attention* lists orders our risk rules flagged, like a high-value order stuck on hold, each with the reason. The green *Live* badge means the webhook pipeline is healthy." |
| **0:40–1:00** | **Top-bar search:** type `priya`, press Enter → click **Priya Sharma**. | "Everything is searchable. This is Customer 360: contact details, lifetime value, order count and average order value, calculated from the actual orders. Cancelled and refunded orders don't count as revenue. On the left are her risk flags and order history; on the right, one timeline of everything that happened with this customer." |
| **1:00–1:20** | Click **Summarize customer**. Wait for the result and point at **Sources**. | "The AI summarises the customer, but only from her real CRM data, and it cites the orders it used, here #5036 and #5001. The risks come from deterministic rules; the AI explains them and suggests the next action." |
| **1:20–1:45** | Type a goal like `Apologise for the delay on her order`, choose **Apologetic** and her on-hold order → **Draft follow-up email**. Scroll to the draft in the timeline, change a word, click **Approve & send**. | "It can draft a personalised follow-up. It's saved as a draft, and the AI can never send it by itself: a person reviews and edits, then approves. That's a deliberate safety decision." |
| **1:45–2:20** | **Switch to Tab 2** (mock store admin). On your demo order, choose **on-hold** → **Update**. **Switch back to Tab 1**, go to **Orders**, open that order. Show its **Status history** and **Automation runs**. | "Now the real-time part. This is the store's admin; I'll put an order on hold. WooCommerce sends a signed webhook. WooPulse verifies the signature, saves the event, and queues it in Redis, and a separate worker processes it. Within seconds the order shows the transition from processing to on-hold, and the *on-hold* workflow already ran." |
| **2:20–2:35** | Click **Workflows**. Point at the newest entry in the **Execution log**, then at a workflow card's *When / If / Then*. | "Workflows are trigger, conditions and actions. This one sent an apology email and opened a support task automatically, and every run is logged with exactly what it did. If one automation breaks, it fails alone and never runs twice." |
| **2:35–2:50** | Click **Sync health**. Point at **Queue: BullMQ (Redis)**, **Cache · hits**, and the event log. | "Under the hood: Redis with BullMQ queues webhook jobs for the worker, caches the dashboard, and rate-limits logins. The database stays the source of truth, so even if Redis goes down, no webhook is lost. Every event is visible here, and failed ones can be retried." |
| **2:50–3:00** | Back to **Dashboard**. | "WooPulse: a live customer 360, automated follow-ups, and an AI that drafts but never sends without a human. Built and tested end to end. Thanks for watching." |

### If something goes wrong while recording
| Problem | What to do |
|---|---|
| Order didn't change in the CRM within ~5 s | Check that the order number exists in Tab 2 (the mock store resets on restart), then open *Sync health* to see whether the event arrived. Pick another `processing` order and retry. |
| AI summary shows an error | Network or LLM hiccup. Click again once. If it persists, skip that segment and show the risk flags instead: "the risk rules flag this order because…". |
| Sync health shows "In-process" instead of BullMQ | Redis or the worker isn't running. Either restart them, or don't make Redis claims in this take. |
| Login says "Too many failed login attempts" | The lockout works as designed; wait 15 minutes or log in as `agent@woopulse.dev`. |

### Optional extras if you have spare seconds
- **Orders → "At risk" filter chip:** "one click shows every flagged order."
- **Log in as the agent** (`agent@woopulse.dev`): the workflow toggles and *Full resync* are disabled. "Agents work with customers; only admins change automations."
- **Mock store → "+ Simulate new order"** over 200: the **VIP workflow** creates a personal thank-you task and tags the customer `vip`.
