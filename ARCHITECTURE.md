# ARCHITECTURE.md — Gable

Status: foundation implemented (Prompt 1). Versions are pinned exactly in `package.json` (`.npmrc` sets `save-exact`) with `package-lock.json` committed.

Decisions made in Prompt 1 (verified in code, see BUILD_STATUS.md):
- Electron 45, Electron Forge 8 (Vite plugin), Vite 8, TypeScript 5.9 (TypeScript 7 was not used to keep lint tooling compatible), Vitest 5, Playwright. Node >= 22.13 is required by Electron/Forge/Vitest.
- `better-sqlite3` 13 ships N-API prebuilt binaries (stable across Node and Electron), so there is no per-Electron compile. Forge's rebuild is disabled (`rebuildConfig.onlyModules: []`), the module is copied into the package by a `packageAfterCopy` hook (only the matching platform prebuild), and `.node` files are unpacked from asar. Loading was verified under Node 22, Electron 45 as Node, and the packaged macOS app.
- Windows installer: Squirrel.Windows maker (per-user Setup.exe, no admin needed). MSI/WiX was not chosen.
- Main/preload bundles are `.vite/build/main.cjs` and `preload.cjs`.
- Electron fuses: RunAsNode off, NODE_OPTIONS off, cookie encryption on, OnlyLoadAppFromAsar on; the inspect-arguments fuse is on only for `GABLE_E2E=1` builds so Playwright can attach.
- CSP is applied from the main process (response header), stricter in the built app than in dev.
- Data location: packaged = OS per-user folder; dev = `.dev-data/default` in the repo; `GABLE_DATA_DIR` overrides.

## 1. Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Shell | Electron | Pin to a currently supported release verified in Prompt 1 |
| Packaging | Electron Forge (single pipeline) | Windows installer via a Forge maker (e.g., Squirrel/WiX/MSI, decided in Prompt 1); Mac package for local testing only |
| Build | Vite via Forge's Vite plugin (verify compatibility) | |
| UI | React + TypeScript | Strict TS |
| DB | SQLite via a native binding (e.g., `better-sqlite3`; verify) | Rebuilt for Electron ABI; WAL mode |
| OCR | Tesseract.js, bundled worker/WASM/language data | Prompt 5; worker threads, offline |
| PDF text/render | A local PDF library (e.g., pdf.js) | Prompt 5 |
| Excel | A local `.xlsx` writer (e.g., ExcelJS) | Prompt 6 |
| PDF export | Local print-to-PDF of generated HTML layout | Prompt 6 |
| Dates | Calendar-aware library (e.g., date-fns / Temporal polyfill) | Date-only strings |
| Validation | Schema validation (e.g., Zod) shared by IPC and services | |
| Tests | Unit/integration (Vitest) + Electron E2E (Playwright) | Isolated data dirs |

## 2. Process model

```
Renderer (React, sandboxed, no Node)
   │  window.api.* (typed, task-specific)
Preload (contextBridge only)
   │  ipcRenderer.invoke on an allowlist of channels
Main process
   ├─ IPC layer: validates sender frame + arguments (schema), maps to services
   ├─ Services: business rules, transactions, company consistency
   ├─ Repositories: parameterized SQL only
   ├─ File store: managed receipts, backups, staging
   ├─ Job runners: OCR workers, report/PDF generation (off UI thread)
   └─ Platform adapters: paths, dialogs, backup destinations
```

Rules:
- Renderer cannot reach SQL, the filesystem, or arbitrary IPC. The preload exposes named methods, never `invoke(channel, ...)`.
- Every IPC handler validates `event.senderFrame` origin and its payload; rejects malformed input with a typed error.
- CSP: no remote origins, no `unsafe-eval`; fonts and assets bundled.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, navigation and new-window blocked, `webSecurity` on.
- Single instance via `requestSingleInstanceLock`.

## 3. Repository layout (proposed)

```
src/
  main/           app lifecycle, windows, IPC registration
  preload/        contextBridge API definitions
  renderer/       React app, design system, screens
  shared/         types, zod schemas, IPC contracts, money/date utils
  services/       company, property, expense, receipt, report, backup
  db/             connection, migrations/, repositories
  platform/       path + dialog adapters (mac/win)
  workers/        OCR, PDF render
resources/        fonts, icons, tesseract assets
fixtures/         demo DB builder, synthetic receipts
tests/            unit, integration, e2e
.github/workflows/windows.yml
```

## 4. Data locations

Using Electron `app.getPath('userData')` (and adapters):
- `ledger.db` (+ WAL), `receipts/` (opaque filenames), `staging/`, `backups/` (default), `settings.json` or settings table.
- Dev/test/demo use separate roots via an environment variable. The demo database is never created in production automatically.
- Nothing is written to the install directory.

## 5. Data model (draft; `company` and `property` implemented in migration 2)

All money is `INTEGER` cents. All date-only columns are `TEXT` `YYYY-MM-DD`. Audit timestamps are ISO UTC `TEXT`.

- `company` (id, display_name, legal_name, address…, phone, email, logo_file_id, is_archived, created_at, updated_at)
- `setting` (key, value) — includes `default_company_id`
- `property` (id, company_id, address1, address2, city, state, zip, purchase_date, purchase_price_cents, status, sale_date, sale_price_cents, description, notes, is_archived, …) — CHECKs: Sold ⇒ sale fields set; sale_date ≥ purchase_date
- **Business types (migration 5).** `business_type` (id, name, name_key UNIQUE, template {renovation, rental, buy_sell, income_expense}, is_builtin, is_archived, sort_order); ids 1 to 3 are the built-in Renovation, Rental, Vehicle. `property` was rebuilt (the table keeps its name so every expense, receipt draft and report still points at it) to add `business_type_id` (immutable by trigger), `identifier`, make `city/state/zip` allow empty (an item with no address stores its name in `address1`), and make purchase date/price nullable together (required for renovations and buy-and-sell, optional for rentals, absent for ongoing businesses; enforced in `PropertyService`, with per-template statuses). `income` (id, company_id, property_id, income_date, amount_cents > 0, category, notes, status {posted, voided}, idempotency_key UNIQUE) with triggers: same company, item not archived, only `rental`/`income_expense` items, never deleted. The rebuild keeps the old rows aside, drops and recreates `property`, and puts them back with the same ids inside the one migration transaction, using `PRAGMA defer_foreign_keys`, so expenses and drafts pointing at those ids are only checked at commit. Seven starter categories were added for cars and rentals (new companies get them at creation; migration 5 adds them to existing companies).
- `category` (id, company_id, name, reporting_group, is_archived, sort_order, …)
- `reporting_group` enum: PURCHASE_CLOSING, RENOVATION, HOLDING, SELLING_REALTOR, SELLING_CLOSING, SELLING_OTHER, OTHER (final list set in Prompt 3/4; mapping per category is stable)
- `expense` (id, company_id, property_id NULL, vendor_id/vendor_name, expense_date, total_cents, notes, status {posted, voided}, idempotency_key UNIQUE, created_at, updated_at, voided_at)
- `expense_allocation` (id, expense_id, category_id, amount_cents) — sum per expense = `expense.total_cents` (enforced in service in one transaction, plus a verification query/trigger)
- `expense_event` (id, expense_id, type, before_json, after_json, at) — change history
- `vendor` (id, company_id, name, normalized_name)
- `vendor_rule` (id, company_id, normalized_vendor, category_id, created_by_user_at)
- `receipt_file` (id, company_id, opaque_name, sha256, mime, size, pages, expense_id NULL, draft_id NULL, created_at)
- `receipt_draft` (id, company_id, property_id NULL, status, suggested_json, user_json, ocr_text, posting_token UNIQUE, posted_expense_id, error, …)
- `schema_migration` (version, applied_at, app_version)

Consistency enforced in services and, where practical, DB: composite FKs or triggers so `expense.company_id = property.company_id = category.company_id`. Indexes on `(company_id, status)`, `(property_id, expense_date)`, `(company_id, expense_date)`, `sha256`, vendor normalized names, and address/ZIP search columns.

## 6. Calculation layer

Template rules: `renovation` and `buy_sell` items go through `propertyFinancials` (cost bridge, profit, ROI, by year). `rental` and `income_expense` items go through `FinancialService.cashFlow` (income, expenses, net by year, with the same kind of reconciliation check). `ReportService` restricts sold/unsold/overview-investment to the first two and reports the second pair separately (`income-expense` report, per-item cash-flow report, overview "Rentals and other income").

A single `calc` module (pure functions over integer cents and date strings) feeds property detail, dashboard, reports, and exports so they reconcile:
- `projectCost`, `profit`, `roi` (basis points → display with 2 decimals, rounding rule documented), `daysHeld`, `durationYMD`
- `lifetimeBridge(propertyId)`, `byYear(propertyId)`, `soldPeriod(range)`, `expenseActivity(range)`, `portfolioSnapshot()`
- All exclude voided expenses; allocation lines are the unit of reporting (never multiplied by header joins).
- ROI: compute from integers with half-up rounding at display; `null` when project cost is 0 or property unsold.

## 7. Receipt and OCR pipeline (Prompt 5)

Import → copy to staging → validate (type via magic bytes, size, pages, encryption) → hash → move to managed storage → job queue (bounded concurrency) → OCR worker (images) or PDF text layer / render-then-OCR → parse candidates (transparent rules) → persisted draft (`Needs review`) → user review → idempotent post (transaction: expense, allocations, attachments, draft completion).

## 8. Backup and restore (Prompt 7)

- Snapshot using SQLite online backup API (or `VACUUM INTO`) while mutations are paused; copy referenced receipts; write manifest (versions, checksums, counts) into a single archive.
- Restore: extract to staging with safe-path checks → validate manifest/checksums/schema/attachments → pre-restore backup → swap with rollback → reopen.
- Migrations: forward-only, transactional, with a pre-upgrade backup retained.

## 9. Build, run, and CI

- `npm run dev` — one-command Mac dev start (separate dev data dir).
- `npm run package:mac` — local Mac package.
- `npm run lint`, `typecheck`, `test`, `test:e2e`.
- `.github/workflows/windows.yml` — locked install, tests, native rebuild for Electron, Windows x64 installer artifact. Hosted CI requires a GitHub repository (none exists yet); local Windows build instructions provided as the alternative. ARM64 status documented as untested unless verified.
- No pushing, publishing, or purchasing signing without instruction.

## 10. Key decisions and risks

- Native module (SQLite) and OCR WASM must work in the *packaged* app; verified in Prompt 1 (SQLite) and Prompt 5 (OCR).
- Windows validation cannot be done on this Mac; it stays NOT RUN until a Windows machine or CI runs it.
- Single-writer policy: all writes go through main-process services serialized through one connection.
