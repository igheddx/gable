# TEST_PLAN.md — Gable

Principle: every stage produces evidence (command, actual output summary, date) recorded in BUILD_STATUS.md. Status values: PASS / FAIL / NOT RUN. Never mark Windows checks PASS from a Mac run. Tests use isolated data directories; never touch real user data.

## 1. Test layers

| Layer | Tooling (proposed) | Scope |
| --- | --- | --- |
| Unit | Vitest | Money parsing/formatting, ROI, duration, by-year grouping, OCR parsing rules, allocation sums, normalization |
| Integration | Vitest + real SQLite in temp dirs | Services, repositories, migrations, company consistency, idempotent posting, backup/restore |
| IPC security | Vitest/Electron | Malformed payload rejection, sender validation, no raw SQL/fs exposure |
| E2E | Playwright for Electron | David's core workflows with isolated profiles |
| Visual | Screenshots at target sizes | Design review (Prompt 2, Prompt 8) |
| Windows | Windows CI + clean machine | Installer, packaged native modules/OCR, non-admin, offline |

## 2. Stage acceptance criteria

### Stage 0 — Contract
- [ ] Five documents exist and match the guide.
- [ ] Assumptions listed; no app code.

### Stage 1 — Foundation
- [ ] App opens on Mac via one command.
- [ ] Empty DB initializes, reopens with data intact.
- [ ] Malformed IPC rejected; renderer has no fs/SQL access (test).
- [ ] Single-instance lock works.
- [ ] Lint, typecheck, tests run.
- [ ] Local Mac package builds; packaged app opens and loads SQLite.
- [ ] Windows CI workflow present and statically reviewed (NOT RUN until executed).

### Stage 2 — Design milestone (owner review gate)
- [ ] Tokens, components, showcase exist.
- [ ] Screens: expense entry, receipt review, property list at 1280×800, 1366×768, 1920×1080; 125/150% scale.
- [ ] Contrast table recorded; keyboard and reduced-motion checks.
- [ ] No fake-functional buttons.

### Stage 3 — Companies, properties, search
- [ ] 3 companies, default persists across restart; switching doesn't alter default.
- [ ] Property create/search/edit/archive; cross-company references rejected.
- [ ] Archiving unresolved default rejected.
- [ ] Sale validation (date order, required price when Sold).
- [ ] Switch with unsaved form → save/discard/cancel.
- [ ] Search: punctuation, apostrophes, partial ZIP/address; no cross-company leakage.

### Stage 4 — Manual expenses and totals (owner review gate)
- [ ] Fixture A: cost $268,000; profit $42,000; ROI 15.67%.
- [ ] Fixture A-neg: $1,000 general expense leaves profit unchanged.
- [ ] Fixture A-split: $60 + $40 counts $100.
- [ ] Fixture B: lifetime expenses $80,000; cost $280,000; profit $70,000; ROI 25%; 1,885 days / 5y 2m; 2021 expenses $5,000, investment $205,000; 2026 expenses $20,000.
- [ ] Expense dated 2022 entered "in 2026" lands in 2022; changing date moves annual totals, lifetime unchanged.
- [ ] Double-submit protection (UI + DB idempotency).
- [ ] Void/unvoid recalculates every view; history recorded.
- [ ] Attachments survive removal of the source file; multi-page attachments don't duplicate cost.
- [ ] Zero-cost ROI, unsold property, malformed currency, negative amount, missing fields, company mismatch.

### Stage 5 — Receipts and OCR (owner review gate)
- [ ] JPG/PNG/PDF import; unsupported, encrypted, corrupt, oversized reported per-file.
- [ ] Multi-page PDF = one draft by default; image grouping/splitting.
- [ ] Labeled total preferred over subtotal/tax/tendered/change; ambiguous stays unconfirmed.
- [ ] Rule priority: vendor rule, keyword, else "Select category"; no silent rule creation.
- [ ] Duplicate hash blocked by warning with override; possible-duplicate warning.
- [ ] Idempotent retry; partial batch success reported exactly.
- [ ] 20-document batch; restart mid-review; interrupted-job recovery.
- [ ] OCR works offline from the packaged app (Mac now; Windows later).
- [ ] Measured throughput recorded (not promised).

### Stage 6 — Reports (owner review gate)
- [ ] Dashboard, property, sold-period, expense-activity, snapshot all reconcile with DB.
- [ ] `.xlsx` opened programmatically: numeric currency cells, dates, filters, frozen headers, formula-injection safe (`=`, `+`, `-`, `@` text).
- [ ] PDF inspected: page numbers, repeating headers, no clipping, no network fonts.
- [ ] Edge data: long addresses, many rows, empty reports, voids, splits, negative profit, cross-period expenses, two-year and three-company fixtures.

### Stage 7 — Backup/restore (owner review gate)
- [ ] Backup → restore into fresh profile: totals, default company, attachments, drafts, rules match.
- [ ] Cancel/fail mid-restore leaves original usable.
- [ ] Path traversal, corrupt, incomplete, future-schema archives rejected.
- [ ] Older-schema restore upgrades correctly; pre-upgrade backup retained.
- [ ] Database busy; missing attachments → actionable recovery states.
- [ ] Failed backup never counted successful nor deletes prior good copies.

### Stage 8 — QA and Windows RC
- [ ] Full audit vs PRODUCT.md / DESIGN.md.
- [ ] E2E core workflows pass.
- [ ] Keyboard-only, focus, scaling, contrast, long data, reduced motion.
- [ ] Windows installer built (CI or Windows machine).
- [ ] Clean Windows test: no dev tools, non-admin, offline, Unicode/space paths, native modules and OCR resources, restart persistence, backups.
- [ ] Upgrade over older build preserves data; uninstall doesn't wipe data silently.
- [ ] Diagnostics export excludes receipts and financial data.
- [ ] Original vector app icon packaged.
- [ ] Signing status stated truthfully; RELEASE_CHECKLIST.md, USER_GUIDE.md produced.

### Stage 9 — Acceptance walkthrough
Walkthrough steps 1–9 from the guide on the installed Windows RC, results in ACCEPTANCE_RESULTS.md.

## 3. Cross-cutting test cases

- **Money:** `"1,234.50"`, `"$1234.5"`, `"12.345"` (reject or defined rounding), `"abc"`, `""`, huge values, `0.00`, negative.
- **Dates:** leap day, month ends, DST transitions, midnight refresh for "today", sale before purchase rejected, same-day = 0 days.
- **Ownership:** every service refuses mixed-company property/category/expense/attachment combos.
- **Voids:** excluded everywhere (property, annual, reports, exports).
- **Concurrency:** repeated clicks, simultaneous IPC calls, single writer.
- **Security:** payload fuzzing for each IPC channel, sender frame mismatch, path traversal in backup/restore, filename sanitization.

## 4. Fixture strategy

- Each fixture scenario is created in its own isolated company or database so added test data cannot invalidate expected totals.
- Demo DB builder is a separate script/profile, labeled fictional.
- Synthetic receipt fixtures (Prompt 5): clean, rotated, poor-quality, ambiguous total, multi-page PDF, digital PDF, invalid file, duplicate file, unsupported format. Generated or clearly synthetic only.

## 5. Evidence format (in BUILD_STATUS.md)

`Check | Command | Result (PASS/FAIL/NOT RUN) | Date | Notes/paths`
