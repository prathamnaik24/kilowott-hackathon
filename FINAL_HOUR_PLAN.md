# Final-hour implementation plan (T = 60 min)

Goal: ship a credible, honest demo. **The video is the deliverable that's judged**, so recording time is protected.

| Slot | Owner | Task | Done when | Cut if late? |
|---|---|---|---|---|
| T+0 → T+10 | **You** | Move Docker's disk to D: (Settings → Resources → Advanced → Disk image location → `D:\DockerDesktop`), then `docker ps`, then `docker compose up -d redis` | `docker ps` shows `redis … Up` | Yes. The app runs without Redis (in-process fallback) |
| T+0 → T+30 | **Claude** | UI polish pass (below) on the screens shown in the video | Typecheck + build pass; screens reviewed | Partially (Login/Workflows last) |
| T+10 → T+20 | **Claude** | *If Redis is up:* set `REDIS_URL`, restart, verify queue/cache/rate limit live | *Sync health* shows "BullMQ (Redis)" and cache hits | Yes. Then don't claim Redis on video (see the 🔴 note in the talking points) |
| T+30 → T+35 | **Claude** | Run tests, update docs (test counts, Redis verified or not), commit + push | `npm test` green, pushed | No |
| T+35 → T+55 | **You** | Record the 2-minute video using `docs/video-talking-points.md` → *Suggested running order* | Video exported | No |
| T+55 → T+60 | **You** | Submit repo link + video | Submitted | No |

**Explicitly out of scope** (documented in `CRM_ISSUES.md`, mention honestly if asked): AUD-003 guest-without-email, PostgreSQL, Mailpit/SMTP, Playwright, delayed workflows, real WooCommerce store if Docker isn't ready.

## UI polish pass: what a senior review changes

Problems that make the current UI look generated:
- The violet accent is everywhere (buttons, icons, tags, active nav, tiles), so nothing stands out.
- There are decorative icon tiles on the KPI cards, and an emoji in an empty state.
- Status badges are solid pastel fills in rainbow colours, so tables look noisy.
- Numbers aren't tabular, so columns jitter. Money and counts aren't consistently right-aligned.
- There's a flat sidebar with no grouping, no visible "live" state, and no global search.
- Customers have no avatars, so the people-centric CRM feel is missing.
- There's a gradient login background.

Changes:
1. **Design tokens**: a neutral zinc palette, one indigo accent, the Inter font, `tabular-nums` for figures, consistent radius, borders and focus rings.
2. **Shared components**: `Avatar` (deterministic initials colour); status and severity badges as a coloured dot plus subtle text (`ring-inset` style); `Card`/`PageHeader`/`Empty` restyled; a new `Stat` component.
3. **App shell**: a grouped sidebar (Workspace / Automation / System), an active indicator, a user card; a top bar with global customer search and a **live sync indicator** (webhook pipeline status).
4. **Dashboard**: one KPI strip with dividers, a stacked status bar with legend, at-risk and recent-order tables with avatars and right-aligned money.
5. **Customers / Customer 360**: avatar + name/email cells, aligned numeric columns, a cleaner profile header.
6. **Login**: a plain, neutral card with no gradient.
