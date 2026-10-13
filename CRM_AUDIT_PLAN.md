# WooPulse CRM — Audit Plan & Traceability Matrix

> Maintained under the *Continuous QA Audit* policy. A row is **PASS** only when a test or probe was executed in the run and produced evidence; code inspection alone yields NEEDS REVIEW (R1 inspection-only passes were re-graded in AUDIT-R2). Requirement IDs from R1 are preserved; rows added in AUDIT-R2 are marked *(new R2)*.

## Latest run metadata

| Field | Value |
|---|---|
| Latest run | **AUDIT-R2** |
| Date/time UTC | 2026-10-13T11:08Z – 11:40Z |
| Git branch | `main` |
| Git commit | `8de77fe2e0ff0896458a49570c319eab263fe7ca` |
| Working tree | Clean at start (audit files written during the run) |
| Node version | v24.15.0 |
| npm version | 11.12.1 |
| Database provider | **SQLite** (Prisma `provider = "sqlite"`) — not PostgreSQL |
| Prisma version | 6.19.3 (no `migrations/` directory; schema applied with `prisma db push`) |
| Queue implementation | BullMQ 6.3.14 when `REDIS_URL` is set; in-process `JobQueue` otherwise. **This run: in-process** (no Redis available) |
| Mock WooCommerce enabled | `true` — `MOCK_WOO_ENABLED` default in `server/src/config/env.ts` (also true when `NODE_ENV=production`, see T-ARCH-09) |
| Audit mode | Read-only (no production code, dev DB, secrets or git history changed) |
| Isolation | Throwaway SQLite files in the session scratchpad: `audit.db` (main run, API on :4100) and `audit-noredis.db` (:4101). Developer DB `server/prisma/dev.db` and the developer's running instance on :4000/:5173 were not modified. |
| Environment blockers | ENV-01 Docker daemon unusable (WSL `E_FAIL`, C: drive was full) → no PostgreSQL, Redis, Docker build or WooCommerce container · ENV-04 no Playwright/browser automation · ENV-05 no real WooCommerce store · ENV-06 no Redis server · Configured LLM model unavailable at provider (see AUD-020) |

### Commands executed in AUDIT-R2
| # | Command | Outcome | Evidence |
|---|---|---|---|
| 1 | `git status`, `git branch --show-current`, `git rev-parse HEAD` | clean, `main`, `8de77fe` | `audit/results/AUDIT-R2/environment.txt` |
| 2 | dependency/env inspection | SQLite; no migrations; no lint script; no Playwright; Docker unusable; `server/.env` has LLM key, no `REDIS_URL` | `environment.txt` |
| 3 | `npm test` | **8 files, 47/47 passed** | `test-output.txt` |
| 4 | `npm run typecheck` | exit 0 | `typecheck-output.txt` |
| 5 | `npm run build` | exit 1 — client built; server `prisma generate` hit **EPERM** renaming the Prisma engine DLL, locked by the developer's running dev server (environmental). `tsc -p tsconfig.build.json` alone: exit 0 | `build-output.txt`, `server-compile-output.txt` |
| 6 | `npm run lint` | not configured | — |
| 7–9 | PostgreSQL/Redis start, migrations, seed | **BLOCKED** (ENV-01/06); isolated SQLite DB created with `prisma db push`; boot `bootstrap()` seeded users/workflows; boot sync imported the mock store | `initial-sync-workflow-runs.txt` |
| 10 | API on :4100 (isolated env vars, `REDIS_URL` empty) | started; worker in-process | — |
| 11–17 | `node audit/probes/api-probe.mjs` (R1 suite) | 47 checks: 40 PASS / 7 FAIL | `api-probe-results.json` |
| 12–14 | `npx tsx audit/probes/deep-probe.mts` (R1 suite) | 7 checks: 3 PASS / 4 FAIL | `deep-probe-results.json` |
| 11–16 | `node audit/probes/r2-api-probe.mjs` *(new)* | 9 checks: 8 PASS / 1 NEEDS REVIEW (T-WEBHOOK-08 and T-QUEUE-06 re-graded, see notes) | `r2-api-probe-results.json` |
| 14–17 | `npx tsx audit/probes/r2-deep-probe.mts` *(new)* | 7 checks: 3 PASS / 3 FAIL / 1 BLOCKED | `r2-deep-probe-results.json` |
| 17 | `LLM_MODEL=openai/gpt-oss-120b npx tsx audit/probes/r2-llm-grounding.mts` *(new; model overridden via process env only)* | grounding PASS, copilot FAIL | `llm-grounding-results.json` |
| — | Redis-unavailable probe (:4101, `REDIS_URL` set, no Redis) | webhook **no response in 10 s**; login 200 | `redis-unavailable-probe.txt` |
| — | `npx tsx audit/probes/wf-count.mts` (before and after probes) | 0 runs after boot sync; all 5 seeded workflows ran during probes | `initial-sync-workflow-runs.txt`, `workflow-runs-after-probes.txt` |
| 18 | Playwright | **BLOCKED / absent** | — |
| 19 | Docker build | **BLOCKED** (ENV-01) | — |
| — | Documented `npm run dev` instance (developer's, same commit) | `:4000/api/health` 200, `:5173` 200 | `dev-command-check.txt` |

**Re-grading notes (R2):**
- `T-CUSTOMER-02` passes again only because the second email-less guest order is never ingested (T-CUSTOMER-06) → NEEDS REVIEW, as in R1.
- `T-ARCH-02` probe reported FAIL; manual review shows the only matches are setup **help text naming environment variables** in `Settings.tsx` (no credentials, no WooCommerce URLs) → PASS.
- `T-WEBHOOK-08` (HTTP) only proved AGENT is refused; admin's HTTP retry was not exercised because the R1 brute-force probe locked the admin account (by design). The retry path itself was exercised at service level in `T-WEBHOOK-08b`.
- `T-AI-05` with the configured default model is BLOCKED (provider 404); with the available model `openai/gpt-oss-120b` it PASSES — tracked as AUD-020.

### Common preconditions & steps
P-SRV isolated API on :4100 after boot sync · P-ADM/P-AGT JWTs from `POST /api/auth/login` · P-SIG webhooks signed `base64(HMAC-SHA256(body, "audit-webhook-secret"))` · P-DB Prisma access to the scratchpad audit DB only. Exact steps per test are in the probe scripts under `audit/probes/` (test IDs match).

---

## Requirement → test matrix (AUDIT-R2 @ `8de77fe`, 2026-10-13)

Evidence paths are relative to `audit/results/AUDIT-R2/`.

### ARCH
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| ARCH-01 | Frontend calls only the Express API | T-ARCH-02 | static (grep) + code | PASS | `r2-deep-probe-results.json` T-ARCH-02 (reviewed: env-var names in help text only); `client/src/lib/api.ts` | — | PASS |
| ARCH-02 | PostgreSQL is the primary DB | T-ARCH-03 | static | FAIL | `environment.txt` (provider sqlite) | MR-01 | FAIL |
| ARCH-03 | Redis + BullMQ process background jobs | T-ARCH-07 | integration | BLOCKED | No Redis (ENV-01/06); BullMQ driver exists but unexecuted | ENV-06, MR-03 | FAIL |
| ARCH-04 | API, frontend, worker start with documented commands | T-ARCH-04 | integration | PASS | `dev-command-check.txt` (`npm run dev` instance: API 200, UI 200); worker command T-QUEUE-09 | — | BLOCKED |
| ARCH-05 | No production feature silently relies on fake data / in-memory state | T-ARCH-05 | integration | FAIL | T-ARCH-09: production config enables the mock store by default | AUD-009 | NEEDS REVIEW |
| ARCH-06 | Health endpoint | T-ARCH-01 | API | PASS | `api-probe-results.json` | — | PASS |
| ARCH-07 | Docker image builds | T-ARCH-06 | integration | BLOCKED | Docker unusable | ENV-01 | BLOCKED |
| ARCH-08 | `.env` values loaded before config parsing | T-ARCH-08 | unit + probe | PASS | `test-output.txt` (env-loading tests); LLM key from `server/.env` reached config in `r2-deep-probe` | — (AUD-001 resolved) | FAIL |
| ARCH-09 *(new R2)* | Mock mode off by default in production, explicit opt-in | T-ARCH-09 | probe | FAIL | `r2-deep-probe-results.json`: `NODE_ENV=production` → `mock:true` | AUD-009 | — |
| ARCH-10 *(new R2)* | No Woo credentials / direct Woo URLs in frontend | T-ARCH-02 | static | PASS | see ARCH-01 | — | — |

### AUTH
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| AUTH-01 | Admin can log in | T-AUTH-01 | API | PASS | `api-probe-results.json` | — | PASS |
| AUTH-02 | Agent can log in | T-AUTH-02 | API | PASS | `api-probe-results.json` | — | PASS |
| AUTH-03 | Wrong password → 401 | T-AUTH-03 | security | PASS | `api-probe-results.json` | — | PASS |
| AUTH-04 | Missing/invalid JWT rejected | T-AUTH-04 | security | PASS | `api-probe-results.json` | — | PASS |
| AUTH-05 | AGENT forbidden from admin actions | T-AUTH-05 | security | PASS | `api-probe-results.json` (403×3) | — | PASS |
| AUTH-06 | Admin-only controls hidden/disabled for AGENT in UI | T-AUTH-06 | E2E | BLOCKED | no browser automation | ENV-04, MR-08 | NOT RUN |
| AUTH-07 | Cross-store isolation | T-AUTH-07 | — | NOT APPLICABLE | single-store deployment; CRM data is shared team data by design | — | NOT APPLICABLE |
| AUTH-08 *(new R2)* | Role claims cannot be escalated | T-AUTH-08 | security | PASS | `r2-api-probe-results.json`: tampered `role:ADMIN` → 401 | — | — |

### DB
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| DB-01 | Prisma migrations apply from clean | T-DB-03 | integration | FAIL | no `server/prisma/migrations` | MR-02 | FAIL |
| DB-02 | Seed script works from clean | T-DB-04 | integration | FAIL | no seed command (boot `bootstrap()` only) | MR-02 | FAIL |
| DB-03 | Unique constraints prevent duplicate Woo records | T-DB-05 | API | PASS | T-WOO-04, T-WEBHOOK-04 | — | PASS |
| DB-04 | Activity cannot link another customer's order | T-DB-01 | API | FAIL | `api-probe-results.json` → 201 | AUD-014 | FAIL |
| DB-05 | Concurrent upserts don't fail/duplicate | T-DB-02 | integration | FAIL | `deep-probe-results.json` (P2002) | AUD-008 | FAIL |
| DB-06 | Order write + status event atomic | T-DB-06 | code | NEEDS REVIEW | `$transaction` in `ingest.service.ts`; not fault-injected | — | PASS (inspection) |
| DB-07 | Tests use an isolated DB | T-DB-07 | integration | PASS | `test-output.txt` (suite uses throwaway `prisma/test.db`) | — | PASS |

### CUSTOMER
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| CUSTOMER-01 | Guest orders matched on normalized email | T-CUSTOMER-01 | API | PASS | `api-probe-results.json` | — | PASS |
| CUSTOMER-02 | Email-less guest orders handled | T-CUSTOMER-02 | API | NEEDS REVIEW | passes only because the 2nd order is lost | AUD-003 | NEEDS REVIEW |
| CUSTOMER-02 | same | T-CUSTOMER-06 | integration | FAIL | `deep-probe-results.json` (order 990012 missing, event FAILED) | AUD-003 | FAIL |
| CUSTOMER-03 | Registered customer taking a guest email merges | T-CUSTOMER-03 | API | FAIL | `api-probe-results.json` (FAILED ×3) | AUD-007 | FAIL |
| CUSTOMER-04 | Notes/tasks persist on timeline | T-CUSTOMER-04 | API | PASS | `api-probe-results.json` | — | PASS |
| CUSTOMER-05 | LTV excludes cancelled/refunded/failed (pending also excluded — confirmed) | T-CUSTOMER-05 | API + unit | PASS | `api-probe-results.json` (0 mismatches) | — | PASS |
| CUSTOMER-06 | Case-insensitive search | T-CUSTOMER-07 | API | PASS | `test-output.txt` (`search=priya`) | — | PASS |
| CUSTOMER-07 | Customer 360 page shows backend data | T-UI-03 | E2E | BLOCKED | no browser automation | ENV-04 | NOT RUN |
| CUSTOMER-08 *(new R2)* | Customer order count = eligible orders | T-CUSTOMER-08 | API | NEEDS REVIEW | `ordersCount` counts **all** orders; LTV counts eligible only — product owner to confirm the intended definition | — | — |

### ORDER
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| ORDER-01 | Transitions recorded (prev/new/source/time) | T-ORDER-01 | API | PASS | `api-probe-results.json` | — | PASS |
| ORDER-02 | Dashboard revenue = Σ LTV (with Redis-style cache active) | T-ORDER-02 | API | PASS | `api-probe-results.json` | — | PASS |
| ORDER-03 | Dashboard order count = order count | T-ORDER-03 | API | PASS | `api-probe-results.json` | — | PASS |
| ORDER-04 | Time-in-status from when status was entered | T-ORDER-04 | API | FAIL | 40 h reported, modified 30 h ago | AUD-011 | FAIL |
| ORDER-05 | Risk rules deterministic, unit-tested | T-ORDER-05 | unit | PASS | `test-output.txt` | — | PASS |
| ORDER-06 | Filters: status, date, customer, amount | T-ORDER-06 | API | PASS | `r2-api-probe-results.json` (exact counts) | — | NOT RUN |
| ORDER-07 *(new R2)* | No status event when status unchanged | T-QUEUE-01 | API | PASS | replay → status events 2→2 | — | — |

### WOO
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| WOO-01 | Orders imported across pages | T-WOO-01 | integration | PASS | 53 = 53 (2 pages) | — | PASS |
| WOO-02 | Customers imported, guests derived | T-WOO-02 | integration | PASS | 12 + 3 | — | PASS |
| WOO-03 | Sync status/timestamps reflect outcome | T-WOO-03 | API | PASS | success path only | — | PASS |
| WOO-04 | Repeat sync creates no duplicates | T-WOO-04 | API | PASS | 53→53, 15→15 | — | PASS |
| WOO-05 | Invalid credentials rejected | T-WOO-05 | API | PASS | mock 401 (Basic and forged OAuth) | — | PASS |
| WOO-06 | Requests time out | T-WOO-06 | integration | FAIL | pending after 8 s | AUD-005 | FAIL |
| WOO-07 | Network errors retried with backoff | T-WOO-07 | unit | FAIL | 1 attempt | AUD-006 | FAIL |
| WOO-08 | Bad record doesn't abort sync; PARTIAL status | T-WOO-08 | code | FAIL | single try/catch, no PARTIAL | MR-07 | FAIL |
| WOO-09 | Older updates don't overwrite newer state | T-WEBHOOK-05 | API | PASS | IGNORED | — | PASS |
| WOO-10 | Works against a real WooCommerce store | T-WOO-09 | E2E | BLOCKED | no store (Docker unusable) | ENV-05 | BLOCKED |
| WOO-11 *(new R2)* | OAuth 1.0a signing over plain HTTP | T-WOO-10 | integration | PASS | boot sync over HTTP against mock that verifies OAuth (53 orders); verification is self-consistent only — real-store check BLOCKED | ENV-05 | — |

### WEBHOOK
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| WEBHOOK-01 | Creation ping 200 | T-WEBHOOK-01 | API | PASS | `api-probe-results.json` | — | PASS |
| WEBHOOK-02 | Forged signature rejected, no change | T-WEBHOOK-02 | security | PASS | `api-probe-results.json` | — | PASS |
| WEBHOOK-03 | HMAC over raw body, timing-safe | T-WEBHOOK-06 | unit | PASS | `test-output.txt` (signature tests) | — | PASS |
| WEBHOOK-04 | Processing queued, not inline | T-WEBHOOK-03 | API | PASS | 202 then async apply | — | PASS |
| WEBHOOK-05 | Duplicate delivery ID not reprocessed | T-WEBHOOK-04 | API | PASS | `duplicate:true` | — | PASS |
| WEBHOOK-06 | Stale events ignored | T-WEBHOOK-05 | API | PASS | IGNORED | — | PASS |
| WEBHOOK-07 | Failures store sanitized errors | T-SEC-06, T-QUEUE-05 | security | PASS | "Conflicting record: a unique field…" (no paths/Prisma text) | — (AUD-015 resolved) | FAIL |
| WEBHOOK-08 | Failed events retryable safely | T-WEBHOOK-08b | integration | PASS | `r2-deep-probe-results.json`: 3 requeued, runs 9→9, activities 14→14 | — | NOT RUN |
| WEBHOOK-09 *(new R2)* | Fast acknowledgement | T-WEBHOOK-09 | API | PASS | 202 in 17 ms | — | — |
| WEBHOOK-10 *(new R2)* | Webhooks accepted when the queue backend is down | T-WEBHOOK-10 | integration | FAIL | `redis-unavailable-probe.txt`: no response within 10 s | AUD-022 | — |

### QUEUE
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| QUEUE-01 | Retries with exponential backoff | T-QUEUE-03 | unit | PASS | `test-output.txt` | — | PASS |
| QUEUE-02 | Duplicate jobs don't duplicate side effects | T-QUEUE-01 | API | PASS | replay: runs/emails unchanged | — | PASS |
| QUEUE-03 | Queue survives failure-handler error | T-QUEUE-02 | unit | PASS | `deep-probe-results.json` + regression test | — (AUD-004 resolved) | FAIL |
| QUEUE-04 | PENDING events resume after restart | T-QUEUE-04 | integration | NOT RUN | not executed (time) | — | NOT RUN |
| QUEUE-05 | Redis + BullMQ queues | T-ARCH-07 | integration | BLOCKED | no Redis | ENV-06, MR-03 | FAIL |
| QUEUE-06 *(new R2)* | Retry doesn't duplicate runs/activities | T-QUEUE-06 | integration | PASS | runs 9→9, activities 14→14 | — | — |
| QUEUE-07 *(new R2)* | Failed jobs observable with sanitized errors | T-QUEUE-05 | API | PASS | `r2-api-probe-results.json` | — | — |
| QUEUE-08 *(new R2)* | Separate BullMQ queues for webhooks, workflows and sync | T-QUEUE-10 | static | FAIL | one queue (`woopulse-webhooks`); workflows run inside the webhook job; sync runs in the HTTP request | MR-11 | — |
| QUEUE-09 *(new R2)* | Worker runnable independently | T-QUEUE-09 | integration | PASS | `npm run worker` exits 0 with in-process explanation when `REDIS_URL` empty; BullMQ consumption itself BLOCKED | ENV-06 | — |
| QUEUE-10 *(new R2)* | Queue/cache health visible | T-QUEUE-07/08 | API | PASS | `/api/store` reports driver + counts + cache hits/misses | — | — |

### WORKFLOW
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| WORKFLOW-01 | On-hold → email + task | T-WORKFLOW-01 | API | PASS | `api-probe-results.json` | — | PASS |
| WORKFLOW-02 | Actions create activities | T-WORKFLOW-02 | API | PASS | `api-probe-results.json` | — | PASS |
| WORKFLOW-03 | Every seeded workflow executes | T-WORKFLOW-05 | integration | PASS | `workflow-runs-after-probes.txt` (all 5 SUCCESS) | — | PASS |
| WORKFLOW-04 | Failing workflow doesn't block others | T-WORKFLOW-03 | integration | PASS | `audit-after` ran | — (AUD-002 resolved) | FAIL |
| WORKFLOW-05 | Failures produce FAILED run | T-WORKFLOW-04 | integration | PASS | `audit-bogus` FAILED | — (AUD-002 resolved) | FAIL |
| WORKFLOW-06 | Delayed actions, configurable demo/normal delay | T-WORKFLOW-06 | static | FAIL | not implemented | MR-05 | FAIL |
| WORKFLOW-07 | Tests per seeded workflow incl. failure path | T-WORKFLOW-07 | static | FAIL | failure path now tested; review-request & retention have no dedicated tests | MR-08 | FAIL |
| WORKFLOW-08 | Every execution creates WorkflowRun **and** Activity | T-WORKFLOW-08 | integration | FAIL | `WORKFLOW`-type activities: 0 | MR-09 | FAIL |
| WORKFLOW-09 | Initial sync triggers no workflows | T-WORKFLOW-09 | integration | PASS | `initial-sync-workflow-runs.txt` (0 runs after boot sync) | — | NOT RUN |

### EMAIL
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| EMAIL-01 | Draft until approved; edited content sent | T-EMAIL-01 | API | PASS | `api-probe-results.json` | — | PASS |
| EMAIL-02 | Sent email can't be re-sent | T-EMAIL-02 | API | PASS | 400 | — | PASS |
| EMAIL-03 | SMTP/Mailpit transport | T-EMAIL-03 | static | FAIL | log transport | MR-04 | FAIL |
| EMAIL-04 *(new R2)* | Workflow emails create activities | T-WORKFLOW-02 | API | PASS | see WORKFLOW-02 | — | — |

### AI
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| AI-01 | Typed tools, Zod-validated, no SQL | T-AI-04 | API | PASS | tool list has no send/SQL tools | — | PASS |
| AI-02 | Rules-mode summary grounded | T-AI-01 | API | PASS | sources ⊆ real orders | — | PASS |
| AI-03 | LLM-mode summary grounded | T-AI-05 | API | PASS | `llm-grounding-results.json` (model override); total $1,328.50 matches CRM LTV | AUD-020 (default model) | BLOCKED |
| AI-04 | Drafts stored as editable DRAFT | T-AI-02 | API | PASS | `api-probe-results.json` | — | PASS |
| AI-05 | Sending requires explicit confirmation | T-EMAIL-01 + T-AI-04 | API | PASS | no send tool | — | PASS |
| AI-06 | Tools can't exceed user authority | T-AI-04 | API | PASS | only agent-level tools exposed | — | PASS |
| AI-07 | Graceful without an LLM key | T-AI-03 | API | PASS | explanatory message | — | PASS |
| AI-08 | AI explains risk flags from rule results | T-AI-07 | code | NEEDS REVIEW | rule reasons + summary risks; no dedicated LLM risk explainer | — | NEEDS REVIEW |
| AI-09 *(new R2)* | Returned source IDs validated against CRM records | T-AI-08 | code | FAIL | `ai.service.ts` returns model `sources` unfiltered (this run's sources happened to be valid) | AUD-019 | — |
| AI-10 *(new R2)* | Copilot tool-calling works in LLM mode | T-AI-09 | API | FAIL | provider 400 `tool_use_failed`: `customerId` null rejected by tool schema | AUD-021 | — |
| AI-11 *(new R2)* | Configured default model works with the configured provider | T-AI-10 | API | FAIL | Groq 404: `llama-3.3-70b-versatile` unavailable | AUD-020 | — |

### UI
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| UI-01 | All routes reachable | T-UI-01 | API | PASS | 9 routes 200 | — | PASS |
| UI-02 | Protected routes redirect to login | T-UI-02 | E2E | BLOCKED | no browser automation | ENV-04 | NOT RUN |
| UI-03 | Loading/empty/error states | T-UI-04 | code | FAIL | note/task composer & tag editor show no errors | AUD-018 | FAIL |
| UI-04 | Forms/notes/tasks/search persist via UI | T-UI-05 | E2E | BLOCKED | no browser automation | ENV-04 | NOT RUN |
| UI-05 | Rendered dashboard agrees with backend | T-UI-06 | E2E | BLOCKED | API agreement PASS (ORDER-02/03) | ENV-04 | NOT RUN |
| UI-06 | Client typechecks and builds | T-UI-07 | build | PASS | `typecheck-output.txt`, `build-output.txt` (client ✓ built) | — | PASS |

### SEC
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| SEC-01 | Password hashes never exposed | T-SEC-01 | security | PASS | `api-probe-results.json` | — | PASS |
| SEC-02 | Input validation | T-SEC-02/09 | security | PASS | 400s | — | PASS |
| SEC-03 | Malformed JSON → 4xx | T-SEC-07 | security | FAIL | 500 | AUD-012 | FAIL |
| SEC-04 | Invalid FK → 4xx | T-SEC-08 | security | FAIL | 500 | AUD-013 | FAIL |
| SEC-05 | No stack traces in responses | T-SEC-10 | security | PASS | 404s clean | — | PASS |
| SEC-06 | Woo credentials never returned | T-SEC-05 | security | PASS | `/api/store` scan | — | PASS |
| SEC-07 | Woo credentials encrypted at rest | T-SEC-12 | static | FAIL | env vars only | MR-06 | FAIL |
| SEC-08 | Insecure default secrets rejected in production | T-SEC-13 | probe | FAIL | `r2-deep-probe-results.json`: production config accepts all defaults | AUD-010 | FAIL |
| SEC-09 | Mock-store mutations require auth | T-SEC-11 | security | FAIL | anonymous 303 → order cancelled | AUD-009 | FAIL |
| SEC-10 | Login brute-force protection | T-SEC-03, T-SEC-03b | security | PASS | 15th bad login 429; correct password refused while locked | — (AUD-016 resolved) | FAIL |
| SEC-11 | CORS restricted | T-SEC-04 | security | FAIL | `*` | AUD-017 | FAIL |

### TEST
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| TEST-01 | Suite passes | T-TEST-01 | unit + integration | PASS | 47/47 | — | PASS |
| TEST-02 | Playwright scenario 1 | T-TEST-02 | E2E | FAIL | absent | MR-08 | FAIL |
| TEST-03 | Playwright signed-webhook scenario | T-TEST-03 | E2E | FAIL | absent (behaviour verified at API/DB level: T-WEBHOOK-03, T-ORDER-01, T-WORKFLOW-01) | MR-08 | FAIL |
| TEST-04 | Frontend component tests | T-TEST-04 | unit | FAIL | none | MR-08 | FAIL |
| TEST-05 | Regression tests for fixed defects | T-TEST-05 | static | NEEDS REVIEW | AUD-001/002/004/016 have tests; AUD-015 verified by probe only | — | NOT APPLICABLE |
| TEST-06 *(new R2)* | Lint | T-TEST-06 | — | NOT APPLICABLE | no lint script configured | — | — |

### DOCS
| Req | Expected | Test | Type | Status | Evidence | Issue | R1 |
|---|---|---|---|---|---|---|---|
| DOCS-01 | README quick start works as written | T-DOCS-01 | integration | FAIL | quick start copies `.env.example` with `REDIS_URL` set → without Redis, webhooks hang (T-WEBHOOK-10) | AUD-022 | FAIL |
| DOCS-02 | Architecture doc matches implementation | T-DOCS-02 | manual | FAIL | `docs/architecture.md` still describes the in-process queue as current and BullMQ as future | AUD-023 | NEEDS REVIEW |
| DOCS-03 | Full doc set (api, data-model, woocommerce-setup, workflows, ai-agent, testing, deployment, demo script) | T-DOCS-03 | manual | FAIL | only `architecture.md`, `video-talking-points.md` | MR-10 | FAIL |
| DOCS-04 | LTV rule documented accurately | T-DOCS-04 | manual | NEEDS REVIEW | README omits that `pending` is excluded (Customers page subtitle states it) | — | NEEDS REVIEW |
| DOCS-05 *(new R2)* | Docs don't claim unverified/unimplemented behaviour | T-DOCS-05 | manual | FAIL | README + talking points claim "if Redis is down, events wait as PENDING" — contradicted by T-WEBHOOK-10; Redis features otherwise unverified live | AUD-022 | — |

---

## AUDIT-R2 status totals (matrix rows)

| Status | Count |
|---|---|
| PASS | 70 |
| FAIL | 36 |
| BLOCKED | 9 |
| NOT RUN | 1 |
| NOT APPLICABLE | 2 |
| NEEDS REVIEW | 6 |
| **Total** | **124** |

*Verified by parsing the status column of every requirement row in this file after writing it (124 rows; two CUSTOMER-02 rows by design).*

## Run history (preserved)
| Run | Date | Commit | Matrix (P/F/B/NR/NA/NRV) | Notes |
|---|---|---|---|---|
| R1 | 2026-10-13 | `37b564f` | 50 / 35 / 4 / 9 / 2 / 5 (105 rows) | First audit; full R1 metadata and matrix in git history (`git show 5c0ba22:CRM_AUDIT_PLAN.md`) |
| AUDIT-R2 | 2026-10-13 | `8de77fe` | 70 / 36 / 9 / 1 / 2 / 6 (124 rows) | Re-ran R1 probes + new R2 probes; stricter grading (inspection-only → NEEDS REVIEW) |

## Final verdict (AUDIT-R2): **FAIL**
See `CRM_ISSUES.md` → *Final verdict* for the reasons, open critical/high issues, and blocked tests.
