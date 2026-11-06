Verdict: CHANGES_REQUESTED

# Design review M6, iteration 1

- Reviewer: design-reviewer (read-only). Disimpan oleh Orchestrator dari jawaban akhir reviewer tanpa diubah isinya.
- Worktree `.agent/wt-m6`, branch `milestone/6-hardening`, HEAD `4fabdb4`. Production build `.next` built at 11:43; later commits touch no `dashboard/src`.
- Sources of truth: SPEC §1–2, M6-plan §2.8 + AC-6.30–6.38, DEC-017 §9, DEC-019 §2–3.
- Measurements: read-only Playwright audit against `next start` with a temporary DB (seed demo + `seedM6Ui` + fake media, random admin password held only in env). 8 widths: 375, 414, 768, 800, 1024, 1279, 1280, 1440. Pages: `/login`, `/hosts`, host Sheet (5 tabs, at 375/768/1440), `/jobs`, `/jobs?job=<failed>`, `/jobs?job=<missing>`, `/jobs?host=<invalid>`, `/os-images`, `/ssh-keys`, `/settings`; plus keyboard navigation for login and logout.
- Script/output: `.agent/runs/m6/design-review/{dr.config.ts,dr.spec.ts,dr2.spec.ts,results.json,focus.json,shots/}`. Run: `cd dashboard && NODE_PATH=$PWD/node_modules DR_TMP=<tmp> npx playwright test -c ../.agent/runs/m6/design-review/dr.config.ts`

## Objective checks

| Check | Result |
|---|---|
| body bg `#f7f7f4` | PASS at every page and width |
| Drop shadow | PASS: 0 elements. Only zero-blur 1px hairline rings on `Card` and focus rings (DR-6-9) |
| Orange only on main CTA and focus | PASS. `bg #f54e00` only on "Masuk", "Daftarkan image", "Tambah key", Sheet "Install"; other orange = focus ring/border/outline |
| Technical data in JetBrains Mono | PASS for MACs, IPs, paths, hashes, fingerprints, username fields, sidebar username. One exception: DR-6-7 |
| Page titles 26px/400, −0.325px | PASS on every page including "Masuk" |
| Pastel only on status pills and timeline | PASS |
| Login card | PASS: white, 1px `#e6e5e0` border, radius 12, no shadow, max 400, padding 24/32; inputs 44px r8; button 40px 14/500; username mono |
| No page overflow | PASS at all 8 widths on every page, login, Sheet. Some tables scroll in own container (DR-6-6) |
| Login keyboard | PASS. Autofocus username → password → toggle → Masuk with `:focus-visible`; Enter submits; error focus → Alert (`role=alert`). Weak input ring: DR-6-4 |
| Logout | PASS. "Keluar" keyboard reachable, 2px ring, → `/login` focus username; icon mode 32px labelled; visible in 375 mobile sidebar |
| axe | 0 violations outside filter in both runs; 607 filtered nodes all in 4 registered pairs; `verified-pass` used 0 times; 4 Sheet nodes are exception pairs. See DR-6-1, DR-6-10 |

## Findings

| ID | Severity | Location / evidence | Description | Fix |
|---|---|---|---|---|
| DR-6-1 | **major** | `dashboard/src/components/jobs/jobs-table.tsx:83` (`job-row-failure`); `components/hosts/columns.tsx:123` (`host-failure-reason`); `components/host-config/config-sheet.tsx:114` (only "Install terakhir gagal:" prefix red; reason muted); `components/jobs/log-viewer.tsx:82` ("Job tidak ditemukan — …", "Sesi berakhir…"). Evidence: `results.json` → `/jobs*` `mutedImportant`: "Installer melaporkan gagal" `#807d72` at all 8 widths; `design-review/shots/_jobs_job_job-m6ui-007-1440.png`. | DEC-017 §9: important information (errors, Failed reasons, status labels) must not use `muted`. Failed reasons in Jobs table, Hosts table and Sheet, plus log error and session-expired messages, use `text-muted-foreground` (4.12:1). The axe filter passes them as `exception:muted/white` (7 `job-row-failure` nodes each in `/jobs detail@1440` and `@375`) — the exception pair hides a usage DEC-017 forbids. Rule already applied to the Offline pill, not to Failed reasons. | Change to `text-body` (#5a5852, ~6.9:1), or `text-destructive` if emphasis wanted. Add E2E assertion that computed color of `job-row-failure`, `host-failure-reason`, `sheet-last-job-failure` and log `not-found`/`session` messages is not `#807d72`. Leave axe filter unchanged. |
| DR-6-2 | minor | `dashboard/src/components/jobs/job-timeline.tsx:44`; `results.json` `/jobs?job=job-m6ui-007` `mutedImportant`: "Installing", "Configuring" | Labels for not-yet-reached timeline stages are status labels in `text-muted-foreground`, conflicting with DEC-017 §9 literally. | Use `text-body` on the pending outline badge. |
| DR-6-3 | minor (needs Orchestrator decision) | `dashboard/src/components/os-images/os-images-view.tsx:106` (`AvailabilityCell`), `components/host-config/tab-os.tsx:345`; `results.json` `/os-images` + Sheet OS `mutedImportant`: "Media ubuntu-22.04 tidak tersedia (…)" | "Not available" reason muted on purpose under DR-4-5 ("limitation, not error"); DEC-017 §9 forbids muted for errors/status labels. Conflict not settled by any DEC. | Switch to `text-body` keeping info icon (not red), or add a DEC exempting it. |
| DR-6-4 | minor | `dashboard/src/components/ui/input.tsx:10` (`focus-visible:ring-ring/15` + `border-hairline-strong`), same in `input-group.tsx:17`; `design-review/focus.json`, `shots/focus-0-username.png`, `shots/focus-1.png` | Input focus indicator weak: ring orange at 15% (~1.2:1), border `#cfcdc4` (~1.6:1). 2.4.7 met, but below 3:1 non-text contrast implied by M6 "visible focus" target. Buttons/toggle use `ring/50`. Pattern from M1. | Raise to `ring-ring/40`–`/50` or `focus-visible:border-ring` on inputs and input group. |
| DR-6-5 | minor | `dashboard/src/components/server-status.tsx:27-31, 72-75`; `shots/_hosts-1440.png`, `screenshots/os-images-375.png` | DHCP/TFTP/HTTP online/offline/unknown shown visually only by dot color; text only `sr-only` + tooltip. Fails WCAG 1.4.1; axe does not detect. Below `sm` even service name hidden. | Distinct shape per state (check/cross/outline) or short visual label; keep service name visible at every width. |
| DR-6-6 | minor | `results.json` `/hosts` `offenders`: table 1795px at 1440; `shots/_hosts-1440.png`; `/jobs` table `right=446` at 375/414 | With valid 63-char hostname, HOSTNAME column unbounded; at 1440 STATUS, LAST SEEN, Aksi pushed into table scroll. Page itself does not overflow. Jobs table at 375/414 scrolls in container. Pre-M6, but M6 extreme-data audit should have caught the first. | Hostname cell `max-w-[24ch] truncate` + `title`; full name in Sheet. |
| DR-6-7 | minor | `dashboard/src/lib/net.ts:158` via `FieldError` (`tab-network.tsx:101`); `results.json` sheet Network `nonMono`: "Di luar subnet 10.99.0.0/24" | CIDR inside validation error in sans; SPEC requires mono for technical data. | Render CIDR with `type-data` (split message like `ReasonText`). |
| DR-6-8 | minor | `dashboard/src/components/jobs/job-detail.tsx:35-40`; `shots/crop-jobs-notfound-1440.png` | Not-found state shows "Job tidak ditemukan" twice (title + description); inconsistent with log not-found explanation. | For 404 use explanatory description same as `log-viewer.tsx:86`; don't repeat title. |
| DR-6-9 | info | `dashboard/src/components/ui/card.tsx` (`ring-1`); `results.json` `rings` | Card hairline via zero-blur 1px `box-shadow` spread, not `border`. Visually matches SPEC; objective `box-shadow: none` check would flag. | Optional: `border border-border`. |
| DR-6-10 | info | `dashboard/e2e/support/axe.ts:44-150`, `.agent/runs/m6/final/axe-results-run1.json` | Filter review: single named function, computed color + `elementsFromPoint`, ancestor opacity/gradients/unreadable → kept; placeholder exceptions fields only; no rule disabled; self-test covers inside/outside Sheet, opacity, oklab alpha. 607 nodes: muted/white 444, muted/canvas 68, white/stage-done 85, on-primary/primary 10 — all registered pairs. Weakness: color-based filter can't tell whether muted content is important (DR-6-1). | Add DOM assertion "important information is not muted" (not in filter, which DEC-019 keeps color-only). |
| DR-6-11 | info | `.agent/runs/m6/screenshots/login-lockout.png` | "Masuk" looks faded in lockout screenshot though test asserts `toBeEnabled()`; likely captured mid `transition-all` from `disabled:opacity-50`. Not a product defect; evidence misleading. | Screenshot with `animations: "disabled"` or wait for opacity 1. |
| DR-6-12 | info | `screenshots/session-expired-logout.png`; `src/app/login/*` | After session expiry, standard login page with no explanation (not required by plan). | Optional: `?reason=expired` → neutral Alert "Sesi berakhir. Masuk lagi." |
| DR-6-13 | info | `shots/_jobs-768.png`, `shots/_jobs_host_tidak-ada-768.png` | At 768 title "Provisioning Jobs" truncated to "Provision…" (top bar squeezed, I-5-9). No overflow. | Optional: search icon-only earlier. |
| DR-6-14 | info | `dashboard/src/components/dashboard-shell-fallback.tsx:11-13` | Fallback sidebar has `h-16` brand row with `border-b` not in real sidebar → small visual jump. | Match fallback to real sidebar structure. |

## Notes outside the findings (verified OK)
- **Login:** consistent with tokens; brand 17/600; description 13px caption (muted/white, registered exception); destructive Alert `#cf2d56`; lockout text includes N minutes. Sheet tabs at 375 scroll in own container (M3 behaviour).
- **OS images:** paths/IDs mono via `ReasonText`/`PathText`; at 1280 `vmlinuz`/`ubuntu-22.04` don't split; card layout at 375/768 no overflow; ≤ 200px / ≤ 520px limits covered by AC-6.37 and dev-audit (not re-measured).
- **Done pill:** white on `#c08532` the only DEC-019 §2 exception; label text always present.

Severity count: critical 0, major 1 (DR-6-1), minor 7 (DR-6-2 to DR-6-8), info 6.
