# BUILD_STATUS.md — Gable

Last updated: 2026-10-22

## Current stage

**Stage 1 — Desktop foundation: implemented and verified on macOS (Intel, x64). Windows checks are NOT RUN.** Awaiting owner review gate: "Desktop runs; Windows build path exists".

## Stage tracker

| Stage | Description | Status | Owner gate |
| --- | --- | --- | --- |
| 0 | Product contract & docs | Done (committed 43e1afc) | Review requirements |
| 1 | Desktop foundation + packaging proof | Mac verified; Windows NOT RUN | Desktop runs; Windows path exists |
| 2 | Design system + expense screen | Mac verified; owner visual review pending | Visual approval |
| 3 | Companies, properties, search | Mac verified | |
| 4 | Manual expenses, totals | Mac verified | Totals reconcile |
| 5 | Receipts + OCR | Mac verified; Windows CI pending | Saves time |
| 6 | Dashboard, reports, exports | Mac verified; Windows CI pending | Exports reconcile |
| 7 | Backup, restore, migrations | Not started | Full restore works |
| 8 | QA + Windows RC | Not started | |
| 9 | Acceptance walkthrough | Not started | |

## Evidence log

| Date | Stage | Check | Command | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-10-22 | 0 | Environment probe | `node -v`, `npm -v` | Node v20.18.0, npm 10.8.2 | Informational |
| 2026-10-22 | 0 | Docs created | n/a | PRODUCT, DESIGN, ARCHITECTURE, TEST_PLAN, BUILD_STATUS written | Not reviewed by owner yet |
| 2026-10-22 | 1 | Toolchain compatibility | `npm view` for electron, forge, vite, better-sqlite3 | Electron 45 / Forge 8 / Vitest 5 need Node >= 22.13; local Node 20.18 too old | Owner approved Node 22 via nvm (v22.23.4, side by side; nvm default alias set to 22 because none existed; /usr/local/bin/node untouched) |
| 2026-10-22 | 1 | SQLite loads on both runtimes | Load `better-sqlite3` under Node 22 and `ELECTRON_RUN_AS_NODE` Electron 45 | PASS (SQLite 3.53.4 on Node ABI 127 and Electron/Node 24 ABI 150) | N-API prebuilds; no per-Electron compile |
| 2026-10-22 | 1 | Typecheck | `npm run typecheck` | PASS | |
| 2026-10-22 | 1 | Lint (incl. renderer import boundary) | `npm run lint` | PASS; a probe file importing `better-sqlite3`/`node:fs` in `src/renderer` was rejected by lint | probe removed |
| 2026-10-22 | 1 | Unit/integration tests | `npm test` | PASS: 3 files, 20 tests | Real SQLite in temp dirs: init, reopen, migration rollback, future-schema refusal, parameterization, IPC validation, sender validation, paths |
| 2026-10-22 | 1 | Local Mac package | `npm run package:mac` | PASS (`out/Gable-darwin-x64/Gable.app`, 261 MB) | Only `darwin-x64.node` shipped, unpacked from asar |
| 2026-10-22 | 1 | Packaged-app E2E (Playwright, isolated data dir) | `npm run test:e2e` | PASS: 6/6 | Opens + DB initializes; renderer has no `require`/`process` and exposes only getAppInfo/getSetting/setSetting; malformed IPC rejected; data survives restart; second instance quits; CSP blocks inline script and network fetch |
| 2026-10-22 | 1 | Dev startup | `npm run dev` | PASS: bundles built, window process started, data created under `.dev-data/default` | Window not visually inspected; no screenshots taken this stage |
| 2026-10-22 | 1 | Demo database | `npm run demo:db` | PASS: created `.dev-data/demo/data/gable.db` | Fixture is only the demo marker; see limitations |
| 2026-10-22 | 1 | Windows CI workflow | `.github/workflows/ci.yml` | NOT RUN | Config written, never executed; repo not pushed |
| 2026-10-22 | 1 | Windows installer (`make:win`) | n/a | NOT RUN | Squirrel maker only builds on Windows |
| 2026-10-22 | 1 | Windows packaged-app E2E / native module load | n/a | NOT RUN | Same tests are in CI; needs Windows run |

## Assumptions (Stage 0)

1. Project root is this folder (`gable`); it is empty apart from the guide and is not a git repository. Git init is left to the owner or a later prompt.
2. Stack versions are undecided; they will be verified against official docs in Stage 1. Local Node is v20.18.0, which may be older than what the latest Electron Forge/Vite toolchain requires; Stage 1 will check and, if needed, ask before changing the Node version.
3. Electron Forge is the single packaging pipeline; Vite plugin for bundling if compatible.
4. SQLite binding is a native module (e.g., `better-sqlite3`) needing rebuild per Electron ABI; this is the biggest packaging risk and is tested first.
5. Reporting groups are a fixed internal enum; each category maps to exactly one. Starter-category mapping: Purchase Closing Costs → Purchase closing; Materials/Labor/Plumbing/Electrical/Permits/Maintenance → Renovation/repairs; Utilities/Insurance/Property Taxes/Financing Interest & Fees → Holding; Realtor Commissions / Seller Closing Costs / Other Selling Costs → their own selling subgroups; Other → Other (shown separately, included in project cost). To be confirmed at Stage 3/4.
6. "Other" category expenses on a property count toward project cost (since project cost = purchase + all posted property expenses).
7. ROI is stored as an exact ratio from integer cents and displayed to two decimals with half-up rounding.
8. Windows target is x64 first; ARM64 untested until stated otherwise. Supported Windows versions will be set in Stage 8 from current Electron support.
9. Windows validation is NOT RUN until a Windows machine or hosted CI is used. Hosted CI needs a GitHub repository (none exists); a local Windows build alternative will be documented.
10. Fonts will be selected at Stage 2 from open-license families bundled locally; none chosen yet.
11. The demo/fixture database is a separate profile and is never created automatically in production.
12. Dates use the machine's local calendar date for "today".

## Observations on the guide (for owner)

- Fixture B in Prompt 4 mentions "labor/materials $25,000, taxes/insurance $8,000, repairs $12,000, holding $10,000, closing $5,000" = $60,000, plus commission $15,000 and seller closing $5,000 = $80,000 total expenses. This matches the stated $80,000, $280,000 project cost, $70,000 profit, 25% ROI.
- Fixture B "2026 expenses are $20,000" matches commission + seller closing.
- Days held for 2021-01-15 → 2026-03-15 will be verified in code at Stage 4; the guide states 1,885 days / 5 years 2 months.
- Fixture C: 2025-01-15 → 2026-03-15 is 424 days (365 + 59); consistent with the guide.

## Stage 7 status (2026-10-22): backups, restore, migrations — implemented, NOT fully verified

- Built: streaming zip backups (consistent SQLite snapshot + receipts + logos + checksummed manifest, written to a temporary name then renamed), daily automatic backup while the app is open (14 newest kept; manual and pre-restore backups never auto-deleted), restore that validates in staging (safe paths, checksums, integrity, future-schema refusal), a pre-restore safety backup, rollback on failure, all-or-nothing upgrades with a pre-upgrade copy, Backups screen, receipt-file check. Not encrypted.
- Verified on macOS: 42 unit tests in `tests/unit/backup.test.ts` (round trip, corrupt/truncated/unsafe/future archives, fault injection at every restore step, older-schema upgrade, low disk, busy database, retention). Packaged-app backup tests exist; one (auto-backup checkbox) was fixed but not re-run.
- NOT verified: Stage 7 on Windows; the native folder and file dialogs; restart-after-restore on a real install.

## Open issue: intermittent second-launch reader hang (UNRESOLVED)

Receipt reading now runs in separate killable processes with pdf.js bundled (this fixed PDF handling and the earlier quit hang). Remaining: in roughly 1 of 3 isolated runs of the "drafts survive restart" test, the second app launch never starts its reader. A process sample showed the main thread idle and no reader process. Leading hypothesis is macOS App Nap throttling a hidden test window. A keep-awake (powerSaveBlocker) during reading and `backgroundThrottling: false` were just added and are UNTESTED. Do not treat OCR as reliable until this is confirmed over repeated full runs and a green Windows CI.

## (Earlier notes) intermittent receipt-reading hang (found in Stage 5/6)

Symptom: in full packaged-app test runs (and once on Windows CI) a receipt-reading job sometimes never finished, and quitting the app then hung because a worker thread could not be stopped. It did not reproduce in isolation or in a 60-round stress test of the worker pool. Mitigations added: per-job timeouts (inspect 30 s, preview 30 s, read 180 s), a hard exit 3 seconds after quit begins, and a support log (`<data>/logs/gable.log`) with job timings and engine milestones (no receipt contents). After these, 3 consecutive full macOS runs passed (40/40 each, earlier runs had 1 failure in about 3). Root cause is NOT proven; the leading hypothesis is a race when two worker threads start native/WASM code at the same moment. If it recurs, the log shows which step stalled. Treat the OCR reading as unproven on Windows until CI is green repeatedly.

## Stage 6 evidence (2026-10-22, macOS)

| Check | Result |
| --- | --- |
| Unit/integration | PASS: 189 tests. Report tests use three companies and the guide's fixtures A and B plus a 2025 loss with a voided expense and a very long address |
| Sold-property performance (by SALE date) | PASS: 2026 includes 125 Oak Drive (cost $268,000, profit $42,000, 15.67%) and 71 Northgate Terrace (cost $280,000, profit $70,000, 25.00%) with their 2025/2021 costs; totals $548,000 cost, $112,000 profit, 20.44% overall; the 2025 sale is excluded |
| Expense activity (by EXPENSE date) | PASS: only expense-dated rows; general company expenses in a separate section; by-category, by-property, expense list and allocations all equal the same total; a split expense counts once |
| Overview | PASS: figures equal the report totals (active properties, unsold investment, realized profit, general company expenses, shown separately), per-company subtotals in All Companies |
| Excel | PASS: real .xlsx written without a spreadsheet library (fflate zip + Office Open XML). Read back with ExcelJS: numeric money cells with a $ format, real date cells, percent format, frozen header, autofilter, widths, basis/company/as-of on every sheet; strings starting with = + - @ are stored as quoted text and no formula cells exist; no file paths in the package |
| PDF | PASS: self-contained HTML printed by the built-in print engine in a hidden script-free window; fonts embedded; repeating table headers; page numbers ("Page 1 of N"). Text extracted from exported PDFs with pdf.js matches the screen totals |
| Export errors | PASS: writing is atomic (temporary file then rename); a missing folder gives "That folder no longer exists"; messages for file-in-use, permission, disk full |

Stage 6 limits:
- The native Save dialog was not exercised by automation (tests use `GABLE_TEST_EXPORT_DIR`). Cancelling the dialog is covered by logic only.
- PDF pages were inspected through extracted text and file size, not yet by eye on every report; visual PDF review is part of Stage 8.
- "Last 12 months" and year presets use the computer's clock. Dates in tests are fixed.
- Excel formulas are not written; totals are values (so they cannot drift from the screen).
- Recent activity on the overview is "most recently recorded", not by expense date.

## Windows CI evidence (GitHub Actions `windows-latest`)

Run for commit `173ef9c` (all of Stages 1 to 4 plus the OCR libraries): **success** on Windows x64 and macOS. Steps passed on Windows: `npm ci`, typecheck, lint, unit tests, `npm run test:e2e` (package, then Playwright against the packaged `Gable.exe`), and `make:win` (Squirrel installer uploaded as an artifact). Earlier runs failed for real portability bugs that were fixed: a path-semantics unit test, a test helper leaving a SQLite file open (EBUSY), and `VAR=1 cmd` npm scripts (now `cross-env`).
Still NOT done for Windows: installing the installer on a clean machine, running it as a standard non-admin user, native dialogs, real display scaling, and a human walkthrough. A green CI run is not a clean-machine test and the installer is unsigned.

## Stage 5 evidence (2026-10-22, macOS)

| Check | Result |
| --- | --- |
| Unit/integration | PASS: 168 tests (parser 14, OCR pipeline 13 with real Tesseract, receipt service 26 with a stand-in reader) |
| Packaged-app E2E | PASS: 35 tests, including real OCR in worker threads from the packaged app (clean photo, sideways photo, digital PDF text layer, scanned PDF, ambiguous total, mixed batch with corrupt/encrypted/31-page files reported individually, Save All Reviewed, duplicate warning and override, restart persistence, keep-my-edits retry, split save) |
| Offline | The engine, WASM core and English language data ship in the app and are loaded from disk (`langPath`, `corePath`, `workerPath`; `cacheMethod: none`); all bundled files are checked present at start. The packaged tests ran with them. Disconnecting the network and re-running was NOT done. |
| Measured speed (this Intel Mac, not a promise) | Packaged app: clean 640 px PNG from "Add" to "Needs review" about 1.5 s. Node tests per file are logged by `npm test` ("OCR timings"). |
| Accuracy | Not measured and not promised. Suggestions are always shown as Needs review. Reading confidence is informational only. |

Stage 5 design decisions and limits:
- Reading runs in a pool of at most 2 worker threads (fewer on small machines), never on the main thread. Cancelling a read stops that thread; a restart re-queues interrupted reads.
- PDFs: a text layer is used when a page has at least 40 characters, otherwise the page is rendered locally and read. A PDF is always one receipt; several images can be combined as one receipt. Limits: 25 MB per file, 30 pages per PDF, first 10 scanned pages read (the rest flagged).
- Suggestions: vendor from the first plausible line (exact match to a known vendor preferred, never fuzzy), date (US order; due/expiry lines ignored), total (labeled totals only: "total due", "amount due", "total"; subtotal, tax, tendered, change, tip ignored; two different labeled totals are flagged ambiguous with both offered). No label means the largest amount is offered as a flagged guess.
- Category: explicit vendor rule (exact on a key that ignores store numbers), then a small keyword list, otherwise left blank. Rules are created only on the Categories page or by ticking "Remember this vendor's category" (off by default).
- Duplicates: identical file content (against saved expenses and other queued receipts, same company only) and same vendor, date and total as a saved expense. Always overridable.
- Posting is idempotent (a posting token per receipt). "Save all reviewed" reports each failure and a retry never duplicates.
- Not built: HEIC (rejected with guidance), per-line-item extraction, languages other than English, handwriting.
- The 20-document batch is covered with a stand-in reader in unit tests (14 good, 3 corrupt, 3 unreadable; concurrency bounded). The packaged-app batch used 8 real files, not 20; 20 real documents were not run.
- Windows packaging of the OCR (native canvas, worker thread from the unpacked folder, language data) is untested until CI runs.

## Stage 4 evidence (2026-10-22)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck, lint | `npm run typecheck`, `npm run lint` | PASS |
| Unit/integration (real SQLite) | `npm test` | PASS: 115 tests |
| Guide fixture A (standard) | `tests/unit/expenses.test.ts` | PASS: project cost $268,000.00; profit $42,000.00; ROI 15.67% (1567 basis points); a $1,000 general company expense leaves the property unchanged and shows as company overhead; a $100 expense split $60 Materials + $40 Electrical counts exactly $100; three receipt pages on one expense never repeat the cost |
| Guide fixture B (historical 2021 to 2026) | same | PASS: lifetime expenses $80,000; cost $280,000; profit $70,000; ROI 25.00%; six year rows; 2021 expenses $5,000 and investment $205,000; 2026 expenses $20,000 with commission and seller closing costs listed separately and $350,000 sale proceeds shown separately; a 2022-dated cost entered "in 2026" lands in 2022; editing its date moves annual totals while lifetime cost is unchanged; yearly expenses always reconcile to lifetime (also fuzz-tested with 60 random expenses, 10 voids) |
| Days held | `tests/unit/duration.test.ts` and E2E | PASS: 1,885 days / 5 years 2 months and 424 days |
| Edge cases | unit tests | PASS: zero-cost ROI is "Unavailable"; unsold shows investment to date and no profit/ROI; loss gives negative profit/ROI; malformed or negative currency and zero/negative/duplicate allocation lines rejected; sum mismatch rejected with nothing saved (no expense, vendor or file); company mismatch rejected in the service and by database triggers; no new expenses under archived company/property/category; archived categories stay readable in history; expenses cannot be deleted, only voided |
| Idempotency | unit + E2E | PASS: same idempotency key twice gives one expense and one set of lines/files; a double click on Save creates exactly one expense |
| Attachments | unit + E2E | PASS: stored by content type with opaque names; original can be deleted; HEIC, renamed, empty and over-25 MB files rejected with guidance; a failed save removes already-copied files and can be retried; removing a receipt deletes its file only after the edit is saved |
| Void / history | unit + E2E | PASS: voided expenses disappear from every total and list (unless "Include voided"), stay on record with history, and can be restored |
| Packaged-app E2E | `npm run test:e2e` | PASS: 29 tests. New: property detail numbers for both fixtures, annual breakdown and reconciliation, unsold property, adding an expense with receipts then restart, edit/void/restore recalculation, double-click save, category management, filters, stored receipts |

Stage 4 decisions and limits:
- ROI displays to two decimals ("25.00%", not "25%"), half away from zero, computed from integer cents.
- Reporting-group mapping of starter categories: Materials, Labor, Plumbing, Electrical, Permits, Maintenance are Renovation; Utilities, Insurance, Property Taxes, Financing Interest & Fees are Holding; Purchase Closing Costs, Realtor Commissions, Seller Closing Costs, Other Selling Costs have their own groups; Other is "Other costs" and counts toward project cost. Confirm this mapping.
- Years in By Year run from the earliest of purchase year or any expense year, through sale year (or today) or any later expense. An expense dated before the purchase year adds an earlier row.
- "Open" on a saved receipt uses the system viewer (not tested by automation).
- Annual filters are not built; the lifetime summary is always shown above both views and is unaffected by the view.
- Expense Save no longer shows a preview notice. The Receipt Review page is still a preview with sample receipts until Stage 5.
- Vendors are created implicitly by name per company; no category rule is created unless the user explicitly makes one (rules arrive in Stage 5).

## Stage 3 evidence (2026-10-22)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck, lint | `npm run typecheck`, `npm run lint` | PASS |
| Unit/integration (real SQLite, separate temp DB per test) | `npm test` | PASS: 83 tests. Companies (default, restart, duplicates, archive/replace default, restore, logo validation and opaque storage), properties (validation, historical dates, sale rules, DB constraints and triggers, archived-company rejection in service and storage, company immutability, reopen-sale confirmation), search (scope isolation, All Companies labels, partial address/city/ZIP, punctuation/apostrophes/accents, SQL wildcard and injection text, filters, sort, pagination, index sync on edit), duration (1,885 days / 5y 2m and 424 days fixtures, leap years, DST, month-end clamping) |
| Packaged-app E2E (isolated data dirs, demo data built via the real services) | `npm run test:e2e` | PASS: 21 tests. Adds first-run company then property, restart opens the default, switching leaves the default unchanged, company-scoped and All Companies search, invalid sale date and reopen-sale confirmation, archiving the default needs a replacement, adding from All Companies needs a company choice, expense form offers only that company's properties |
| Screenshots | `npm run screenshots`, `SCREENSHOTS=1 npx playwright test screens-stage3` | Captured and inspected (property list, detail, by year, edit, settings, setup, archive dialog) |

Stage 3 decisions and limits:
- The company of a property is immutable in v1 (service and a database trigger), which is stricter than "once financial records exist". Revisit if David needs to move an unused property.
- Company names must be unique ignoring case and punctuation.
- Property detail shows purchase, sale, exact days held and readable duration (calendar aware, month-end clamped: Jan 31 to Feb 28 counts as one month). The cost bridge and By Year expense columns show "Unavailable" until expenses are stored in Stage 4. "Add receipts" on a property opens the sample review page, which says it is a preview.
- Expense Save is still preview-only (in memory), as labeled on screen; Stage 4 replaces it.
- Company logo picking uses a native dialog in the main process; the renderer receives a data URL, never a path. The dialog path itself was not exercised by automated tests (only the service-level logo validation was).
- The demo database now contains fictional companies and properties built through the real services: `npm run dev:demo`.
- Windows CI: macOS job passed for the first commits. The Windows job failed first on a path-semantics unit test (fixed), then `npm run test:e2e` failed on Windows for a reason not yet known (annotations from the `github` reporter were added to find it).

## Stage 2 evidence (2026-10-22)

| Check | Command | Result |
| --- | --- | --- |
| Typecheck, lint | `npm run typecheck`, `npm run lint` | PASS |
| Unit tests (money, dates, DB, IPC, paths) | `npm test` | PASS: 48 tests (money parsing is string-based; rejects negatives, 3 decimals, junk; formats grouping; real-calendar date validation) |
| Packaged-app E2E | `npm run test:e2e` | PASS: 14 tests. Foundation (6) plus expense form (8): validation keeps typed input and focuses first problem; negative amount rejected; Save & add another keeps property/date, clears the rest, focuses vendor; split must sum exactly; unsaved-work dialog on navigation and on company switch (form never moves); HEIC and other unsupported files explained; All Companies requires choosing a company |
| Visual capture | `npm run screenshots` | PASS: 5 sizes x 13 screens in `docs/screenshots/` (not committed, regenerate with the command). Screenshots were inspected by viewing them; issues found and fixed: right-aligned text in selects, broken receipt-review layout (container query on the container itself), clipped 125/150% captures (tooling), open dropdown on programmatic focus, double scrollbar |
| Contrast | computed ratios | Recorded in DESIGN.md. Brass `#A78348` is 3.2:1 on ivory so it is used for non-text accents only |
| Windows rendering | n/a | NOT RUN |
| CI | `.github/workflows/ci.yml` | Pushed 2026-10-22; run result not yet confirmed (GitHub API listed no runs when last checked) |

Stage 2 limitations:
- All data is fictional and in memory. Expense Save, receipt review Save, "Try reading again", and attachments do not persist or run OCR. Every such screen says so. Real behavior comes in Prompts 3 to 5.
- Keyboard-only use was exercised through automated tests (tab focus, Enter/Escape, dialogs) but not through a full manual screen-reader pass.
- Windows scaling is emulated by window size, not real OS scaling.
- The packaged app still uses the default Electron icon.
- Native `<select>` is used for the company switcher and status filters (accessible and keyboard friendly; its popup look is OS-drawn).

## Stage 1 notes and limitations

- Intel Mac (x86_64): macOS verification covers x64 only. `macos-latest` CI is arm64 and will exercise the `darwin-arm64` prebuild.
- The demo database holds only the demo marker, because the schema has just a settings table. Fictional companies/properties come with their tables (Prompts 2-3). This is less than the "realistic fixture" the guide asks for and is deliberately deferred, not done.
- Windows: ARM64 untested. Installer unsigned (publisher warning expected). Squirrel `electron-squirrel-startup` shortcut handling is untested until a Windows run.
- Embedded ASAR integrity fuse is off for now (revisit in Stage 8).
- Vite configs are `.mts` to avoid Vite's CJS-config deprecation warning.
- Node 22 is required; documented in `README.md` and `.nvmrc`/`engines`.
- Nothing pushed. Remote `origin` is set; CI cannot run until the owner pushes.

## Decisions (owner)

- 2026-10-22: Product name is **Gable**.
- 2026-10-22: **Single repository:** https://github.com/igheddx/gable (empty at time of decision). `gable-frontend` and `gable-backend` repos are not used; Gable has no hosted backend (offline Electron app, per the guide).
- 2026-10-22: Owner has a Windows machine for testing. Develop on macOS; Windows is the primary target.
- Local git initialised on `main` with `origin` set to the repo above.
- 2026-10-22: Approved installing Node 22 via nvm for the toolchain.

## Open questions (none blocking Stage 1)

- Do you want `git init` now, and will there be a GitHub repository for Windows CI?
- Is there access to a Windows machine for later testing, or will CI be the only Windows path?
- (Resolved) Product name is Gable.

## Next steps

1. Push to GitHub (on your instruction) so the Windows CI job runs; or run the commands in `README.md` on your Windows PC.
2. Report the Windows results here; they are NOT RUN until then.
3. Then run **Prompt 2** (design system and expense screen).
