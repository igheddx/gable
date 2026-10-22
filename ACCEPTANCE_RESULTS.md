# Acceptance walkthrough: results so far

The walkthrough has **not** been run on an installed Windows release candidate: there is no tested Windows install yet. What follows is what automated tests on the macOS packaged app and unit tests cover for each step. "Covered" does not mean a person did it.

| Step | What it checks | Result |
| --- | --- | --- |
| 1 | Three companies, Cedar default, restart opens Cedar, switching to Oak leaves the default | Covered (macOS packaged e2e) |
| 2 | 125 Oak Drive and a "Oak Hollow" property; search scoped per company and in All Companies | Covered (e2e) |
| 3 | $268,000 cost, $42,000 profit, 15.67%, 424 days, expenses in 2025 and 2026 | Covered (unit and e2e) |
| 4 | $1,000 overhead appears separately and does not change profit; an unsold property shows no profit or ROI | Covered (unit and e2e) |
| 5 | Import receipts, correct a total, $60/$40 split, leave one unreviewed, save the reviewed set, duplicate warning, retry creates no duplicate | Covered (unit and e2e); the 20-document batch used a stand-in reader in unit tests and 8 real files in e2e |
| 6 | Resume a draft after closing; managed attachment survives deleting the original; cross-company assignment rejected | Covered. The restart test is the one that intermittently stalls (see below) |
| 7 | 2026 sold-performance and expense-activity exports; totals match screen | Covered (Excel and PDF read back in e2e). Opening them in Excel itself and a human PDF review are NOT RUN |
| 8 | Historical 2021 to 2026 property: $280,000 cost, $70,000 profit, 25%, 1,885 days / 5 years 2 months, annual breakdown, commissions separate | Covered (unit and e2e) |
| 9 | Back up, restore into a fresh profile, upgrade | Covered in unit tests; packaged restore test written, last full pass not confirmed |

## Open problems found

- **Intermittent reader stall** (release checklist item 4): about 2 in 8 runs of the "drafts survive restart" test never get a receipt read after the second launch. A process sample showed Gable's main thread idle and timers not firing. Not caused by launching the app again quickly, and not fixed by launching readers one at a time. Cause unknown.
- Windows has had no manual testing at all.
- Version display and the support-diagnostics export are not built.

## For David (plain English)

The `USER_GUIDE.md` file covers how to install, create a company, add a property, enter an expense, review receipts, run a report, back up and ask for help. It was written from the app as it exists, but no one has yet followed it on an installed copy. Do not give Gable to David until the Windows checks in `RELEASE_CHECKLIST.md` have been run.
