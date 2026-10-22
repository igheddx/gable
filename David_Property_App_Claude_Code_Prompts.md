# David’s Property App — Claude Code Build Guide

Working product name: **Property Ledger**. This is a placeholder, not a cleared brand name.

Revision 2 — historical costs, annual property breakdowns, sales commissions, holding duration, and Mac testing.

## How to use this guide

Create a dedicated project folder on your Mac and open Claude Code there. Give Claude this entire file as context. Run Prompt 0 first, then one numbered prompt at a time. Each stage must produce working code and evidence before moving on. Review the visual checkpoint after Prompt 2. Do not ask Claude to implement the entire guide in one pass.

Build decision: proceed with the custom local app. Do not reopen build-versus-buy research or substitute a subscription service. Complete polished manual property/expense tracking and verified calculations before OCR. Receipt attachments must work without scanning.

First instruction to Claude Code: “Read this entire guide. Execute Prompt 0 only, write the requested project documents, and stop with your assumptions and next steps.”

This guide specifies the product; it is not a claim that the app has been built or tested. Windows release acceptance requires an actual Windows test, even though development happens on a Mac.

## Prompt 0 — Establish the product contract

```text
Act as a senior desktop application engineer, product designer, and QA engineer. Build Property Ledger for David, a real estate entrepreneur who purchases, renovates, and sells homes through 2–3 companies. I develop on macOS; the primary deliverable is an installable Windows desktop application. David is not technical.

Read this entire guide. Respect existing repository instructions and preserve unrelated work. Create PRODUCT.md, DESIGN.md, ARCHITECTURE.md, TEST_PLAN.md, and BUILD_STATUS.md capturing the requirements below. Implement only the stage I request. Make reasonable implementation choices and document them. Ask only when an unresolved decision would materially change the product or put existing data at risk.

PRODUCT CONTRACT
- A modern, refined, offline desktop app, with local persistent data and no login, subscription, LLM account, API key, cloud hosting, telemetry, or runtime CDN dependency.
- React + TypeScript UI, Electron desktop shell, SQLite database. Use a maintained build tool and one Windows installer strategy. Verify current compatible versions against official documentation, pin dependencies, and commit a lockfile. Prefer Electron Forge unless a concrete packaging requirement justifies another choice; do not maintain two competing pipelines.
- Keep the renderer separate from database/filesystem services. Use typed, validated IPC, context isolation, sandboxing, no renderer Node integration, and a restrictive content security policy. Expose task-specific APIs, not raw SQL, filesystem access, or arbitrary IPC forwarding. Validate sender and arguments in the privileged process. Follow current Electron security documentation.
- Put user records, receipts, OCR assets/cache as appropriate, and backups in well-defined writable locations using platform APIs. Never write user data into the installed application directory. No localStorage as the database. SQLite bindings must be packaged/rebuilt for the target Electron ABI.
- The same codebase must run on macOS for development and functional testing of real SQLite persistence, OCR, reports, and backup/restore. Document one-command development startup plus a local Mac packaging command; Windows remains the primary delivery target. Platform-specific paths and dialogs belong behind adapters.
- One desktop user. Multi-company organization, not multi-user SaaS. Shared local database with enforced company ownership. USD and US date display initially; persist date-only values as YYYY-MM-DD without timezone conversion and audit timestamps separately.

CORE FEATURES
1. Company profiles: display name, optional legal name, address, phone, email, logo. Create/edit/archive. Set one default active company. Open to the default on launch; switching company does not silently change that default. Default selection is a convenience; every record explicitly stores ownership.
2. Visible company switcher. Company-scoped lists and reports. All Companies is an explicit read-only aggregate view; adding records there requires choosing a company. Never silently move a form to another company while it is open.
3. Property records: address fields, purchase date/price, status (Held, Renovating, Listed, Sold), optional description and notes. Held supports properties owned for years without active renovation/listing. Accept historical purchases, including 2021 and earlier, without current-year restrictions. Sale date and gross sale price required when Sold; clearing/reopening a sale is a deliberate confirmed action. A property belongs to one company. Prevent changing company once financial records exist in v1.
4. Search partial address, city, ZIP and vendor/notes in their respective lists. Filters: company, status, purchase/sale date ranges, expense date/category/property. Paginated or virtualized results; parameterized database queries.
5. Manual expenses: company, optional property, vendor, date, category, amount, notes, receipt attachments. Property expenses inherit company. General company expenses have no property. Searchable vendors and categories; Save and Save & Add Another. Never lose entered work after a validation error.
6. Multiple receipts imported from local files into a review queue. OCR suggests vendor/date/total; rules suggest categories; David reviews before posting. Support manual entry when OCR fails. Receipts and drafts must never count as posted expenses until saved.
7. Categories are company-scoped, seeded from a common starter list, customizable, and archivable. Vendor rules are company-scoped and created only by explicit user action. The starter list: Materials, Labor, Plumbing, Electrical, Permits, Utilities, Insurance, Property Taxes, Financing Interest & Fees, Maintenance, Purchase Closing Costs, Realtor Commissions, Seller Closing Costs, Other Selling Costs, Other. These are management categories, not tax determinations.
8. One expense may have multiple category allocation lines. Its allocations must sum exactly to its total. One expense belongs to at most one property in v1. Explain that splitting one receipt across properties is not supported yet. Allow several receipt attachments to one expense, so multi-page invoices do not become duplicate expenses.
9. Property profitability, lifetime and year-by-year property breakdowns, company portfolio summaries, dated expense summaries, Excel workbook export, PDF reports, backup/restore, and data-preserving upgrades.

FINANCIAL CONTRACT
- Store money in integer cents. Parse currency strings with decimal-safe logic; no floating-point accounting calculations. Validate ranges. Allow positive expenses initially; refunds/credits, loans, and payments are outside v1. Reject negative amounts with a helpful message.
- Every expense has an editable expense date, separate from its created/entry timestamp. Financial year grouping uses the expense date, never the upload, processing, purchase or sale year. Accept historical manual expenses without receipts. OCR dates are suggestions requiring review. Do not infer tax treatment or invent payment/accrual dates.
- Purchase price is stored on the property; purchase closing costs, renovation, holding/financing interest and sale costs are itemized expenses. Do not store the same closing costs/commissions in a sale field and as an expense.
- Project cost = purchase price + all posted property expenses. Realized project profit before taxes = gross sale price − project cost, for sold properties only. Project ROI = profit / project cost, with no divide-by-zero and clearly labeled non-annualized return. Days held = sale date − purchase date; unsold properties use today's local calendar date and say Held to date.
- Present a clear lifetime cost bridge: Purchase price; Purchase closing costs; Renovation/repairs (labor, materials, trades, permits); Holding costs; Selling costs (realtor commissions, seller closing costs, other selling costs); Total project cost; Gross sale price; Profit before taxes. Each expense category has one stable reporting group; category allocation lines contribute exactly once. Renaming/archiving preserves mappings; remapping is deliberate and updates reports. Realtor commissions are explicit dollar expense entries with optional realtor/vendor details; no mandatory percentage calculator. Do not enter them a second time on the sale form.
- Property detail includes Lifetime and By Year views. By Year shows each calendar year from purchase through sale or today, extended for any later recorded expense activity. Show purchase price once in purchase year, expense-category/group subtotals, total annual expenses, and annual recorded investment (purchase plus expenses), with lifetime reconciliation. Show quiet years with zero activity. Sale proceeds appear separately in sale year, never as negative expenses. Expand year/category rows to dated expense records and receipts. Exclude voided records consistently. Annual expense totals exclude purchase price; annual investment is labeled separately. Annual filters do not alter the prominently labeled lifetime project profit; filtered totals are separate.
- Show exact calendar days held plus readable calendar years/months/days, using a calendar-aware library rather than days divided by 365. Sold duration stops at sale date; unsold says Held to date and uses today's local calendar date. Same-day holding is zero days. Test leap years, month ends, daylight-saving transitions and midnight refresh; reject sale before purchase.
- Unsold property: show recorded investment to date, no realized profit or ROI. No estimated market values in v1. Company overhead remains separate from individual project profit; do not invent allocations to properties.
- A sold-period performance report selects properties by sale date and includes their lifetime costs, even when incurred outside the chosen period. A dated expense report selects expenses by expense date. Label these different bases explicitly. Company general expenses in a period appear as a separate section and are not silently mixed into lifetime property returns.
- These are management reports. Do not label them GAAP financial statements, tax returns, cash-flow statements, or balance sheets. V1 does not track the complete accounts needed for those. Loan proceeds/principal repayments and owner contributions are excluded from expenses and profit calculations. Financing means recorded interest/fees, not principal.

RELIABILITY CONTRACT
- Foreign keys and company consistency enforced in storage/services, not only UI. Parameterized SQL, migrations, transactions, a single-writer policy, and sensible indexes.
- Archive company/category/property records instead of deleting financial history. Referenced archived values remain readable. Do not allow new activity under archived companies. Require default replacement before archiving the default company. Allow correcting/voiding posted expenses with confirmation and a lightweight change history; voided expenses stay recoverable and are excluded from totals.
- Imported files are copied into managed storage. Moving the original source file must not break the app. Use opaque internal filenames, content hashes, file validation, bounded sizes/pages, and safe preview handling. No arbitrary file access through renderer paths. Never execute receipt content.
- Persist review drafts across restarts; reset/retry errors per receipt; completed review entries cannot be posted twice. OCR output is untrusted data. No automatic financial posting.
- Backups include a consistent SQLite snapshot, referenced receipt files, settings, schema/app versions, and a manifest with checksums. Never just copy an active SQLite file and ignore WAL state. Restore validates into staging before replacing anything, creates a pre-restore backup, and can roll back on failure. External backup destination selection is available. A backup on the same disk is not protection from disk loss.
- Do not claim encryption at rest, tax compliance, code signing, test passage, or Windows compatibility unless implemented and verified.

EXCLUSIONS
No bank integration, hosted service, mobile app, property listing lookup, tax advice engine, formal accounting suite, rental management, payroll, multi-currency, cloud sync, or auto-updater in v1. Receipt upload means local file import, not a remote upload. JPG, PNG and PDF are supported in the receipt stage. Give clear guidance for unsupported formats such as HEIC until implemented.

First produce the five documents, an implementation sequence matching this guide, and a short list of assumptions. Do not implement the app yet. Record staged acceptance criteria and evidence in BUILD_STATUS.md throughout this project.
```

## Prompt 1 — Desktop foundation and early packaging proof

```text
Read PRODUCT.md and the build guide. Implement the desktop foundation only.

Set up React/TypeScript/Electron, typed secure preload APIs, SQLite migrations, local data paths, validation, lint/typecheck/test scripts, and a minimal window. Verify/document one-command Mac development startup and a local Mac package command. Test real Electron services rather than only a browser mock. Add a repository/service boundary so UI code cannot reach SQL or filesystem directly. Add a realistic development fixture in a separate demo database; never seed fictional data into production automatically. Use an application single-instance lock.

Establish Windows packaging now: a reproducible Windows CI workflow that installs locked dependencies, tests, rebuilds native dependencies for Electron, and produces an installer artifact. Start with x64. Document whether ARM64 is supported or untested. Development can run on Mac, but do not pretend a Mac run validates Windows. Explain any hosted CI account/repository requirement; provide a local Windows build alternative. Do not push, publish releases, or purchase signing services without instruction.

Acceptance: app opens on Mac; an empty SQLite database initializes and reopens without losing data; malformed IPC payloads are rejected; renderer cannot use arbitrary filesystem/SQL APIs; CI configuration and packaging are established. Run the checks available here and mark unavailable platform checks pending. No elaborate UI yet. Update BUILD_STATUS.md with commands, actual outcomes, and blockers.
```

## Prompt 2 — Design system and polished expense screen

```text
Read DESIGN.md. Act as the product's UI/UX designer. Implement a deliberate visual system and a polished expense-entry/receipt-review vertical slice with fixture data before broad feature implementation.

VISUAL DIRECTION
Warm architectural finance: composed, precise, premium, understated. Core palette: deep ink #182724, warm ivory #F7F5F0, muted brass #A78348. White panels and neutral dividers support these. Brass is a restrained accent, not default small text on ivory; verify contrast and use darker variants where needed. Red/green are semantic only; never communicate solely through color.

Use locally bundled, appropriately licensed fonts: a readable modern sans for UI and a restrained serif for a few major page headings if it improves the composition. Tabular numerals for money. No remote fonts. Define token scales for typography, spacing, radius, elevation, focus, motion, and semantic colors. Aim for 40–44px controls, 6–10px radii, subtle borders, minimal shadow, and generous spacing. Avoid pill-shaped everything, random gradients, emoji, sparkle icons, excessive cards, giant dashboard tiles, icon-only primary actions, and stock component-library styling. Use one consistent line-icon family sparingly. Accessible primitives are welcome; style them to this system.

APP SHELL
Refined left navigation: Overview, Properties, Expenses, Reports; Settings near the bottom. Persistent visible company selector. Main area has a clear page title, small contextual text, and one primary action. Support usable Windows layouts at 1280×800, 1366×768, and 1920×1080 and 125–150% scaling without clipped forms. Condense panes at smaller widths. Do not require a giant screen.

HERO WORKFLOW
Expense entry: company/property context, vendor, date, category, amount; optional details disclosed cleanly; receipt drop zone. Property preselected when opened from a property. Save and Save & Add Another, natural tab order, inline validation, visible labels, focus management, and unsaved-changes handling.
Receipt review: compact queue with readable status, large receipt preview alongside editable form. Show suggested values as Needs review, never Verified. Provide zoom/rotate, retry, skip, manual entry, and Next receipt. At smaller widths use an intentional stacked view or preview toggle. Multi-category allocation editor shows remaining amount and exact sum validation.

Build reusable components for buttons, inputs, currency/date fields, searchable selects, tables, filters, badges, dialogs, toasts, empty states, error states, and receipt review. Include a development-only component showcase. Implement keyboard operation, visible focus, reduced motion, and accessible labels/errors/dialog behavior.

Use clearly labeled fictional fixture data for 3 companies and several properties. Capture screenshots of expense entry, receipt review, property list, and component states at small and large target sizes using available tooling. Inspect them and correct alignment, contrast, density, truncation, and scrolling issues. Do not claim visual inspection if tooling is unavailable; give a reproducible review procedure. Update DESIGN.md and BUILD_STATUS.md.

Stop after this visual milestone so I can review it. Other screens may be intentionally incomplete, but no button should falsely appear functional. Do not build all business features before I have reviewed this screen.
```

## Prompt 3 — Companies, properties, and search

```text
Implement company profiles, default-company behavior, property CRUD/archive, and search using the approved design system and real SQLite persistence.

Add first-run setup to create the first company and then the first property. Do not require optional profile fields, a logo, or sensitive tax identifiers. Add a company default setting and persistent switcher. All Companies shows grouped/identified results and requires explicit company choice before writes. Keep company context consistent across lists, dashboard, forms, and reports. On switching with unsaved work, offer save/discard/cancel; never reassign it silently.

Property detail should show address, status, purchase and sale information, lifetime cost bridge, exact days held/readable duration, Lifetime and By Year views, and expenses, with Add Expense and Add Receipts in context. Sale information must meet PRODUCT.md validation. Render missing values as unavailable, not fabricated zeros/profits. Preserve historical data when archiving. Filters/search must work together and reset predictably; distinguish no records from no matches. Debounce searches and index appropriate fields. Handle punctuation, apostrophes, partial ZIP/address matches and sorting. Company-filtered queries must never leak other company records.

Test: create 3 companies, default one, restart, switch, create/search/edit/archive properties, and confirm ownership in both database services and UI. Reject cross-company references and archiving an unresolved default. Test invalid sale dates/prices and pending forms during company switch. Use a separate test database. Update stage evidence.
```

## Prompt 4 — Fast manual expenses and trustworthy totals

```text
Implement manual expenses, general company expenses, vendor reuse, company-scoped category management, allocation splits, receipt attachment storage, edit/void history, and property calculations. Keep the approved UI styling.

Save & Add Another retains company, property, and date, clears amount/notes/receipts and other expense-specific values, and places focus sensibly. Vendor suggestions are company-scoped. Entering a vendor does not silently create a category rule. Archive categories without breaking history. Reassigning an expense's property must stay inside its company. Use transactions for headers, allocations, and attachment metadata; handle filesystem failures with staging/cleanup so no saved record falsely promises a missing receipt.

Provide exact allocation validation and a one-category default path. Prevent double-click saves and repeat submissions; database-level idempotency as well as UI disabling. Confirm voids and keep an event history. Recalculate all views after edits, voids, and unvoids, not just on app restart.

Implement the year-by-year property expense breakdown and lifetime cost bridge in PRODUCT.md. Historical entry must be as easy as current entry; no receipt or opening-balance shortcut is required. Provide separate Realtor Commissions, Seller Closing Costs and Other Selling Costs categories. Purchase price appears once outside expense totals; allocation lines drive group/year subtotals without multiplying expense headers.

Verify this independent fixture: purchase $200,000; purchase closing $5,000; renovation $35,000; holding/interest $10,000; selling costs $18,000; sale $310,000. Total project cost must be $268,000; realized project profit before taxes $42,000; ROI displays 15.67%. A $1,000 general company expense must not change that property's profit. Splitting a $100 expense into $60 Materials + $40 Electrical must count exactly $100 in the total. Repeated attachment pages do not create repeated costs.

Also verify a separate historical fixture: purchase January 15, 2021 for $200,000; purchase closing $5,000 in 2021; labor/materials $25,000 in 2022; taxes/insurance $8,000 in 2023; repairs $12,000 in 2024; holding costs $10,000 in 2025; realtor commission $15,000 and seller closing costs $5,000 on March 15, 2026; sold March 15, 2026 for $350,000. Lifetime expenses $80,000; project cost $280,000; profit $70,000; ROI 25%; held 1,885 days / 5 years 2 months. 2021 expenses are $5,000 and investment is $205,000. 2026 expenses are $20,000. Enter a 2022-dated cost during 2026 and confirm it belongs to 2022. Edit the date to another year and confirm annual totals move while lifetime cost is unchanged. Keep fixture scenarios isolated so added test expenses do not invalidate expected totals.

Test cents, rounding display, zero-cost ROI, unsold properties, malformed currency, missing required fields, expense edits/voids, company mismatch rejection, attachment survival after original source removal, and restart persistence. Update build evidence.
```

## Prompt 5 — Multiple receipts and local OCR

```text
Implement receipt intake and review. Use Tesseract.js or a documented equivalent local OCR solution. No LLM, remote OCR, runtime CDN, or language-pack download. Bundle required worker/WASM/language files and test offline from the packaged application. Keep OCR off the UI thread, with bounded concurrency, cancellation and per-file progress.

Support JPG, PNG and PDF. For PDFs, extract an existing text layer when useful; render scanned pages locally for OCR. Do not pass PDFs directly to an image-only OCR engine. A multipage PDF is one document/expense draft by default, not one expense per page. Let David group selected images as pages of one receipt or split documents deliberately. Document supported sizes/page limits in the UI. Report unsupported, encrypted, corrupt or oversized files individually without stopping other files.

Import from a property, a company, or global Expenses. In All Companies require an explicit company assignment before posting. Persist company/property context in each draft; no guessing ownership from the company currently selected later. Review table shows file, vendor, date, total, category, property, and status. Allow individual save or Save All Reviewed; only user-reviewed valid drafts qualify. Partial batch success must identify exactly what saved/failed and permit safe retry without duplicates.

OCR produces editable suggestions. Parse candidates for vendor, transaction date and total using transparent rules. Prefer labeled totals over subtotal, tax, cash tendered, or change. Ambiguous dates/totals remain unconfirmed. Keep raw recognized text available in a secondary view. Never use OCR confidence as proof a financial field is correct.

Category rules: explicit vendor rule first, keyword suggestion second, otherwise Select category. Label source such as Based on your vendor rule. Scope rules by company, normalize vendors carefully, allow override/edit/remove, and avoid fuzzy vendor matches silently creating deterministic rules. Home improvement stores may sell mixed categories; support manual allocation splits. Optional Remember this vendor category is unchecked until the user chooses it. No automatic per-line item extraction in v1.

Detect identical receipt files by hash and flag possible vendor/date/amount duplicates within the company. Warn and show the existing record, but permit an explicit override because genuine purchases can match. Use stable draft IDs and posting tokens so retry cannot post twice. OCR retries must not overwrite user-corrected fields without consent. Preserve drafts/attachments through app restarts and recover interrupted jobs.

Create clearly synthetic, visually different receipt fixtures: clean, rotated, poor-quality, ambiguous total, multi-page PDF, digital PDF, invalid file, duplicate file, and one unsupported format. Test a 20-document batch, mixed failure/success, restart mid-review, user corrections, splits, and offline packaged OCR. Measure actual performance instead of promising a fixed speed or extraction accuracy. Manual entry must always remain usable. Update evidence and limitations.
```

## Prompt 6 — Dashboard, reports, Excel and PDF

```text
Implement dashboard and management reports using one shared calculation/query layer so screens and exports reconcile.

Overview: active property count, investment recorded for unsold properties, realized profit for properties sold in the selected period, and general company expenses for that period as separate labeled figures. Add a restrained recent-activity table. Avoid charts that mix incompatible time bases, implied cash balances or invented trends. Company is always visible; All Companies identifies company subtotals and is an aggregation, not formal consolidation accounting.

Reports:
1. Individual property profitability: company, address/status, purchase/sale facts, purchase price, expense-category subtotals, itemized expenses, project cost, realized profit/ROI when sold, exact days held and readable duration. Include an annual breakdown with purchase price separated from expenses, category/group subtotals, commissions and closing costs individually visible, sale proceeds separately, and a lifetime reconciliation. Keep the same structure in property detail and exports.
2. Sold-property performance for a sale-date range: all lifetime costs for each selected sold property, even expenses from earlier years. Show its sale-date basis.
3. Expense activity for an expense-date range: by category and property, with general company expenses separately identified. Show its expense-date basis.
4. Current portfolio snapshot: unsold investment recorded and sold results clearly separated.

Provide explicit date filters and as-of/generated date. Never call these formal financial statements or cash-flow reports. Expenses recorded after sale can change historical project profit; report output must show generated/as-of context and latest recorded data.

Export real .xlsx workbooks with Summary, Properties, Expenses, Allocations and Property By Year as appropriate; numeric currency cells, dates, readable column widths, filters, frozen headers, and basis/company metadata. Escape or write user text safely as text to prevent spreadsheet formula injection. Do not call a CSV an Excel workbook. Export PDF using locally generated print layouts: company branding, report basis and filters, page numbers, repeating headers, legible amounts, no clipped columns and no dependence on network fonts. Export files via native save dialogs and give useful failure messages. Receipts remain linked in the app; exports should not leak internal filesystem paths.

Test against the 2021–2026 historical fixture plus independent fixtures spanning two calendar years and three companies. Reconcile every dashboard/report/export total with database calculations. Open exported workbook programmatically and inspect cell types/values; render or inspect representative PDFs. Include long addresses, many rows, empty reports, voided expenses, split allocations, negative profit, and cross-period expenses. Update evidence.
```

## Prompt 7 — Backups, restore, migrations and recovery

```text
Implement complete data protection before a release candidate.

Use a supported consistent SQLite snapshot mechanism. Back up the database, managed receipt files and persisted drafts/settings with a versioned manifest/checksums. Serialize or pause mutations while capturing a consistent snapshot of DB plus attachments. Support manual backup, configurable external destination, a daily automatic backup when the app is running/next opens, last successful backup display, and documented retention. A failed backup must never count as success or delete good copies. Do not imply scheduled work runs while the app is closed.

Restore is deliberate replacement of the entire local dataset, including all companies, not a merge. Explain this before confirmation. Validate schema compatibility, checksums, complete attachment references and safe archive paths in staging. Reject path traversal, corrupted/incomplete archives and incompatible future schemas. Create a pre-restore backup, replace safely with recovery/rollback, and reopen correctly. Handle low disk space and permissions. Protect backups containing financial data; do not claim encryption unless implemented. Retain pre-upgrade backups and migrate transactionally.

End-to-end verification: create multiple companies, property records, posted/split expenses and receipt drafts; back up; restore into a fresh test profile; verify record totals, default company, attachments, drafts and rules. Fail/cancel restore mid-flow and prove original data remains usable. Restore an older supported schema and upgrade it. Test database busy and missing attachments with actionable recovery states. Never use my actual data for destructive tests. Update evidence.
```

## Prompt 8 — Product QA and Windows release candidate

```text
Audit and fix the complete app against PRODUCT.md, DESIGN.md and TEST_PLAN.md. This stage produces a Windows release candidate, not just a browser preview.

Run meaningful unit/integration tests for money, reporting bases, company consistency, expense/draft posting transactions, duplicate handling, OCR parsing, backup/restore and migrations. Add end-to-end Electron coverage for David's core workflows. Use isolated data directories. Avoid tests that simply mirror implementation or assert incidental CSS details.

Perform an actual UI review of company setup, property search, manual expense entry, batch review, error states and reports. Check keyboard-only use, focus, zoom/scaling, contrast, long data, reduced motion and Windows window behavior. Capture evidence for small/large target sizes. Compare against the approved visual milestone and correct design drift.

Build the Windows installer on Windows CI or a Windows machine. Test on a clean supported Windows environment without developer tools, Node, Python, SQLite, Office, or an LLM account. Select and document the supported Windows versions based on current Electron support; do not promise obsolete OS compatibility. Test a standard non-admin account, offline first launch and OCR, Unicode/space-containing paths, local file dialogs, report exports, restart persistence, backups and error recovery. Validate packaged native modules and worker/WASM resources, not merely development mode.

Test upgrade over an older test build with real fixture data: records, receipts and settings survive. Document uninstall behavior and ensure it does not silently wipe data. Include app version in Settings and a support diagnostics export that excludes receipt contents and financial data by default. Provide Windows taskbar/desktop icons designed for the app, using original vector artwork consistent with the palette and packaged icon assets. No emoji app icon.

Code signing may require credentials/cost; never invent them or disable Windows protections. Distinguish unsigned pilot installer from a signed distribution. If unsigned, document expected publisher warnings and remaining release work truthfully. Do not publish or distribute externally without instruction.

Produce RELEASE_CHECKLIST.md, USER_GUIDE.md and a release artifact location. Status each check PASS / FAIL / NOT RUN with actual evidence. No Windows environment means Windows validation remains NOT RUN and the app must not be called release-ready. Fix failures you can reproduce; report precise blockers for the rest.
```

## Prompt 9 — David's acceptance walkthrough and final fixes

```text
Prepare and, where tooling permits, run this acceptance walkthrough on the installed Windows release candidate using fictional data. Preserve real data and keep the demo profile distinct.

1. Create Oak House LLC, Cedar Homes LLC and North Property LLC. Make Cedar the default. Restart: Cedar opens. Switch to Oak: default still remains Cedar.
2. Under Oak add 125 Oak Drive, purchased January 15, 2025 for $200,000. Under Cedar add a different property containing Oak in its address. Search Oak within each company, then All Companies. Results are correctly scoped and labeled.
3. For 125 Oak Drive enter $5,000 purchase closing, $35,000 renovation, $10,000 holding/interest and $18,000 selling expenses. Mark sold March 15, 2026 for $310,000. Confirm $268,000 project cost, $42,000 profit, 15.67% ROI, 424 days held. Include some expenses in 2025 and some in 2026.
4. Add $1,000 Oak general company overhead. It appears separately and does not change that property's profit. Add an unsold property and confirm no realized profit/ROI is shown.
5. Import several receipt files. Correct a suggested total, create a $60/$40 allocation on a separate $100 test receipt, leave one unreviewed, and save the reviewed set. Only reviewed expenses post. Reimport a duplicate and confirm warning. Retry a completed save and confirm no duplicate expense.
6. Start a new receipt draft, close/reopen and resume it. Move the original source receipt and confirm the managed attachment still opens. Attempt a cross-company property assignment and confirm rejection.
7. Export 2026 sold-property performance: the sold property includes its 2025 lifetime costs. Export a 2026 expense activity report: only 2026 expense dates are included. Explain why these reports differ. Verify workbook/PDF totals match their respective screen values.
8. Add a separate historical property using Prompt 4's 2021–2026 fixture. Before recording its sale, set status Held: show investment and Held to date but no realized profit/ROI. Then record the March 15, 2026 sale: confirm $280,000 total cost, $70,000 profit, 25% ROI, 1,885 days / 5 years 2 months. Expand each annual breakdown and verify commissions separately. Its 2026 expense activity is $20,000; 2026 sold-property performance includes all lifetime costs. Confirm these values also in exports.
9. Back up, restore into a fresh isolated profile, and verify all companies, totals, attachments, settings, rules and pending drafts. Upgrade that restored test installation and confirm preservation.

Produce a concise ACCEPTANCE_RESULTS.md with actual results and screenshots/paths where available, then fix reproducible failures. Write a one-page plain-English handoff for David: install, create company, add property, enter expense, review receipts, run report, back up and request support. List any unfinished checks explicitly. Keep core product terminology clear; do not show David implementation details such as SQLite or IPC in normal screens.
```

## Reusable correction prompt

Use this when a stage misses the mark; insert specific observations.

```text
Review the latest implementation against PRODUCT.md and DESIGN.md. Problems observed: [insert exact issues]. Reproduce each issue, identify its underlying cause, implement a focused correction and run appropriate checks. Preserve unrelated work and existing data. Do not add features or redesign approved screens without a reason. For visual problems provide updated screenshots at the same size; for data/calculation problems show the before/after result using a small fixture. Update BUILD_STATUS.md with actual evidence and remaining limitations.
```

## Product owner review gates

| Gate | What you should inspect |
| --- | --- |
| After 0 | Requirements match David's workflow; agree on management reports versus full accounting |
| After 1 | Desktop app runs; Windows build path exists |
| After 2 | Expense entry feels polished and easy; palette/type/spacing approved |
| After 4 | Manual tracking works without OCR; annual/lifetime costs, commissions and holding duration reconcile |
| After 5 | Receipt review saves time even when extraction needs correction |
| After 6 | Reports answer David's questions; exports reconcile |
| After 7 | A full restore works, including receipts |
| After 8–9 | Installed Windows app passes the real acceptance walkthrough |

## Technical references for implementation

Verify current documentation and dependency compatibility while implementing; do not blindly copy version-specific snippets.

- Electron security: https://www.electronjs.org/docs/latest/tutorial/security/
- Electron packaging: https://www.electronjs.org/docs/latest/tutorial/application-distribution
- Electron Forge build lifecycle: https://www.electronforge.io/core-concepts/build-lifecycle
- Tesseract.js local installation: https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md
- Tesseract.js PDF limitations/FAQ: https://github.com/naptha/tesseract.js/blob/master/docs/faq.md
- SQLite consistent backup: https://www.sqlite.org/backup.html

The essential boundary: OCR extracts text; deterministic rules suggest fields and categories; David confirms the financial record. The essential delivery boundary: working on Mac is a development milestone; an installed and tested Windows build is the deliverable.
