# WooPulse CRM — Issues & Audit Findings

> Latest verified state of defects and audit findings. Issue IDs are stable: never renumber, never delete. Resolved issues move to *Resolved* only after the fix is verified by a regression test.
>
> **Classification:** **Confirmed (reproduced)** = observed failing in R1 with the evidence cited. **Confirmed (inspection)** = deterministic code path read and verified, but not executed. **Suspected** = plausible but not demonstrated. **Missing requirement (MR)** = specified but not implemented. **Environment blocker (ENV)** = the test could not run in this environment.

## Latest audit summary

| Field | Value |
|---|---|
| Run | **R1** (first audit; no prior baseline, so no regressions to compare) |
| Commit / branch | `37b564f48251b87be42b2802854f15238a7ab1d6` / `main` |
| Date | 2026-10-13 (UTC) |
| Mode | Read-only. No production code changed. Probes saved in `audit/probes/`, raw outputs in `audit/results/R1/`. |
| Existing suite | `npm test` → **38/38 pass**; typecheck and build pass |
| Audit probes executed | 54 (47 API + 7 deep). Raw: 38 PASS / 16 FAIL. After review, T-CUSTOMER-02 was **reclassified** from PASS to NEEDS REVIEW because its pass was caused by the defect AUD-003. Final: **37 PASS / 16 FAIL / 1 NEEDS REVIEW**. |
| Traceability matrix | 105 rows: 50 PASS · 35 FAIL · 4 BLOCKED · 9 NOT RUN · 2 NOT APPLICABLE · 5 NEEDS REVIEW (counts verified by parsing `CRM_AUDIT_PLAN.md`) |
| Open defects | 19 found in R1 → **15 open** after fixes (AUD-001/002/004/016 resolved; AUD-015 fix awaiting verification) — 1 high (AUD-003) · 8 medium · 6 low |
| Missing requirements | 10 (MR-01 … MR-10) |
| Environment blockers | 5 (ENV-01 … ENV-05) |

### Verdict: **FAIL**

Reasons:
1. **Material functional defects with silent data loss are confirmed by reproduction**: lost workflow executions (AUD-002), lost guest orders (AUD-003), and a queue that stops processing permanently (AUD-004).
2. **Configuration is broken**: `server/.env` is never applied (AUD-001), so the documented LLM, secret and store settings are ignored.
3. **Mandatory specified requirements are not implemented**: PostgreSQL (MR-01), migrations and seed (MR-02), Redis/BullMQ worker (MR-03), SMTP/Mailpit (MR-04), workflow delays (MR-05), encrypted credentials (MR-06), and both Playwright scenarios (MR-08). Most of these were deliberate scope reductions for the 4-hour hackathon. They count as failures until the project owner explicitly accepts them.

**Unverified requirements** (BLOCKED or NOT RUN): Docker build, `npm run dev` in this working copy, a real WooCommerce store, LLM-mode AI grounding, every browser-level UI requirement, PENDING-event resume after restart, the failed-event retry endpoint, order filter correctness, and "initial sync triggers no workflows".

The core happy paths verified as **working**: signed webhook ingestion (ping, forged-signature rejection, duplicate delivery, stale events, status transitions), idempotent repeated sync, guest matching by normalized email, the five seeded workflows, human-approved email sending, backend RBAC, and dashboard/LTV consistency.

This audit makes **no production-readiness claim**. Operational security, monitoring, backup/recovery and hosted deployment were not evaluated.

---

## Open issues

### AUD-001 — `server/.env` is never loaded into application config
- **Severity:** High · **Priority:** P1 · **Status:** ✅ Resolved (verified 2026-10-13) · **Confirmed (reproduced)**
- **Affected requirements:** ARCH-08, SEC-08, DOCS-01, AI-03 (blocks enabling the LLM)
- **Reproduction:** `server/.env` contains `JWT_SECRET=change-me-in-production`. Run `npx tsx audit/probes/env-probe.mts` from `server/`.
- **Expected:** the app's `env.JWT_SECRET` equals the `.env` value.
- **Actual:** `env.JWT_SECRET used by app = dev-only-change-me`, while `process.env.JWT_SECRET after Prisma connect = change-me-in-production`.
- **Root cause (confirmed):** nothing loads dotenv. `src/config/env.ts` parses `process.env` when the module is evaluated. Prisma loads `.env` into `process.env` later, but `env` is already frozen with defaults. Any value set only in `server/.env` (`LLM_API_KEY`, `JWT_SECRET`, `WOO_*`) is ignored. Values passed as real process environment variables (Docker or a hosting platform) are unaffected.
- **Suggested fix:** load the file before parsing, at the top of `env.ts`: `try { process.loadEnvFile(); } catch {}` (Node ≥ 20.12), or `import 'dotenv/config'`.
- **Regression test:** a unit test that writes a temporary `.env`, imports the config in a fresh module context, and asserts the values are applied.
- **Dates:** discovered and reproduced 2026-10-13 (R1).

### AUD-002 — Workflow execution silently lost when workflow evaluation throws after the order is committed
- **Severity:** High · **Priority:** P1 · **Status:** ✅ Resolved (verified 2026-10-13, in-process driver) · **Confirmed (reproduced)**
- **Affected requirements:** WORKFLOW-04, WORKFLOW-05, WEBHOOK-07, QUEUE-03 (recoverability), DOCS-02
- **Reproduction:** in the isolated DB, add an active workflow `audit-bogus` (trigger `ORDER_STATUS_CHANGED`, `newStatus eq completed`, action `{type:"BOGUS"}`) and a valid workflow `audit-after` with the same condition and a `CREATE_TASK` action. Send a signed `order.updated` moving a processing order to `completed` (`deep-probe.mts`).
- **Expected:** `audit-after` runs. The broken workflow is recorded as a FAILED run, or the event ends FAILED and can be retried.
- **Actual:** `audit-after runs 0`, `bogus runs 0`, webhook event **PROCESSED after 2 attempts**. `completed-review-request` (evaluated before the failure) ran once.
- **Root cause (confirmed by trace):** `runWorkflows` parses actions (`ActionSchema.parse`) and builds the context **outside** the per-action try/catch, so one bad workflow throws for the whole batch. The job is retried. But `upsertWooOrder` has already committed the new status, so the retry sees `statusChanged = false` and skips every workflow. The trigger is permanently lost and the event is reported as successful.
- **Suggested fix:** (a) isolate each workflow in its own try/catch and record a FAILED `WorkflowRun` with the error; (b) persist the detected transition (for example the `OrderStatusEvent` id) on the webhook event, or in an outbox table, so retries re-dispatch triggers idempotently, keyed by `(workflowId, statusEventId)`.
- **Regression test:** integration test with one invalid and one valid workflow: the valid workflow runs exactly once, the invalid one yields a FAILED run, and a retry produces no duplicates.
- **Dates:** discovered and reproduced 2026-10-13 (R1).

### AUD-003 — Second guest order without a billing email is lost
- **Severity:** High · **Priority:** P1 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** CUSTOMER-02, WOO-01 (completeness)
- **Reproduction:** send two signed `order.created` webhooks with `customer_id: 0`, `billing.email: ""` and different names (Woo IDs 990011 and 990012).
- **Expected:** both orders are ingested. Customers without an email are not merged with each other, and they don't fail.
- **Actual:** order 990011 is ingested under customer "Nora NoEmail" (email `""`). The event for 990012 ends **FAILED after 3 attempts** with `Unique constraint failed on the fields: (email)`. The order is absent from the CRM.
- **Root cause (confirmed):** `Customer.email` is `@unique` and non-null. `upsertCustomer` skips the email lookup for empty strings, then tries to `create` a second customer with email `""`.
- **Suggested fix:** make `email` nullable and store `null` for missing emails (SQLite and Postgres allow multiple NULLs under a unique constraint), or key email-less guests by a synthetic `guest:<wooOrderId>` identifier. Never match on an empty email.
- **Regression test:** two email-less guest orders produce two customers, two orders, and PROCESSED events.
- **Dates:** discovered 2026-10-13 (R1). The original probe T-CUSTOMER-02 passed misleadingly; it was corrected in the same run.

### AUD-004 — Job queue stops processing permanently if the failure handler throws
- **Severity:** High · **Priority:** P1 · **Status:** ✅ Resolved (verified 2026-10-13) · **Confirmed (reproduced)**
- **Affected requirements:** QUEUE-03, WEBHOOK-08
- **Reproduction:** `new JobQueue(handler, { maxAttempts: 1, onFailed: () => { throw new Error('db down') } })`. Enqueue a failing job, then a good job (`deep-probe.mts`).
- **Expected:** the good job is processed and the handler error is logged.
- **Actual:** `processed: []`, `queue size 2`, 1 unhandled rejection. The queue never resumes.
- **Root cause (confirmed by code):** `drain()` awaits `onFailed` inside `catch` without its own try/catch. The rejection escapes `drain()`, which is called with `void`, so `running` stays `true` forever and every later `enqueue` returns immediately. In production, `onFailed` is a Prisma update that is likely to fail under the same conditions (DB unavailable) that caused the job failures.
- **Suggested fix:** wrap `onFailed` in try/catch and reset `running` in a `finally` block. Also wrap the whole loop body.
- **Regression test:** the reproduction above, asserting the good job is processed.
- **Dates:** discovered and reproduced 2026-10-13 (R1).

### AUD-005 — WooCommerce requests have no timeout
- **Severity:** Medium · **Priority:** P2 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** WOO-06, WOO-03 (a hung sync stays `SYNCING`)
- **Reproduction:** point `WooCommerceClient` at a TCP server that accepts connections but never responds, then call `getCustomers()`.
- **Expected:** rejects after a bounded timeout, and the sync is marked FAILED.
- **Actual:** still pending after 8 s. `runFullSync` would stay in flight and the store would stay `SYNCING` indefinitely, blocking all later syncs (`syncInFlight`).
- **Suggested fix:** `fetch(url, { signal: AbortSignal.timeout(15_000) })` and treat the timeout as retryable.
- **Regression test:** the hanging-server test asserts a rejection within the timeout.
- **Dates:** 2026-10-13 (R1).

### AUD-006 — Network-level errors are not retried
- **Severity:** Medium · **Priority:** P2 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** WOO-07
- **Reproduction:** a `fetchImpl` that throws `TypeError('fetch failed')`.
- **Expected:** retried with backoff, like HTTP 429/5xx.
- **Actual:** 1 attempt, then the error propagates.
- **Suggested fix:** catch fetch exceptions in `request()` and apply the same retry policy.
- **Regression test:** a `fetchImpl` that fails once then succeeds → resolves with 2 calls.
- **Dates:** 2026-10-13 (R1).

### AUD-007 — Customer update that takes a guest record's email fails permanently
- **Severity:** Medium · **Priority:** P2 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** CUSTOMER-03
- **Reproduction:** `customer.created` (id 990100, new email), then `customer.updated` for the same id with an email already held by a guest customer.
- **Expected:** the guest record is merged into the registered customer (orders and activities re-parented).
- **Actual:** event FAILED after 3 attempts with a unique-constraint error on `prisma.customer.update()`.
- **Suggested fix:** in `upsertCustomer`, when both the Woo-id match and an email match exist and differ, merge inside a transaction (move orders and activities, delete the guest).
- **Regression test:** the reproduction above → PROCESSED, one customer, orders preserved.
- **Dates:** 2026-10-13 (R1).

### AUD-008 — Race between concurrent upserts of the same new customer (full sync vs webhook queue)
- **Severity:** Medium · **Priority:** P2 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** DB-05
- **Reproduction:** `Promise.allSettled([upsertCustomer(m), upsertCustomer(m)])` for a new email.
- **Expected:** both resolve to the same customer.
- **Actual:** 1 of 2 rejected with `P2002`. In practice, `runFullSync` runs outside the single-consumer webhook queue, so a webhook arriving during a sync can hit this. A failed sync then aborts the whole import (see MR-07).
- **Suggested fix:** route sync batches through the same queue, or catch P2002 and re-read (upsert-on-conflict).
- **Regression test:** the parallel upsert test above.
- **Dates:** 2026-10-13 (R1).

### AUD-009 — Mock store enabled by default (also in production) and its admin panel is unauthenticated
- **Severity:** Medium · **Priority:** P2 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** SEC-09, ARCH-05
- **Reproduction:** anonymous `POST /mock-woo/panel/orders/<id>/status` with `status=cancelled`.
- **Expected:** rejected without authentication. Fake data is not active in production unless explicitly enabled.
- **Actual:** 303. The order became `cancelled` in the CRM (webhook fired, retention workflow ran). `MOCK_WOO_ENABLED` defaults to `true` regardless of `NODE_ENV`, and the mock REST API accepts the well-known keys `ck_mock`/`cs_mock`.
- **Suggested fix:** default `MOCK_WOO_ENABLED` to `false` when `NODE_ENV=production`, and protect the panel (admin JWT or a demo token). Keep the mock opt-in for demos.
- **Regression test:** an anonymous panel POST → 401. Production config → `/mock-woo` returns 404.
- **Dates:** 2026-10-13 (R1).

### AUD-010 — Insecure default secrets accepted without a production guard
- **Severity:** Medium · **Priority:** P2 · **Status:** Open · **Confirmed (inspection + env-probe)**
- **Affected requirements:** SEC-08
- **Evidence:** `env.ts` defaults are `JWT_SECRET=dev-only-change-me`, `WOO_WEBHOOK_SECRET=woopulse-webhook-secret` and `ADMIN_PASSWORD=demo1234`. Both demo accounts are always created. The env-probe shows the default JWT secret in use even when `.env` sets another (AUD-001).
- **Impact:** if deployed without platform env vars, anyone can forge admin JWTs and signed webhooks.
- **Suggested fix:** in production, refuse to start when the secrets are missing or equal the defaults. Make demo-user seeding opt-in.
- **Regression test:** config unit test: `NODE_ENV=production` with default secrets → throws.
- **Dates:** 2026-10-13 (R1).

### AUD-011 — Risk "time in status" for imported orders measured from order creation
- **Severity:** Medium · **Priority:** P3 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** ORDER-04
- **Reproduction:** mock order #5036 (on-hold, created 40h ago, modified 30h ago) → GET `/api/orders/at-risk`.
- **Expected:** "On hold for 30 hours".
- **Actual:** "On hold for 40 hours".
- **Root cause (confirmed by code):** for newly imported orders, `upsertWooOrder` sets the initial `OrderStatusEvent.occurredAt` to `wooCreatedAt`, and `risk.service` uses it as `statusSince`.
- **Suggested fix:** for imports, use `wooModifiedAt` as the best available "entered status" time (or label it as an approximation).
- **Regression test:** an imported on-hold order with created ≠ modified asserts the hours from modified.
- **Dates:** 2026-10-13 (R1).

### AUD-012 — Malformed JSON request body returns 500
- **Severity:** Low · **Priority:** P3 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** SEC-03
- **Actual:** POST `/api/activities` with `{bad json` → `500 Internal server error`. The body-parser error carries `status: 400`, but the error middleware ignores it and logs a stack.
- **Suggested fix:** in the error middleware, honour `err.status`/`err.type === 'entity.parse.failed'` → 400.
- **Regression test:** malformed body → 400.
- **Dates:** 2026-10-13 (R1).

### AUD-013 — Foreign-key violations return 500
- **Severity:** Low · **Priority:** P3 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** SEC-04
- **Actual:** activity for customer `does-not-exist` → 500 (Prisma `P2003`).
- **Suggested fix:** map `P2003` → 400/404, or check that the customer exists first.
- **Regression test:** unknown customer → 404.
- **Dates:** 2026-10-13 (R1).

### AUD-014 — Activity can link an order belonging to a different customer
- **Severity:** Low · **Priority:** P3 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** DB-04
- **Actual:** POST `/api/activities` with customer A and an order of customer B → 201. The note then shows on A's timeline referencing B's order.
- **Suggested fix:** validate `order.customerId === customerId` in the route, and in the copilot `create_task`/`draft_email` tools.
- **Regression test:** mismatched pair → 400.
- **Dates:** 2026-10-13 (R1).

### AUD-015 — Stored webhook errors expose internal details in the UI
- **Severity:** Low · **Priority:** P3 · **Status:** 🟡 Fix implemented, NOT yet verified · **Confirmed (reproduced)**
- **Affected requirements:** WEBHOOK-07, SEC-05 (UI side)
- **Actual:** `/api/store` `recentEvents[].error` contains raw Prisma invocation text, including the absolute server path `D:\kilowott hackathon\server\src\modules\sync\ingest.service.ts:51:44` and source excerpts. It is shown on the Sync health page to any authenticated user.
- **Suggested fix:** store a sanitized message (error code + short reason) and log the full error server-side only.
- **Regression test:** a forced failure's error contains no file paths and no "invocation".
- **Dates:** 2026-10-13 (R1).

### AUD-016 — No login rate limiting
- **Severity:** Low · **Priority:** P3 · **Status:** ✅ Resolved (verified 2026-10-13, in-memory driver; Redis driver unverified, see ENV-01) · **Confirmed (reproduced)**
- **Affected requirements:** SEC-10
- **Actual:** 15 consecutive bad logins → all 401, no throttling.
- **Suggested fix:** an IP + account rate limiter (for example `express-rate-limit`) on `/api/auth/login`.
- **Dates:** 2026-10-13 (R1).

### AUD-017 — CORS allows any origin
- **Severity:** Low · **Priority:** P4 · **Status:** Open · **Confirmed (reproduced)**
- **Affected requirements:** SEC-11
- **Actual:** `Access-Control-Allow-Origin: *`. Risk is limited because auth uses bearer tokens, not cookies.
- **Suggested fix:** restrict to `PUBLIC_URL` and the dev origin.
- **Dates:** 2026-10-13 (R1).

### AUD-018 — Note/task composer and tag editor show no error state on failure
- **Severity:** Low · **Priority:** P4 · **Status:** Open · **Confirmed (inspection)**
- **Affected requirements:** UI-03
- **Evidence:** `client/src/pages/Customer360.tsx`: `ActivityComposer` and `TagEditor` never render `mutation.error`, so a failed save looks like nothing happened.
- **Suggested fix:** render `<ErrorNote error={create.error} />` / `save.error`.
- **Regression test:** component test with a mocked failing API.
- **Dates:** 2026-10-13 (R1).

### AUD-019 — LLM-generated summary `sources` are not validated against real records
- **Severity:** Medium · **Priority:** P2 · **Status:** Open · **Suspected** (LLM mode not executed, ENV-03)
- **Affected requirements:** AI-03
- **Evidence:** `ai.service.ts` `summarizeCustomer` returns `result.sources` from the model verbatim. A hallucinated order number would be shown as a citation.
- **Suggested fix:** filter `sources` to the customer's actual order numbers and flag the response when the model cited unknown records.
- **Regression test:** stub the LLM to return a fake source and assert it is removed or flagged.
- **Dates:** suspected 2026-10-13 (R1).

---

## Missing requirements (specified, not implemented)

Most of these were deliberate scope cuts made for the 4-hour hackathon (see the README "Scope and limitations"). Under the audit policy they stay failures until the **project owner explicitly accepts them**. That decision belongs to the owner, not the auditor.

| ID | Requirement | Current state | Severity if not accepted | Affected rows |
|---|---|---|---|---|
| MR-01 | PostgreSQL as the primary DB | SQLite | High | ARCH-02 |
| MR-02 | Prisma migrations + seed script runnable from clean | `db push` + boot-time `bootstrap()` | Medium | DB-01, DB-02 |
| MR-03 | Redis + BullMQ queues and a separate worker | **Implemented 2026-10-13, NOT yet verified against a live Redis** (ENV-01: Docker engine down). BullMQ driver + `src/worker.ts` + `docker-compose.yml` (redis, api, worker). In-process fallback when `REDIS_URL` is empty. | High until verified | ARCH-03, ARCH-04, QUEUE-05 |
| MR-04 | SMTP / Mailpit email delivery | Log transport | Medium | EMAIL-03 |
| MR-05 | Workflow delay configuration (for example "on hold for 24 h", with a demo-mode delay) | Not implemented | Medium | WORKFLOW-06 |
| MR-06 | WooCommerce credentials encrypted at rest | Plain env vars | Medium | SEC-07 |
| MR-07 | Partial-sync handling and `PARTIAL` sync status | Whole-import try/catch | Medium | WOO-08 |
| MR-08 | Playwright scenarios (both required), frontend component tests, per-workflow failure tests | None | High (Definition of Done §5.3) | TEST-02…04, WORKFLOW-07, AUTH-06, UI-* |
| MR-09 | `WORKFLOW_RUN` activity per execution | Only WorkflowRun + action activities | Low | WORKFLOW-08 |
| MR-10 | Docs set: `api.md`, `data-model.md`, `woocommerce-setup.md`, `workflows.md`, `ai-agent.md`, `testing.md`, `deployment.md`, `demo-script.md` | Only `architecture.md` plus the README | Low | DOCS-03 |

## Blocked and untested requirements

| ID | Blocker | Blocks | How to unblock |
|---|---|---|---|
| ENV-01 | Docker daemon not running (`dockerDesktopLinuxEngine` pipe missing) | ARCH-07 | Start Docker Desktop, then `docker build .` |
| ENV-02 | `concurrently` absent from `node_modules` in this working copy (the lockfile includes it) | ARCH-04, DOCS-01 | `npm install` at the repo root, then re-run `npm run dev` |
| ENV-03 | No LLM API key available | AI-03, AUD-019 verification | Provide a key **as a real environment variable** (until AUD-001 is fixed) and run grounding probes |
| ENV-04 | No browser automation installed | AUTH-06, CUSTOMER-07, UI-02, UI-04, UI-05 | Add Playwright (MR-08) |
| ENV-05 | No real WordPress/WooCommerce store | WOO-10 | InstaWP or a local WordPress container |

**NOT RUN (runnable, not executed in R1):** WEBHOOK-08 (retry endpoint), QUEUE-04 (PENDING resume after restart), ORDER-06 (filter correctness), WORKFLOW-09 (import triggers no workflows).

## Reopened issues and regressions
None. R1 is the first audit run.

## Resolved issues and verification history

| Issue | Fix | Regression test | Verified | Result |
|---|---|---|---|---|
| AUD-001 | `env.ts` loads `server/.env` (or `ENV_FILE`) with `process.loadEnvFile` **before** parsing; real environment variables still take precedence | `tests/unit/env-loading.test.ts` (file values applied; process env overrides file) — spawns a fresh Node process per case | 2026-10-13, uncommitted working tree on top of `37b564f`; full suite **40/40 pass** | Resolved. Matrix row ARCH-08 → PASS on next full audit run |

| AUD-004 | `JobQueue.drain()` wraps `onFailed` in try/catch and resets `running` in `finally` | `tests/unit/job-queue.test.ts` › *keeps processing after the failure handler itself throws* | 2026-10-13, suite 47/47 | Resolved. With Redis, BullMQ now owns retries; its `failed` handler is also guarded. |
| AUD-002 | Each workflow is isolated (invalid definitions → FAILED run, others still run). The webhook outcome incl. trigger is persisted on `WebhookEvent.outcome` **before** workflows run; `WorkflowRun` is unique per `(workflowId, webhookEventId)` and claimed (`RUNNING`) before actions execute | `webhook-pipeline.test.ts` › *runs other workflows when one is broken…* and *re-dispatches a saved trigger…* | 2026-10-13, suite 47/47 | Resolved. Semantics are now **at-most-once per workflow per event**: a crash mid-actions leaves a visible `RUNNING` run rather than risking duplicate emails. |
| AUD-016 | Login lockout: 5 failures per (IP, email) per 15 min, Redis `INCR`+`EXPIRE` (memory fallback); a correct password does not bypass an active lockout; `Retry-After` header | `cache-and-rate-limit.test.ts`, `webhook-pipeline.test.ts` › *locks out after repeated failures* | 2026-10-13, suite 47/47 (memory driver) | Resolved for the memory driver; Redis driver pending ENV-01 |

**Fix implemented, not yet verified:** AUD-015. `markEventFailed` now stores `sanitizeError()` output (Prisma codes mapped to short messages, file paths stripped). There is no regression test yet.

> AUD-002/004/015/016 and the Redis work (MR-03) were authorised by the owner on 2026-10-13 ("implement Redis": BullMQ queue + worker, rate limiting, caching).

> Authorised implicitly by the owner request to connect a local WooCommerce store via `.env` (`WOO_STORE_URL`), which cannot work while AUD-001 is open. All other issues remain open pending authorisation.

## Prioritized remediation plan

| Order | Items | Rationale | Est. effort |
|---|---|---|---|
| 1 | **AUD-001** | One line. It unblocks the AI demo (Groq key) and correct secrets. | 5 min |
| 2 | **AUD-004**, **AUD-002** | Queue stall and lost workflow triggers: silent loss in the core event pipeline | 30–45 min |
| 3 | **AUD-003**, **AUD-007**, **AUD-008** | Customer-identity edge cases that drop or fail events | 45 min |
| 4 | **AUD-005**, **AUD-006** | Woo client resilience (timeout + network retry) | 15 min |
| 5 | **AUD-009**, **AUD-010** | Required before any public deployment of the demo | 20 min |
| 6 | AUD-011…AUD-018 | Correctness and polish of error handling, validation and UI states | 45 min |
| 7 | AUD-019 + ENV-03 | Validate citations and run LLM-mode grounding tests | 20 min |
| 8 | MR-08 (Playwright: login→customer 360, signed webhook → persisted update + workflow run) | Definition of Done §5.3 | 60 min |
| 9 | Owner decision on MR-01…MR-07, MR-09, MR-10 | Accept as hackathon scope, or schedule | — |

Each fix must add the regression test listed on its issue and re-run the full audit before the issue moves to *Resolved*.

## Audit run history

| Run | Date (UTC) | Commit | Suite | Probes (P/F/NR) | Matrix (P/F/B/NR/NA/NRV) | New issues | Resolved | Verdict |
|---|---|---|---|---|---|---|---|---|
| R1 | 2026-10-13 | `37b564f` | 38/38 | 37 / 16 / 1 | 50 / 35 / 4 / 9 / 2 / 5 | AUD-001…AUD-019, MR-01…MR-10, ENV-01…ENV-05 | — | **FAIL** |

**Count verification (R1):** probe totals were re-derived from `audit/results/R1/*.json` (47 + 7 = 54 checks; 38 + 0 raw passes; one reclassification). Matrix totals were re-derived by parsing every requirement row's status column in `CRM_AUDIT_PLAN.md` (105 rows).
