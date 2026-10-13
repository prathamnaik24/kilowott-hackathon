# WooPulse CRM — Audit Plan & Traceability Matrix

> Maintained under the *Continuous QA Audit and Persistent Issue Tracking* policy. Requirements are traced from the WooPulse project specification (the "Spec") and the QA audit supplement (the "Audit Spec", §2). Existing requirements are preserved; nothing here weakens them. A row is only marked **PASS** when a test or probe produced evidence. A file or route merely existing does not count.

## Audit run metadata

| Field | Value |
|---|---|
| Latest run | **R1** |
| Date (UTC) | 2026-10-13T09:38Z – 10:05Z |
| Commit | `37b564f48251b87be42b2802854f15238a7ab1d6` (branch `main`, clean working tree) |
| Environment | Windows 11, Node v24.15.0, npm 11.12.1, Prisma 6.19.3, SQLite |
| Mode | Read-only audit: no production code changed |
| Test DB | Isolated throwaway SQLite DB in the session scratchpad (`audit.db`) plus the suite's own `server/prisma/test.db`. The dev DB `server/prisma/dev.db` was **not** touched. |
| Audit server | `npx tsx src/server.ts` on port **4100** with explicit env: `DATABASE_URL=<scratch>/audit.db`, `JWT_SECRET=audit-jwt-secret-xyz`, `WOO_WEBHOOK_SECRET=audit-webhook-secret`, `LLM_API_KEY=` (empty), mock store enabled |
| Synthetic data | Deterministic mock WooCommerce store (12 registered customers, 3 guests, 53 orders) plus synthetic webhook payloads (Woo order IDs 990001–990100) |

### Commands executed in R1
| Command | Result |
|---|---|
| `npm test` (root) | 6 files, **38/38 passed** |
| `npm run typecheck` (root) | exit 0 |
| `npm run build` (root) | exit 0 (client bundle + server `dist/`) |
| `npm run dev` (root, 8 s probe) | **failed**: `'concurrently' is not recognized`. Environment issue, see ENV-02 |
| `docker build -t woopulse-audit .` | **blocked**: Docker daemon not running (ENV-01) |
| `node audit/probes/api-probe.mjs` | 47 checks → raw results in `audit/results/R1/api-probe-results.json` |
| `npx tsx audit/probes/deep-probe.mts` (audit DB) | 7 checks → `audit/results/R1/deep-probe-results.json` |
| `npx tsx audit/probes/env-probe.mts` | config-loading probe (AUD-001) |
| `npx tsx audit/probes/wf-count.mts` (audit DB) | runs per seeded workflow |

> The probe scripts hard-code the R1 scratchpad DB path and port 4100. To re-run them, point `DATABASE_URL` at a fresh throwaway DB, start the audit server as above, and update the paths. They refuse to run against a DB whose path doesn't contain `scratchpad`.

### Common preconditions
- **P-SRV**: the audit server is running (see above), the initial mock sync has completed, and the admin and agent demo users exist.
- **P-ADM / P-AGT**: a JWT obtained via `POST /api/auth/login` for `admin@woopulse.dev` / `agent@woopulse.dev` (password `demo1234`).
- **P-SIG**: webhooks are signed with `base64(HMAC-SHA256(body, "audit-webhook-secret"))`.
- **P-DB**: direct Prisma access to the isolated audit DB only.

### Status legend
PASS · FAIL · BLOCKED · NOT RUN · NOT APPLICABLE · NEEDS REVIEW. The **Issue** column links to `CRM_ISSUES.md` (AUD-xxx = defect, MR-xx = missing requirement, ENV-xx = environment blocker).

---

## Requirement → test matrix

Every row was last tested in run **R1** at commit `37b564f` on 2026-10-13.

### ARCH — Architecture and repository structure
| Req | Source | Expected behaviour | Test | Type | Preconditions / data | Steps | Actual result | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| ARCH-01 | Audit Spec §2 Architecture | Frontend calls only the Express API, never WooCommerce directly | T-ARCH-02 | manual (code) | — | Inspect every network call in `client/src` | All requests go through `api()` → `/api/*`. The only `/mock-woo` reference is a link to the mock admin page. | PASS | `client/src/lib/api.ts`, `pages/Settings.tsx` | — |
| ARCH-02 | Audit Spec §2; Spec "Architecture" table | PostgreSQL is the primary persistent DB | T-ARCH-03 | manual (code) | — | Inspect `datasource` | `provider = "sqlite"` | FAIL | `server/prisma/schema.prisma:9` | MR-01 |
| ARCH-03 | Audit Spec §2; Spec "Queue" | Redis + BullMQ process background jobs, with a separate worker | T-ARCH-07 | manual (code) | — | Inspect queue implementation and dependencies | In-process `JobQueue`; no Redis/BullMQ dependency; no worker app | FAIL | `server/src/lib/job-queue.ts`, `server/package.json` | MR-03 |
| ARCH-04 | Audit Spec §2 | API, frontend and worker start with the documented commands | T-ARCH-04 | integration | Fresh shell in repo root | Run `npm run dev`, `npm test`, `npm run build` | `npm test` and `build` pass. `npm run dev` fails because `concurrently` is missing from `node_modules` (the lockfile includes it). No worker command exists. | BLOCKED | command output R1 | ENV-02, MR-03 |
| ARCH-05 | Audit Spec §2 | No production feature silently relies on fake data or in-memory persistence | T-ARCH-05 | manual (code + API) | P-SRV | Inspect defaults; GET `/api/store` | The mock store is **on by default** (`MOCK_WOO_ENABLED=true`, also in production) and holds its state in memory. The UI labels it "Mock WooCommerce (demo)". CRM data is persisted. Not silent, but production defaults to fake data. | NEEDS REVIEW | `server/src/config/env.ts`, `/api/store` → `mode: "mock"` | AUD-009 |
| ARCH-06 | Spec Phase 0 | Health endpoint | T-ARCH-01 | API | P-SRV | GET `/api/health` | 200 | PASS | api-probe T-ARCH-01 | — |
| ARCH-07 | Spec Phase 7 | Container image builds (deployment path) | T-ARCH-06 | integration | Docker daemon | `docker build .` | Daemon unavailable | BLOCKED | `failed to connect to the docker API` | ENV-01 |
| ARCH-08 | Spec Phase 0 | Configuration from `.env` is honoured | T-ARCH-08 | integration | `server/.env` with `JWT_SECRET=change-me-in-production` | `env-probe.mts`: import config, connect Prisma, compare | App config uses the **default** `dev-only-change-me`. Prisma loads `.env` only after the config has been parsed. | FAIL | env-probe output | AUD-001 |

### AUTH — Authentication and authorization
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| AUTH-01 | Spec "Auth" | Admin can log in | T-AUTH-01 | API | P-SRV | POST `/api/auth/login` (admin) | 200 + token | PASS | api-probe | — |
| AUTH-02 | Spec "Auth" | Agent can log in | T-AUTH-02 | API | P-SRV | POST login (agent) | 200 + token | PASS | api-probe | — |
| AUTH-03 | Audit Spec §2 Security (negative cases) | Wrong password → 401 | T-AUTH-03 | security | P-SRV | POST login with a bad password | 401 `Invalid email or password` | PASS | api-probe; suite `rejects bad credentials` | — |
| AUTH-04 | Audit Spec §2 | CRM endpoints reject missing or invalid tokens | T-AUTH-04 | security | P-SRV | GET `/api/customers` with no token and with a garbage token | 401 / 401 | PASS | api-probe; suite `requires a token` | — |
| AUTH-05 | Audit Spec §2 (ADMIN vs AGENT backend) | AGENT is forbidden from admin actions | T-AUTH-05 | security | P-AGT | As agent: POST `/store/sync`, POST `/store/webhooks/retry`, PATCH `/workflows/:id` | 403 / 403 / 403 | PASS | api-probe; suite `agents cannot toggle workflows` | — |
| AUTH-06 | Audit Spec §2 (ADMIN vs AGENT frontend) | Admin-only controls are disabled or hidden for AGENT in the UI | T-AUTH-06 | E2E | Browser automation | Log in as agent, inspect the Workflows and Sync health pages | Not executed. Code shows `disabled={role !== 'ADMIN'}` on the toggle, resync and retry controls. | NOT RUN | `Workflows.tsx`, `Settings.tsx` | ENV-04, MR-08 |
| AUTH-07 | Audit Spec §2 (cross-user/cross-store) | Cross-user and cross-store isolation | T-AUTH-07 | — | — | — | Single-store deployment. CRM records are shared team data by design, with no per-user ownership. | NOT APPLICABLE | README "Scope and limitations" | — |

### DB — Database, Prisma, constraints, integrity
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| DB-01 | Audit Spec §2; Spec "Prisma migrations" | Prisma migrations apply from a clean environment | T-DB-03 | integration | Empty DB | Look for `prisma/migrations`; apply | No migrations directory. Schema is applied with `prisma db push`, which does work on a clean DB (audit DB created OK). | FAIL | `ls server/prisma` → no `migrations/` | MR-02 |
| DB-02 | Audit Spec §2; Spec Phase 7 "seed script" | Seed script works from clean | T-DB-04 | integration | Empty DB | Look for `prisma db seed` / seed script | None. Users and workflows are seeded idempotently by `bootstrap()` at boot, which works on a clean DB. No seed command. | FAIL | `server/src/bootstrap.ts`, `server/package.json` | MR-02 |
| DB-03 | Spec "Data model" (unique keys per store) | Unique `wooOrderId`, `wooCustomerId`, `email`, `deliveryId`, workflow `key` | T-DB-05 | manual + API | P-SRV | Inspect schema; repeated sync and duplicate delivery | Constraints present; duplicates prevented | PASS | `schema.prisma`; T-WOO-04, T-WEBHOOK-04 | — |
| DB-04 | Audit Spec §2 (relationships) | Activities cannot reference inconsistent customer/order pairs | T-DB-01 | API | P-ADM | POST `/api/activities` with customer A and an order of customer B | 201 Created | FAIL | api-probe T-DB-01 | AUD-014 |
| DB-05 | Audit Spec §2 (concurrent updates) | Concurrent upserts don't corrupt or fail | T-DB-02 | integration | P-DB | 2× parallel `upsertCustomer` of the same new email | 1 of 2 rejected with P2002 | FAIL | deep-probe T-DB-02 | AUD-008 |
| DB-06 | Audit Spec §2 Webhook ("transactions") | Order write and status event commit atomically | T-DB-06 | manual (code) | — | Inspect `upsertWooOrder` | `prisma.$transaction` wraps both | PASS | `ingest.service.ts` | — |
| DB-07 | Audit Spec §3 | Tests use an isolated DB | T-DB-07 | manual | — | Inspect test setup | Suite uses throwaway `prisma/test.db` | PASS | `tests/global-setup.ts`, `vitest.config.ts` | — |

### CUSTOMER — Customer management and Customer 360
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| CUSTOMER-01 | Audit Spec §2 Woo sync | Guest orders matched on normalized billing email | T-CUSTOMER-01 | API | P-SIG | 2× `order.created`, `customer_id=0`, same email in different case | 1 guest customer, 2 orders | PASS | api-probe; suite `creates a guest customer` | — |
| CUSTOMER-02 | Audit Spec §2 (guest orders) | Guest orders without an email are handled | T-CUSTOMER-02 | API | P-SIG | 2× email-less guest orders, different names | The probe's "not merged" check passed only because the **second order was never ingested** (see T-CUSTOMER-06). This result is not valid evidence. | NEEDS REVIEW | api-probe T-CUSTOMER-02 | AUD-003 |
| CUSTOMER-02 | same | same | T-CUSTOMER-06 | integration | P-DB | Inspect the webhook event and order for Woo #990012 | Event FAILED after 3 attempts (`Unique constraint failed on email`); order missing from CRM | FAIL | deep-probe T-CUSTOMER-06 | AUD-003 |
| CUSTOMER-03 | Audit Spec §2 (customers without linked accounts) | A registered customer changing to an email held by a guest record is merged or handled | T-CUSTOMER-03 | API | P-SIG | `customer.created` (new email), then `customer.updated` with the guest's email | Event FAILED after 3 attempts | FAIL | api-probe T-CUSTOMER-03 | AUD-007 |
| CUSTOMER-04 | Spec Phase 4 (notes/tasks) | Notes and tasks persist and appear on the timeline | T-CUSTOMER-04 | API | P-AGT | POST note; GET timeline | 201; visible | PASS | api-probe | — |
| CUSTOMER-05 | Audit Spec §2 financial | LTV excludes cancelled, refunded and failed orders | T-CUSTOMER-05 | API + unit | P-SRV | Recompute each customer's LTV from the order list | 0 mismatches. Note: `pending` is also excluded, a policy choice the owner should confirm. | PASS | api-probe; unit `computeCustomerMetrics` | — |
| CUSTOMER-06 | Spec Phase 2 (search) | Search by name or email, case-insensitive | T-CUSTOMER-07 | API | P-AGT | `/customers?search=priya` | 1 match | PASS | suite `logs in and lists customers` | — |
| CUSTOMER-07 | Audit Spec §2 Frontend | Customer 360 page shows backend data | T-UI-03 | E2E | Browser | Open `/customers/:id` | Not executed in a browser. The API (`/customers/:id`, `/timeline`, `/risks`) is exercised by the probes. | NOT RUN | — | ENV-04, MR-08 |

### ORDER — Orders, status history, financial calculations
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| ORDER-01 | Audit Spec §2 (status transitions) | Real transitions recorded with previous/new status and source | T-ORDER-01 | API | P-SIG | `order.updated` processing → on-hold | Event `processing → on-hold`, source `WEBHOOK` | PASS | api-probe; suite `records status transitions` | — |
| ORDER-02 | Audit Spec §2 (dashboard agrees) | Dashboard revenue equals Σ customer LTV | T-ORDER-02 | API | P-SRV | Compare | 16968.5 = 16968.5 | PASS | api-probe | — |
| ORDER-03 | same | Dashboard order KPI equals order count | T-ORDER-03 | API | P-SRV | Compare | 56 = 56 | PASS | api-probe | — |
| ORDER-04 | Spec Phase 5 (long on-hold) | Time-in-status measured from when the status was entered | T-ORDER-04 | API | Mock order: on-hold, created 40h ago, modified 30h ago | GET `/orders/at-risk` | Flag reports **40h** on hold; it was modified 30h ago | FAIL | api-probe T-ORDER-04 | AUD-011 |
| ORDER-05 | Audit Spec §2 AI ("risk rules deterministic, unit-tested") | Risk rules are pure and unit-tested | T-ORDER-05 | unit | — | `npm test` | 5 rule tests pass | PASS | `tests/unit/risk-and-metrics.test.ts` | — |
| ORDER-06 | Spec Phase 2 (filters) | Filter by status, date range, customer, amount | T-ORDER-06 | API | — | — | Filters were used in probes, but their result sets weren't asserted against independent data | NOT RUN | — | — |

### WOO — WooCommerce API integration and initial sync
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| WOO-01 | Audit Spec §2 | All orders imported, across pages | T-WOO-01 | integration | P-SRV (53 orders > `per_page` 50 → 2 pages) | Compare store `X-WP-Total` with the CRM | 53 = 53 | PASS | api-probe | — |
| WOO-02 | Audit Spec §2 | Customers imported, guests derived | T-WOO-02 | integration | P-SRV | Compare | 12 registered + 3 guests | PASS | api-probe | — |
| WOO-03 | Audit Spec §2 | Sync status and timestamps reflect outcomes | T-WOO-03 | API | P-SRV | GET `/api/store` | `SUCCESS` + timestamp. Failure path not exercised. | PASS | api-probe | — |
| WOO-04 | Audit Spec §2 | Repeated sync creates no duplicates | T-WOO-04 | API | P-ADM | POST `/store/sync` again | 53→53 orders, 15→15 customers | PASS | api-probe | — |
| WOO-05 | Spec Phase 1 (auth) | Invalid consumer keys rejected | T-WOO-05 | API | — | Wrong Basic auth against the mock | 401 | PASS | api-probe | — |
| WOO-06 | Audit Spec §2 (timeouts) | Requests to a hung store time out | T-WOO-06 | integration | TCP server that never responds | `getCustomers()` with an 8s race | Still pending after 8s; no timeout | FAIL | deep-probe | AUD-005 |
| WOO-07 | Audit Spec §2 (API failures) | Transient network errors retried with backoff | T-WOO-07 | unit | `fetchImpl` throws `TypeError` | `getCustomers()` | 1 attempt; HTTP 429/5xx are retried, network errors aren't | FAIL | deep-probe | AUD-006 |
| WOO-08 | Audit Spec §2 (partial sync failures); Spec Phase 1 (`PARTIAL`) | One bad record doesn't abort the sync; `PARTIAL` status | T-WOO-08 | manual (code) | — | Inspect `doSync` | A single try/catch around the whole import; no `PARTIAL` state | FAIL | `sync.service.ts` | MR-07 |
| WOO-09 | Audit Spec §2 | Older updates don't overwrite newer state | T-WEBHOOK-05 | API | P-SIG | Send an `order.updated` 30 days older | Status kept; event `IGNORED` | PASS | api-probe; suite `ignores out-of-order` | — |
| WOO-10 | Spec "Real WooCommerce integration" | Works against a real WooCommerce store | T-WOO-09 | E2E | A WordPress + WooCommerce instance | Connect, sync, webhooks | No real store available | BLOCKED | — | ENV-05 |

### WEBHOOK — Verification, persistence, idempotency
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| WEBHOOK-01 | Audit Spec §2 | Form-encoded creation ping works | T-WEBHOOK-01 | API | — | POST `webhook_id=42` | 200 `{ping:true}` | PASS | api-probe; suite | — |
| WEBHOOK-02 | Audit Spec §2 | Invalid signature rejected, nothing applied | T-WEBHOOK-02 | security | P-SRV | Forged signature | 401; order unchanged | PASS | api-probe; suite | — |
| WEBHOOK-03 | Audit Spec §2 | HMAC-SHA256 over exact raw body, timing-safe compare | T-WEBHOOK-06 | unit + code | — | Signature unit tests; inspect route | `express.raw` on the route, `timingSafeEqual`, tamper tests pass | PASS | `signature.test.ts`, `webhook.routes.ts` | — |
| WEBHOOK-04 | Audit Spec §2 | Processing queued, not inline; fast acknowledgement | T-WEBHOOK-03 | API | P-SIG | Valid `order.updated` | 202, then applied asynchronously | PASS | api-probe | — |
| WEBHOOK-05 | Audit Spec §2 | Duplicate delivery ID not reprocessed | T-WEBHOOK-04 | API | P-SIG | Resend the same delivery ID | `duplicate:true` | PASS | api-probe; suite | — |
| WEBHOOK-06 | Audit Spec §2 | Stale events handled per `date_modified` | T-WEBHOOK-05 | API | P-SIG | See WOO-09 | `IGNORED` | PASS | api-probe | — |
| WEBHOOK-07 | Audit Spec §2 | Failures recorded with useful, **sanitized** errors | T-SEC-06 | security | P-SIG | Cause a processing failure; read `/api/store` | Error is recorded, but contains Prisma invocation text and absolute server file paths | FAIL | api-probe T-SEC-06 | AUD-015 |
| WEBHOOK-08 | Audit Spec §2 | Failed events can be retried safely | T-WEBHOOK-07 | API | FAILED events exist | POST `/store/webhooks/retry` and re-check | Not executed in R1 | NOT RUN | — | — |

### QUEUE — Worker reliability and retries
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| QUEUE-01 | Audit Spec §2 | Transient failures retried with exponential backoff | T-QUEUE-03 | unit | — | `npm test` | 3 queue tests pass | PASS | `job-queue.test.ts` | — |
| QUEUE-02 | Audit Spec §2 | Duplicate jobs don't send duplicate emails or activities | T-QUEUE-01 | API | P-SIG | Replay the same payload with a new delivery ID | No new status events, runs or emails | PASS | api-probe | — |
| QUEUE-03 | Audit Spec §2 (permanent failures observable/recoverable) | Queue keeps working after a failure-handler error | T-QUEUE-02 | unit | `onFailed` throws | Enqueue a failing job, then a good job | Good job **never processed**; queue stuck (`running` stays true); 1 unhandled rejection | FAIL | deep-probe | AUD-004 |
| QUEUE-04 | Spec Phase 3 | Events left PENDING are resumed after a restart | T-QUEUE-04 | integration | — | Kill mid-processing, restart | Not executed (`requeueEvents` exists at boot) | NOT RUN | `server.ts` | — |
| QUEUE-05 | Audit Spec §2; Spec "Queue" | Redis + BullMQ queues | T-ARCH-07 | manual | — | — | Not implemented | FAIL | — | MR-03 |

### WORKFLOW — Triggers, conditions, actions, history
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| WORKFLOW-01 | Spec Phase 4 | On-hold → apology email + support task | T-WORKFLOW-01 | API | P-SIG | processing → on-hold | 1 run, SUCCESS, `[SEND_EMAIL, CREATE_TASK]` | PASS | api-probe; suite | — |
| WORKFLOW-02 | Audit Spec §2 | Workflow actions create Activity records | T-WORKFLOW-02 | API | P-SIG | Read timeline | 1 email + 1 task with `origin=workflow:on-hold-apology` | PASS | api-probe | — |
| WORKFLOW-03 | Spec Phase 4 ("≥3 working workflows") | Every seeded workflow executes successfully | T-WORKFLOW-05 | integration | Audit DB after the probes | Count runs per key | on-hold 1, review 1, vip 3, retention 1, welcome 1, all SUCCESS | PASS | `wf-count.mts` output | — |
| WORKFLOW-04 | Audit Spec §2 (failure behaviour) | One failing workflow doesn't stop other matching workflows | T-WORKFLOW-03 | integration | Audit-only workflows `audit-bogus` (invalid action) and `audit-after` (valid) on → completed | Send `order.updated` → completed | `audit-after` **never ran**. Event retried and marked **PROCESSED** after 2 attempts. | FAIL | deep-probe | AUD-002 |
| WORKFLOW-05 | Audit Spec §2 | Workflow failures are observable (FAILED run/event) | T-WORKFLOW-04 | integration | same | same | No FAILED run; event PROCESSED | FAIL | deep-probe | AUD-002 |
| WORKFLOW-06 | Audit Spec §2; Spec Phase 4 ("on hold 24 h") | Delay configuration works in demo and normal modes | T-WORKFLOW-06 | manual | — | Inspect the engine | No delayed or scheduled workflows | FAIL | `workflow.engine.ts` | MR-05 |
| WORKFLOW-07 | Audit Spec §2 | Each seeded workflow has tests for trigger, conditions, actions and failure | T-WORKFLOW-07 | manual | — | Inspect the suite | Integration tests cover on-hold, VIP and welcome triggers. No tests for review-request, retention, or any failure path. | FAIL | `tests/integration/webhook-pipeline.test.ts` | MR-08 |
| WORKFLOW-08 | Spec data model (`WORKFLOW_RUN` activity) | Every execution produces a WorkflowRun **and** an Activity | T-WORKFLOW-08 | integration | Audit DB | Count `type=WORKFLOW` activities | 0. Only action-level activities exist; an `ADD_TAG`-only workflow would leave no activity. | FAIL | `wf-count.mts` | MR-09 |
| WORKFLOW-09 | README ("historical import doesn't trigger workflows") | Initial sync triggers no workflows | T-WORKFLOW-09 | integration | Fresh DB | Sync, then count runs | Not asserted in R1 | NOT RUN | — | — |

### EMAIL — Delivery and communication safety
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| EMAIL-01 | Audit Spec §2 AI ("explicit confirmation") | Emails stay DRAFT until approved; approval sends the edited content | T-EMAIL-01 | API | P-AGT | Create EMAIL without `send`; POST `/send` with edits | DRAFT → SENT with the edited subject | PASS | api-probe | — |
| EMAIL-02 | same | A sent email cannot be re-sent | T-EMAIL-02 | API | P-AGT | POST `/send` again | 400 | PASS | api-probe | — |
| EMAIL-03 | Audit Spec category EMAIL; Spec "Email" | Delivery via SMTP/Mailpit | T-EMAIL-03 | manual | — | Inspect `deliver()` | Log transport only | FAIL | `email.service.ts` | MR-04 |

### AI — Tools, summaries, drafting, risk explanations
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| AI-01 | Audit Spec §2 | Tools use typed services; no SQL generated or executed | T-AI-04 | API + code | P-AGT | GET `/ai/status`; inspect `crm-tools.ts` | 7 Zod-validated tools over Prisma services; no SQL, send or delete tool | PASS | api-probe; code | — |
| AI-02 | Audit Spec §2 | Summary grounded in real records (rules mode) | T-AI-01 | API | No LLM key | POST summary; compare sources with the customer's orders | Sources `#5036,#5001` ⊆ the customer's orders | PASS | api-probe | — |
| AI-03 | Audit Spec §2 | Summary and risk text grounded in LLM mode; no invented facts | T-AI-05 | API | LLM key | POST summary and copilot; validate cited records | Not executed: no key. Code shows LLM `sources` are returned **unvalidated**. | BLOCKED | `ai.service.ts` | ENV-03, AUD-019 |
| AI-04 | Audit Spec §2 | AI drafts stored as editable DRAFT, never auto-sent | T-AI-02 | API | P-AGT | POST draft; read timeline | DRAFT, `origin=ai` | PASS | api-probe | — |
| AI-05 | Audit Spec §2 | Sending an AI email requires explicit user confirmation | T-EMAIL-01 + T-AI-04 | API | — | — | No send tool; send only through the human `/send` endpoint | PASS | api-probe | — |
| AI-06 | Audit Spec §2 | Agent tool permissions ≤ the user's authority | T-AI-06 | manual (code) | — | Inspect the tool set | Tools only read or create tasks/drafts, which AGENT may already do; no admin-only actions | PASS | `crm-tools.ts` | — |
| AI-07 | Spec Phase 5 | Copilot degrades gracefully without an LLM | T-AI-03 | API | No key | POST copilot | Explanatory message, no tool calls | PASS | api-probe | — |
| AI-08 | Audit Spec category AI ("risk explanations") | AI explains risk flags | T-AI-07 | manual | — | Inspect | Rule reasons, suggested actions and summary risks exist. There's no dedicated LLM risk-explanation endpoint. | NEEDS REVIEW | `risk.rules.ts`, `ai.service.ts` | — |

### UI — Routes, forms, states, API integration
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| UI-01 | Audit Spec §2 | Every client route is reachable | T-UI-01 | API | Built client | GET 9 routes from the API host | All 200 (SPA fallback) | PASS | api-probe | — |
| UI-02 | Audit Spec §2 | Routes gated by auth state (redirect to `/login`) | T-UI-02 | E2E | Browser | Visit while logged out | Not executed | NOT RUN | `main.tsx` `Protected` | ENV-04 |
| UI-03 | Audit Spec §2 | Loading, empty, validation and error states | T-UI-04 | manual (code) | — | Inspect pages | Loading and empty states present. Note/task composer and tag editor **show no error on failure.** | FAIL | `Customer360.tsx` (`ActivityComposer`, `TagEditor`) | AUD-018 |
| UI-04 | Audit Spec §2 | Forms, filters, notes and tasks persist through the UI | T-UI-05 | E2E | Browser | — | API-level persistence passes (T-CUSTOMER-04); UI not driven | NOT RUN | — | ENV-04 |
| UI-05 | Audit Spec §2 | Rendered dashboard agrees with backend | T-UI-06 | E2E | Browser | — | API figures consistent (T-ORDER-02/03); rendering not verified | NOT RUN | — | ENV-04 |
| UI-06 | Spec Phase 6 | Client typechecks and builds | T-UI-07 | build | — | `npm run typecheck && npm run build` | exit 0 | PASS | R1 commands | — |

### SEC — Secrets, access control, validation
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| SEC-01 | Audit Spec §2 | Password hashes never exposed | T-SEC-01 | security | P-SRV | Inspect the login response | Keys `id,email,name,role` | PASS | api-probe | — |
| SEC-02 | Audit Spec §2 | Inputs validated | T-SEC-02 / T-SEC-09 | security | — | Invalid email; `limit=100000`; `sort=__proto__` | 400 / 400 / 400 | PASS | api-probe | — |
| SEC-03 | Audit Spec §2 | Malformed JSON → 4xx, not 500 | T-SEC-07 | security | — | POST `{bad json` | **500** | FAIL | api-probe | AUD-012 |
| SEC-04 | Audit Spec §2 | Invalid foreign keys → 4xx, not 500 | T-SEC-08 | security | — | Activity for an unknown customer | **500** | FAIL | api-probe | AUD-013 |
| SEC-05 | Audit Spec §2 | No stack traces in API responses | T-SEC-10 | security | — | 404 and error bodies | No stacks in HTTP responses | PASS | api-probe | — |
| SEC-06 | Audit Spec §2 | Woo credentials never returned by the API | T-SEC-05 | security | — | Scan `/api/store` | Not present | PASS | api-probe | — |
| SEC-07 | Audit Spec §2 | Woo credentials encrypted at rest | T-SEC-12 | manual | — | Inspect storage | Held in plain environment variables; nothing stored or encrypted in the DB | FAIL | `env.ts` | MR-06 |
| SEC-08 | Audit Spec §2 (secrets handling) | No insecure default secrets in production | T-SEC-13 | manual + probe | — | Inspect defaults; env-probe | Defaults `JWT_SECRET=dev-only-change-me`, a known webhook secret and demo passwords are accepted with no production guard. With AUD-001, they are used even when `.env` sets values. | FAIL | `env.ts`, env-probe | AUD-010, AUD-001 |
| SEC-09 | Audit Spec §2 | Store data cannot be mutated anonymously | T-SEC-11 | security | P-SRV | Anonymous POST `/mock-woo/panel/orders/:id/status` | 303; CRM order became `cancelled` | FAIL | api-probe | AUD-009 |
| SEC-10 | Spec Phase 6 (security notes) | Login brute-force protection | T-SEC-03 | security | — | 15 bad logins | All 401, no throttling | FAIL | api-probe | AUD-016 |
| SEC-11 | Audit Spec §2 | CORS limited to known origins | T-SEC-04 | security | — | Request with `Origin: evil` | `Access-Control-Allow-Origin: *` | FAIL | api-probe | AUD-017 |

### TEST — Automated, E2E and regression coverage
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| TEST-01 | Audit Spec §5.2 | Automated suite passes in the documented environment | T-TEST-01 | unit + integration | — | `npm test` | 38/38 | PASS | R1 output | — |
| TEST-02 | Audit Spec §2, §5.3 | Playwright scenario 1 (login → … end to end) passes | T-TEST-02 | E2E | — | — | No Playwright setup or tests exist | FAIL | no `playwright` in repo | MR-08 |
| TEST-03 | Audit Spec §2, §5.3 | Playwright signed-webhook scenario verifies persisted update and workflow run | T-TEST-03 | E2E | — | — | Absent. The behaviour itself is verified at API level (T-WEBHOOK-03, T-WORKFLOW-01). | FAIL | — | MR-08 |
| TEST-04 | Spec Phase 6 | Frontend component tests | T-TEST-04 | unit | — | — | None | FAIL | — | MR-08 |
| TEST-05 | Audit Spec §3 | A regression test exists for each fixed defect | T-TEST-05 | — | — | — | No fixes made yet | NOT APPLICABLE | — | — |

### DOCS — Setup, architecture, deployment, demo
| Req | Source | Expected | Test | Type | Pre/data | Steps | Actual | Status | Evidence | Issue |
|---|---|---|---|---|---|---|---|---|---|---|
| DOCS-01 | Spec Phase 6 | README quick start works as written | T-DOCS-01 | manual | — | Follow the README | The `.env` step is silently ignored (AUD-001). `npm run dev` fails in this working copy (ENV-02). | FAIL | env-probe; R1 commands | AUD-001 |
| DOCS-02 | Spec Phase 6 | Architecture doc with webhook sequence and ER diagrams | T-DOCS-02 | manual | — | Read `docs/architecture.md` against the code | Present and consistent with the implementation, except the claim that failures are visible and retryable (contradicted by AUD-002/004) | NEEDS REVIEW | `docs/architecture.md` | AUD-002 |
| DOCS-03 | Spec Phase 6 doc list | `api.md`, `data-model.md`, `woocommerce-setup.md`, `workflows.md`, `ai-agent.md`, `testing.md`, `deployment.md`, `demo-script.md` | T-DOCS-03 | manual | — | List `docs/` | Only `architecture.md`. Setup, testing and deployment are covered briefly in the README. | FAIL | `docs/` | MR-10 |
| DOCS-04 | Audit Spec §5 | Docs state LTV rules accurately | T-DOCS-04 | manual | — | Compare the README with `REVENUE_STATUSES` | README omits that `pending` is also excluded | NEEDS REVIEW | `customer.metrics.ts` | — |

---

## R1 status totals (matrix rows)

| Status | Count |
|---|---|
| PASS | 50 |
| FAIL | 35 |
| BLOCKED | 4 |
| NOT RUN | 9 |
| NOT APPLICABLE | 2 |
| NEEDS REVIEW | 5 |
| **Total rows** | **105** |

*Counted with `grep` over this file's status column after writing (see the verification note in `CRM_ISSUES.md`). These are matrix rows. A requirement can have several rows, and one probe can support several rows.*
