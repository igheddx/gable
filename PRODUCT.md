# PRODUCT.md — Gable

Product name: **Gable** (chosen by owner; trademark clearance not checked).
Source of truth: `David_Property_App_Claude_Code_Prompts.md` (the "guide"). This file restates the product contract; if they conflict, the guide wins and this file must be corrected.

## 1. Users and purpose

- **User:** David, a non-technical real estate entrepreneur who buys, renovates, and sells homes through 2–3 companies.
- **Usage model:** one desktop user, multiple companies. Not multi-user SaaS.
- **Purpose:** track properties and their costs across companies, show lifetime and year-by-year cost and profit, ingest receipts with local OCR (reviewed by David), and produce management reports (Excel, PDF), with reliable backup/restore.
- **Primary deliverable:** installable Windows desktop app (x64 first). Development and functional testing happen on macOS.

## 2. Non-negotiable constraints

- Offline. Local persistent data. No login, subscription, LLM account, API key, cloud hosting, telemetry, or runtime CDN.
- React + TypeScript UI, Electron shell, SQLite database. One Windows installer strategy (Electron Forge unless a concrete reason otherwise).
- USD and US date display. Dates persisted as `YYYY-MM-DD` with no timezone conversion; audit timestamps stored separately.
- Management reports only: never labeled GAAP statements, tax returns, cash-flow statements, or balance sheets. No tax determinations.
- No claims of encryption at rest, tax compliance, code signing, test passage, or Windows compatibility unless implemented and verified.

## 3. Features

### F1. Company profiles
Display name, optional legal name, address, phone, email, logo. Create / edit / archive. One default active company; app opens to it on launch. Switching company does not change the default. Every record stores its owning company explicitly.

### F2. Company switcher and scoping
Always-visible switcher. Lists and reports are company-scoped. **All Companies** is an explicit read-only aggregate; creating a record there requires choosing a company. A form open during a switch is never silently moved (offer save / discard / cancel).

### F3. Properties
Address fields, purchase date and price, status (**Held, Renovating, Listed, Sold**), optional description and notes.
- Historical purchases (2021 and earlier) are accepted.
- Sold requires sale date and gross sale price; sale date must not precede purchase date.
- Clearing/reopening a sale is a deliberate, confirmed action.
- A property belongs to one company; company cannot change once financial records exist (v1).

### F4. Search and filters
Partial match on address, city, ZIP; vendor and notes in their lists. Filters: company, status, purchase/sale date ranges, expense date/category/property. Paginated or virtualized; parameterized queries. Distinguish "no records" from "no matches".

### F5. Manual expenses
Company, optional property, vendor, date, category, amount, notes, receipt attachments. Property expenses inherit the property's company; general company expenses have no property. Vendor and category search. **Save** and **Save & Add Another**. Validation errors never lose entered work.

### F6. Receipts and OCR (after manual entry is complete)
Multiple local files into a review queue. Local OCR suggests vendor/date/total; rules suggest categories; David reviews before posting. Manual entry always available. Drafts and receipts are never counted as expenses until saved.

### F7. Categories and vendor rules
Company-scoped, seeded from a starter list, customizable, archivable. Starter list: Materials, Labor, Plumbing, Electrical, Permits, Utilities, Insurance, Property Taxes, Financing Interest & Fees, Maintenance, Purchase Closing Costs, Realtor Commissions, Seller Closing Costs, Other Selling Costs, Other. Each category maps to one stable **reporting group** (see §4). Vendor rules are company-scoped and created only by explicit user action.

### F8. Allocations and attachments
One expense may have several category allocation lines that sum exactly to its total. One expense belongs to at most one property in v1 (UI explains splitting a receipt across properties is not supported yet). Several receipt attachments may belong to one expense.

### F9. Analysis and data protection
Property profitability, lifetime and By Year breakdowns, company portfolio summaries, dated expense summaries, `.xlsx` export, PDF reports, backup/restore, data-preserving upgrades.

## 4. Financial contract

### Money
- Integer cents everywhere. Decimal-safe parsing. No floating-point accounting math.
- Positive expenses only in v1; negatives rejected with a helpful message. Refunds/credits, loans, payments are out of scope.

### Dates
- Each expense has an editable **expense date**, separate from created/entry timestamps.
- Year grouping uses expense date only, never upload, processing, purchase, or sale year.
- Historical expenses without receipts are accepted. OCR dates are suggestions needing review. No tax treatment, payment, or accrual dates inferred.

### Cost model
- Purchase price lives on the property. Purchase closing costs, renovation, holding/financing interest, and selling costs are **itemized expenses**. Closing costs and commissions are never stored both as a sale field and an expense.
- **Project cost** = purchase price + all posted (non-voided) property expenses.
- **Realized project profit before taxes** = gross sale price − project cost (sold properties only).
- **Project ROI** = profit / project cost; no divide-by-zero; labeled non-annualized.
- **Days held** = sale date − purchase date. Unsold: today's local calendar date, labeled "Held to date". Same-day = 0 days. Readable years/months/days via a calendar-aware library.

### Lifetime cost bridge
Purchase price → Purchase closing costs → Renovation/repairs (labor, materials, trades, permits) → Holding costs → Selling costs (realtor commissions, seller closing costs, other selling costs) → **Total project cost** → Gross sale price → **Profit before taxes**.
- Each category has exactly one stable reporting group; allocation lines contribute exactly once.
- Renaming/archiving preserves mappings; remapping is deliberate and updates reports.
- Realtor commissions are explicit dollar expense entries (optional realtor/vendor); no mandatory percentage calculator; not re-entered on the sale form.

### Property detail views
- **Lifetime** and **By Year**. By Year lists every calendar year from purchase through sale (or today), extended for any later recorded expense activity; quiet years show zero.
- Purchase price shown once, in the purchase year. Per-year: group/category subtotals, total annual expenses (excluding purchase price), annual recorded investment (purchase + expenses, labeled separately), and reconciliation to lifetime.
- Sale proceeds appear separately in the sale year, never as negative expenses.
- Year/category rows expand to dated expense records and receipts. Voided records excluded consistently.
- Annual filters never alter the prominently labeled lifetime project profit; filtered totals are labeled separately.

### Unsold, overhead, and exclusions
- Unsold: show recorded investment to date; **no** realized profit or ROI; no estimated market values.
- Company overhead (general expenses) is separate from project profit; never allocated to properties.
- Loan proceeds, principal repayments, owner contributions are excluded. "Financing" means recorded interest/fees only.

### Report bases (must be labeled explicitly)
- **Sold-period performance:** properties selected by **sale date**; includes their full lifetime costs.
- **Dated expense report:** expenses selected by **expense date**; general company expenses in a separate section.
- Reports show generated/as-of date; late-recorded expenses can change historical profit.

## 5. Reliability contract

- Foreign keys and company consistency enforced in storage/service layer, not only UI. Parameterized SQL, migrations, transactions, single-writer policy, indexes.
- Archive, don't delete, financial history. No new activity under archived companies. Default company must be replaced before archiving it.
- Posted expenses may be corrected or voided (with confirmation and lightweight change history); voided are recoverable and excluded from totals.
- Receipt files are copied into managed storage with opaque names, content hashes, validation, bounded size/pages. Moving the source file never breaks the app. No renderer file-path access. Receipt content is never executed.
- Review drafts persist across restarts; errors are retryable per receipt; completed entries can't post twice (idempotent posting tokens). OCR output is untrusted. No automatic posting.
- Backups: consistent SQLite snapshot (never a raw copy of an active WAL database), receipt files, drafts, settings, schema/app versions, manifest with checksums. Restore validates in staging, takes a pre-restore backup, and rolls back on failure. Same-disk backup is not disk-loss protection.

## 6. Security architecture requirements

Context isolation on, sandbox on, no Node in renderer, restrictive CSP, typed and validated IPC with sender and argument validation in the main process, task-specific APIs only (no raw SQL, no arbitrary filesystem, no generic IPC forwarding). User data lives in platform user-data locations, never the install directory. SQLite native bindings rebuilt for the target Electron ABI. Single-instance lock.

## 7. Exclusions (v1)

Bank integration, hosted service, mobile app, listing lookup, tax advice, formal accounting, rental management, payroll, multi-currency, cloud sync, auto-updater, LLM/remote OCR. Receipt "upload" means local file import. Supported receipt formats: JPG, PNG, PDF. Unsupported formats (e.g., HEIC) get clear guidance.

## 8. Reference fixtures (acceptance numbers)

| Fixture | Inputs | Expected |
| --- | --- | --- |
| A: Standard | Purchase $200,000; purchase closing $5,000; renovation $35,000; holding/interest $10,000; selling $18,000; sale $310,000 | Project cost $268,000; profit $42,000; ROI 15.67% |
| A-neg | + $1,000 general company expense | Property profit unchanged |
| A-split | $100 expense split $60 Materials + $40 Electrical | Counts exactly $100 |
| B: Historical | Purchase 2021-01-15 $200,000; closing $5,000 (2021); labor/materials $25,000 (2022); taxes/insurance $8,000 (2023); repairs $12,000 (2024); holding $10,000 (2025); commission $15,000 + seller closing $5,000 (2026-03-15); sold 2026-03-15 for $350,000 | Lifetime expenses $80,000; project cost $280,000; profit $70,000; ROI 25%; 1,885 days / 5 yrs 2 mos; 2021 expenses $5,000, investment $205,000; 2026 expenses $20,000 |
| C: Walkthrough | 125 Oak Drive, purchased 2025-01-15 $200,000; closing $5,000; reno $35,000; holding $10,000; selling $18,000; sold 2026-03-15 $310,000 | $268,000 cost; $42,000 profit; 15.67% ROI; 424 days |

Note: Fixture B text in the guide says "$280,000 total cost" in Prompt 9 and "project cost $280,000" in Prompt 4; sale at $350,000 − $280,000 = $70,000 profit; both agree.
