# BUILD_STATUS.md — Gable

Last updated: 2026-10-22

## Current stage

**Stage 0 — Product contract: documents written. No application code exists.** Nothing has been built, run, or tested.

## Stage tracker

| Stage | Description | Status | Owner gate |
| --- | --- | --- | --- |
| 0 | Product contract & docs | Documents written; awaiting review | Review requirements |
| 1 | Desktop foundation + packaging proof | Not started | Desktop runs; Windows path exists |
| 2 | Design system + expense screen | Not started | Visual approval |
| 3 | Companies, properties, search | Not started | |
| 4 | Manual expenses, totals | Not started | Totals reconcile |
| 5 | Receipts + OCR | Not started | Saves time |
| 6 | Dashboard, reports, exports | Not started | Exports reconcile |
| 7 | Backup, restore, migrations | Not started | Full restore works |
| 8 | QA + Windows RC | Not started | |
| 9 | Acceptance walkthrough | Not started | |

## Evidence log

| Date | Stage | Check | Command | Result | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-10-22 | 0 | Environment probe | `node -v`, `npm -v` | Node v20.18.0, npm 10.8.2 | Informational |
| 2026-10-22 | 0 | Docs created | n/a | PRODUCT, DESIGN, ARCHITECTURE, TEST_PLAN, BUILD_STATUS written | Not reviewed by owner yet |

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

## Decisions (owner)

- 2026-10-22: Product name is **Gable**.
- 2026-10-22: **Single repository:** https://github.com/igheddx/gable (empty at time of decision). `gable-frontend` and `gable-backend` repos are not used; Gable has no hosted backend (offline Electron app, per the guide).
- 2026-10-22: Owner has a Windows machine for testing. Develop on macOS; Windows is the primary target.
- Local git initialised on `main` with `origin` set to the repo above. Nothing committed or pushed yet.

## Open questions (none blocking Stage 1)

- Do you want `git init` now, and will there be a GitHub repository for Windows CI?
- Is there access to a Windows machine for later testing, or will CI be the only Windows path?
- (Resolved) Product name is Gable.

## Next steps

1. Review the five documents; request corrections with the reusable correction prompt if needed.
2. Tell Claude Code to run **Prompt 1** (desktop foundation and early packaging proof).
