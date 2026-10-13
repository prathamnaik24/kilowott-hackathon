# WooPulse CRM: Video Talking Points

Reference notes for recording the demo video. Each section has **the point**, the **reasoning** you can say in your own words, and, where useful, a **one-liner** for when time is short.

> ⚠️ **Accuracy rule.** The judges' AI compares this video with the code. Only claim what's in the repo. The section *"What NOT to claim"* at the end lists the tempting but false statements. Being honest about a trade-off scores better than overclaiming.

> 🔴 **Before recording: verify Redis live.** The Redis/BullMQ code is written and the build passes, but as of 2026-10-13 it has only been tested on the no-Redis fallback (Docker wasn't running). Run `docker compose up -d redis`, set `REDIS_URL=redis://localhost:6379`, run `npm run dev`, and check that *Sync health* shows **Queue: BullMQ (Redis)** and **Cache: Redis** before you say any of section 4 on camera.

---

## 1. The problem (open with this, ~15 s)

- WooCommerce powers millions of stores, but the store owner's customer knowledge is scattered. Orders live in WP Admin, conversations live in an inbox, and follow-ups live in someone's head.
- WooCommerce shows *orders*. It doesn't give you a *customer relationship* view: lifetime value, history, risk, and what to do next.
- **WooPulse** connects to WooCommerce, keeps a live CRM copy of customers and orders, automates follow-ups, and adds an AI assistant that works on that data.

**One-liner:** *"WooPulse turns WooCommerce events into customer operations: a live customer 360, automated follow-ups, and an AI agent that drafts but never sends without a human."*

---

## 2. Tech stack: what and why

| Layer | What we use | Why |
|---|---|---|
| Language | **TypeScript** everywhere (server + client) | One language end to end, shared mental model, and the compiler catches shape mismatches between WooCommerce payloads, the DB and the UI. In a 4-hour build, type errors caught at compile time are bugs you never debug. |
| Backend | **Node.js + Express 5** | A webhook receiver is just an HTTP endpoint; Express is the smallest, best-understood way to build it. Express 5 forwards errors from async handlers automatically, so there's no try/catch boilerplate in every route. |
| Validation | **Zod** | Every request body, query string, workflow definition and AI tool argument is validated at runtime. TypeScript only checks at compile time; Zod protects runtime boundaries, where data comes from WooCommerce, users or the LLM. |
| ORM | **Prisma** | The schema is one readable file (`server/prisma/schema.prisma`), queries are type-safe, and transactions are easy. Changing `provider` moves it from SQLite to PostgreSQL. |
| Database | **SQLite** (via Prisma) | Zero infrastructure: the demo runs with `npm install && npm run dev`, with no DB server to install or deploy. It's a real relational DB with unique constraints, foreign keys and transactions, which is everything our integrity rules rely on. **We would switch to PostgreSQL for production** (concurrent writers, managed backups); the schema was written to be portable (string enums, JSON as text). |
| Queue, cache, rate limiting | **Redis 7 + BullMQ** (with an in-process fallback) | See section 4. One Redis instance does three separate jobs: the **message queue** between the API and a separate worker, a **shared cache** that the worker can invalidate, and **atomic counters** for login rate limiting. |
| Frontend | **React + Vite + TailwindCSS** | Vite starts and rebuilds instantly. Tailwind meant we never left the component file to style it. React is what most people (and judges) can read. |
| Data fetching | **TanStack Query** | Caching, loading and error states, and **polling every 3 seconds**. That polling is how the UI updates "live" when a webhook arrives, without building a WebSocket server. |
| Auth | **JWT + bcrypt**, roles `ADMIN` / `AGENT` | Stateless tokens fit a single API serving a single-page app. bcrypt for password hashing is the standard choice. Two roles, because a store has owners (who resync and change automations) and support staff (who work with customers). |
| AI | **Any OpenAI-compatible endpoint, defaulting to Groq** (`llama-3.3-70b-versatile`) | See section 5. We call the HTTP API directly with `fetch`, with no vendor SDK, so switching provider is one environment variable. |
| Tests | **Vitest + Supertest** | Vitest is fast and TypeScript-native. Supertest drives the real Express app against a real throwaway SQLite database. |

**One-liner:** *"Every choice optimised for one thing: a judge can clone the repo and see it working in two commands, while the architecture still has a clear path to production."*

---

## 3. Why WooCommerce webhooks + REST (the integration design)

- **Two channels:**
  - The **REST API** (`/wp-json/wc/v3/customers`, `/orders`) does the *initial import* and full resyncs. It's paginated, and the client follows the `X-WP-TotalPages` header.
  - **Webhooks** (`order.created`, `order.updated`, `customer.created`, `customer.updated`) carry *real-time* changes. WooCommerce pushes to us, so we never poll the store.
- **Why not scraping or polling:** both are fragile and slow. Webhooks are WooCommerce's official event mechanism, and their payloads have the same shape as the REST resources, so a single mapper handles both.

### Details worth mentioning (they show depth)
1. **Signed webhooks.** WooCommerce signs every webhook with `base64(HMAC-SHA256(raw body, secret))` in the `X-WC-Webhook-Signature` header. We verify it with a **timing-safe comparison**, using the **raw bytes** of the body. Re-serialised JSON wouldn't match, so the webhook route deliberately skips the JSON parser.
2. **The creation ping.** When you create a webhook, WooCommerce first sends a form-encoded `webhook_id=…` ping. If that doesn't get a 200, WooCommerce won't save the webhook. We handle it explicitly.
3. **Guest checkout.** Guest orders arrive with `customer_id = 0`. We match them to a CRM customer by **normalised billing email**. If the guest later registers, the records merge.
4. **WooCommerce REST v3 no longer returns `total_spent`/`orders_count` for customers**, and guest orders never appear in `/customers` anyway. So **lifetime value is computed from our own order data**, excluding cancelled, refunded, failed and pending orders.
5. **Over plain HTTP, WooCommerce rejects consumer key/secret Basic auth** and requires **OAuth 1.0a request signatures**. Our client uses Basic auth over HTTPS and OAuth 1.0a signatures over HTTP (the local Docker store). Same API, both auth modes.

---

## 4. Event processing with Redis: persist first, then queue

### What actually happens when a webhook arrives
1. **API:** verify the signature. A forged request gets **401**, and nothing is stored.
2. **API:** **persist the raw event** in the `WebhookEvent` table (topic, payload, delivery ID, status `PENDING`).
3. **API:** add a job to the **BullMQ queue in Redis**, then reply **202 Accepted** immediately. WooCommerce retries slow responses, so we acknowledge fast.
4. **Worker** (a *separate process*, `npm run worker`) takes the job:
   - upserts the customer/order (idempotent),
   - detects a **status transition** and records it in `OrderStatusEvent` (inside a transaction with the order update),
   - **saves the outcome, including the workflow trigger, before running workflows**,
   - runs the matching workflows,
   - marks the event `PROCESSED`, `IGNORED` (stale) or `FAILED`,
   - **invalidates the cached dashboard** in Redis.
5. Failed jobs are retried **3 times with exponential backoff** by BullMQ. After that the event is marked `FAILED` and can be retried from the *Sync health* page.

### Why Redis + BullMQ
- **It decouples receiving from processing.** The API's only job is "verify, save, enqueue, reply". Slow work (database writes, workflow actions, emails) happens in the worker. A burst of webhooks can't slow down the CRM for agents, and the API and worker can be restarted or scaled independently.
- **Jobs survive restarts.** If the worker crashes or is redeployed, the queued jobs are still in Redis and resume when it comes back.
- **Built-in reliability.** BullMQ gives us retries with exponential backoff and a failed-job set out of the box, instead of reinventing them.
- **Deduplication.** The BullMQ **job ID is the webhook event ID**, so if the same event is queued twice (for example after a restart), Redis ignores the second one.
- **Ordering.** The worker runs with **concurrency 1**, because order status transitions must be applied in the order they happened. To scale, you'd shard queues per store.

### Why the database is still the source of truth (a strong point)
- Redis is fast because it's in memory, which means it can lose the most recent writes in a crash. So every event is saved to the database **before** it goes to Redis.
- **If Redis is down**, the webhook is still accepted and saved as `PENDING`. A sweeper re-queues `PENDING` events every 30 seconds once Redis is back. A webhook is never lost because of Redis.

### Retry safety: never lose a trigger, never email twice
- The outcome of each event (including "this order just went on-hold") is saved **before** workflows run. If the worker crashes halfway, the retry reuses the saved trigger instead of trying to re-detect a status change that's already in the database.
- A workflow run is **unique per (workflow, event)** and is claimed *before* its actions execute. A retry skips workflows that already ran, so **a customer can never get the same email twice**.
- A broken workflow fails on its own and is logged as `FAILED`; the other workflows still run.

### Redis job 2: caching
- The dashboard and the store-wide at-risk scan are cached in Redis for 30 seconds (**cache-aside**: read the cache, otherwise compute and store).
- **Why it has to be Redis and not a variable in memory:** the worker is a different process. When it processes a webhook, it deletes the cached keys in Redis, so the API's next request recomputes fresh numbers. **Cache invalidation across processes** is the hard part of caching, and that's what this shows.
- If Redis fails, the cache **fails open**: the value is just recomputed and the request still works.
- *Sync health* shows the cache **hit rate**, so you can point at it on camera.
- **Be honest on video:** at our data size this demonstrates the pattern; we haven't measured a real speed-up.

### Redis job 3: login rate limiting
- 5 failed logins per IP + email locks that login for 15 minutes, and the response includes a `Retry-After` header. A correct password doesn't bypass an active lockout.
- It uses `INCR` + `EXPIRE` in one atomic `MULTI`: every API instance shares the same counter, and the keys delete themselves when the window ends.

### Fallback without Redis
- If `REDIS_URL` is empty, the same code uses an in-process queue and an in-memory cache behind one small interface. A judge can still run the app with zero infrastructure, and the 47 tests run without Redis.

### Why not Kafka
Kafka is for high-throughput event *streams* with many independent consumers and long-term replay. We have one consumer type and low volume (a store's orders). Kafka would add brokers, topics, partitions and offsets for no benefit. BullMQ is a **job queue**, which is exactly our problem.

**One-liner:** *"The API saves and queues, a separate worker processes. Redis gives us the queue, a cache the worker can invalidate, and atomic rate limiting, while the database stays the source of truth, so even a Redis outage doesn't lose a webhook."*

---

## 5. The API keys and secrets: what each one is for

| Key / secret | Where it comes from | What it does | Why it's set up this way |
|---|---|---|---|
| **WooCommerce Consumer Key + Consumer Secret** | WooCommerce → Settings → Advanced → REST API → *Add key* | Authenticates WooPulse's **REST calls** to the store (import customers/orders, resync) | **Read/Write** permission so the CRM can also update orders later. They stay **server-side only** (environment variables), are never sent to the browser, and are never returned by any API endpoint (verified in the audit). |
| **Webhook secret** (`WOO_WEBHOOK_SECRET`) | You choose it; it goes in the *Secret* field of each WooCommerce webhook | WooCommerce uses it to **sign** each webhook; we use it to **verify** that the request really came from the store | Without it, anyone who found the URL could forge "order cancelled" events. The webhook endpoint is public, so the signature is the authentication. |
| **JWT secret** (`JWT_SECRET`) | You generate a long random string | Signs the login tokens for CRM users (12-hour expiry) | Anyone holding it could mint an admin token, so it must be a strong, unique value in deployment. |
| **LLM API key** (`LLM_API_KEY`, Groq) | console.groq.com → API Keys | Lets the server call the language model for summaries, drafts and the copilot | **Why Groq:** a free tier with no card, very fast responses (good for a live demo), an **OpenAI-compatible** API (so OpenAI, OpenRouter or a local **Ollama** model work by changing `LLM_BASE_URL`), and Llama 3.3 70B supports **tool calling**, which the agent needs. Without a key, summaries and drafts fall back to rule-based output, so the demo never breaks. |
| **Redis URL** (`REDIS_URL`) | `redis://localhost:6379` from `docker compose up -d redis` | Connects the API and worker to the queue, cache and rate limiter | Not a secret locally, but a hosted Redis URL contains a password, so it's treated like one (server-side only). Empty means the in-process fallback is used. |
| **Demo logins** | Seeded on first boot | `admin@woopulse.dev` and `agent@woopulse.dev` show the two roles | Demo convenience. The audit flags that production must not use default passwords or secrets (issue AUD-010). |

**Security principle to say:** *"Secrets live only on the server. The browser talks only to our API, never to WooCommerce, Redis or the LLM."*

---

## 6. Docker: what it's actually doing

There are **three uses of Docker** in this project. Don't blur them.

### 6a. `Dockerfile`: packaging WooPulse for deployment
- One image contains the Express API **and** the built React app. The API serves the UI, so the CRM deploys as **one image**; the worker runs from the same image with a different command.
- It's a two-stage build: stage 1 installs dependencies and compiles TypeScript and the React bundle; stage 2 copies the result into a clean Node image.
- **Why:** "works on my machine" problems disappear. The judges' environment, the cloud host and my laptop all run the exact same image.

### 6b. `docker-compose.yml`: Redis, API and worker
| Container | Image | Role |
|---|---|---|
| `redis` | `redis:7-alpine` (~15 MB download) | Queue, cache and rate limiter. **AOF persistence** (`--appendonly yes`) means queued jobs survive a Redis restart. A health check makes the API and worker wait until Redis answers. |
| `api` | built from the `Dockerfile` | Receives webhooks, serves the CRM API and UI. |
| `worker` | the same image, `npm run worker` | Consumes the BullMQ queue. |

- For local development you usually run only `docker compose up -d redis`, and the API, worker and UI run on your laptop with `npm run dev`.

### 6c. `docker-compose.woocommerce.yml`: a real WooCommerce store on your laptop
**Why we needed it:** hosted WordPress sandboxes such as InstaWP now ask for a credit card even for free sites. A local store is free, private and fully under our control.

**What each container does:**
| Container | Image | Role |
|---|---|---|
| `wordpress-db` | `mysql:8.0` | The database WordPress and WooCommerce store their data in. A health check makes WordPress wait until MySQL is ready. |
| `wordpress` | `wordpress:php8.2-apache` | The actual store: WordPress + PHP + Apache, at **http://localhost:8080**. This is where you change order statuses in the demo. |
| `woocommerce-setup` | `wordpress:cli-php8.2` | A **one-shot provisioning script** (WP-CLI). It installs WordPress, installs and activates WooCommerce, enables pretty permalinks (the REST API needs them), seeds products, customers and orders (including two guest-checkout orders), creates the REST API key, and registers the four signed webhooks. It's idempotent, so re-running it is safe. |

**Why it's about 1 GB:** each image is a full Linux system plus a server (MySQL ~600–800 MB, WordPress+PHP+Apache ~700 MB). It's downloaded once and cached.

**Volumes** (`wordpress_data`, `wordpress_db_data`) persist the store between restarts.

**Networking: the tricky part, worth explaining:**
- Inside a container, `localhost` means *that container*, not your laptop. So WooCommerce **can't** reach `http://localhost:4000`.
- If WooPulse runs on your laptop (`npm run dev`), webhooks go to **`http://host.docker.internal:4000`**, which is Docker's name for the host machine.
- If WooPulse runs inside the same Compose network, webhooks go to **`http://api:4000`**, using the service name as hostname.
- WordPress blocks outgoing requests to private IPs and unusual ports for security (`wp_safe_remote_request`). We ship a tiny **must-use plugin, for the local test store only**, that allows exactly those WooPulse hosts on port 4000. It also makes webhook delivery synchronous, because WordPress's background scheduler can't reach itself inside the container.

**One-liner:** *"Docker gives us Redis, our API and worker, and a real WooCommerce store, with real REST and real signed webhooks, on a laptop, with no hosted service."*

### 6d. The built-in mock store (the safety net)
- WooPulse also ships a **WooCommerce-compatible mock store** at `/mock-woo`. It implements the same REST endpoints (including OAuth signature checks) and sends the same signed webhooks.
- **Why:** the demo and the tests can't fail because an external store is down. It goes through **exactly the same code path** as a real store: the same client, signature check and ingestion.
- There's also a CLI **webhook simulator** (`npm run simulate -w server -- <orderId> <status>`) that sends a correctly signed webhook. It proves the receiver, verification, queue, worker, DB update and workflows without touching the store UI.

---

## 7. Workflows (communication automation)

- A workflow is **trigger → conditions → actions**:
  - Triggers: `ORDER_CREATED`, `ORDER_STATUS_CHANGED`, `CUSTOMER_CREATED`
  - Conditions: field comparisons such as `order.newStatus eq "on-hold"` or `order.total gte 200`
  - Actions: `SEND_EMAIL` (templated with `{{customer.firstName}}`), `CREATE_TASK`, `ADD_TAG`
- Five are seeded: on-hold → apology email + support task; completed → review request; high-value order (≥ 200) → VIP task + tag; cancelled → retention task + churn-risk tag; new customer → welcome email.
- **Observability:** every run is logged with per-action results. The *Workflows* page shows the execution log, so you can see exactly what automation did and why. A broken workflow shows up as `FAILED` without stopping the others.
- **The initial import does not trigger workflows**, only live events do. Connecting a store never emails your existing customers.
- Email currently uses a **log transport**: sent emails are recorded on the customer timeline and printed by the server. A real SMTP or Resend provider plugs into one function.

---

## 8. The AI layer: why it isn't "a chatbot in a sidebar"

1. **Rules decide, AI explains.** At-risk orders are flagged by **deterministic, unit-tested rules**: high-value order on hold, on hold > 24 h, processing > 72 h, failed payment, a loyal customer cancelling, a refund pattern. A rule is predictable and testable; an LLM isn't. The AI then summarises and recommends.
2. **Grounded summaries.** The model receives only a JSON snapshot of the customer's real data and is told to cite order numbers. It's instructed never to invent facts or promise refunds or discounts.
3. **A tool-using agent (the copilot).** It plans, calls CRM tools, reads the results, and repeats (up to 6 steps). Tools: `search_customers`, `get_customer_profile`, `get_customer_timeline`, `list_orders`, `get_at_risk_orders`, `create_task`, `draft_email`. Every argument is validated with Zod, and the UI shows the tool trace, so you can *see* what the AI looked up.
4. **Human in the loop:** there is **no send-email tool**. The AI can only save a **draft**. A person reviews, edits and clicks *Approve & send*. This is a deliberate safety decision.
5. **No text-to-SQL.** The agent never writes database queries. It can only call typed functions, so it can't drop a table or read data it shouldn't.

**One-liner:** *"The AI can read, plan, create tasks and draft, but it can't send anything a human hasn't approved."*

---

## 9. Engineering quality (the closing 15 seconds)

- **47 automated tests** (Vitest + Supertest). The unit tests cover the payload mapper (guest orders, timezones), webhook signatures, the workflow condition engine and templates, the risk rules, LTV maths, the retrying queue (including recovery when its failure handler throws), the cache and the rate limiter, and `.env` loading. The integration tests run the **full signed-webhook pipeline** against a real database: the ping, forged-signature rejection, guest creation, duplicate deliveries, status transitions triggering the right workflows, stale events, a broken workflow not stopping the others, retries not repeating side effects, login lockout, auth and role permissions.
- **We audited our own build.** `CRM_AUDIT_PLAN.md` traces every requirement to a test, and `CRM_ISSUES.md` lists what we found, *including real defects*, with reproduction steps and the fixes that have been verified so far. Mention this: it shows engineering maturity rather than a perfect-looking demo.
- Architecture doc with sequence and ER diagrams: `docs/architecture.md`.

---

## 10. What NOT to claim (the code doesn't do these)

| Don't say | Say instead |
|---|---|
| "Redis made the dashboard X times faster" | "The cache demonstrates cache-aside with cross-process invalidation; at our data size we haven't measured a speed-up." |
| "Workflows can be delayed / scheduled (BullMQ delayed jobs)" | Don't mention delays. They were scoped out. |
| "We run multiple workers in parallel" | "The worker runs with concurrency 1 to keep order; sharding per store is the scale-out path." |
| "We use PostgreSQL" | "We use SQLite through Prisma; the schema is portable to PostgreSQL." |
| "Emails are sent via SMTP / Mailpit" | "Emails go through a log transport and are recorded on the timeline; a real provider plugs into one function." |
| "Store credentials are encrypted in the database" | "Credentials live only in server environment variables and are never exposed to the browser or the API." |
| "We have Playwright end-to-end tests" | "We have unit and API-level integration tests covering the full webhook pipeline." |
| "It's production-ready" | "It's a working, tested prototype with a documented path to production and an honest issues list." |

---

## Suggested 2-minute running order

| Time | Show | Say (from the sections above) |
|---|---|---|
| 0:00–0:15 | Dashboard | §1 problem + one-liner |
| 0:15–0:35 | Customers → Customer 360 timeline | §2 stack one-liner; LTV computed from our own orders (§3.4) |
| 0:35–0:55 | WooCommerce admin (localhost:8080, or the mock) → change an order to *on-hold* → CRM updates; terminal shows the **worker** processing the job | §3 webhooks + signature; §4 API saves and queues, worker processes |
| 0:55–1:15 | Workflows page → execution log; timeline shows the apology email + task | §7; retry safety (§4) |
| 1:15–1:45 | AI: Summarize → Draft → Approve & send; Copilot with tool trace | §8 one-liner, human-in-the-loop |
| 1:45–2:00 | *Sync health* (Queue: BullMQ, cache hit rate), `npm test`, `CRM_ISSUES.md` | §4 Redis one-liner; §9 |
