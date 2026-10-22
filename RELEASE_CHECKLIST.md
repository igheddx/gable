# Gable release checklist

Status values are PASS, FAIL or NOT RUN, with evidence. **Gable is NOT release-ready.** The Windows checks below have not been run on a real, clean Windows machine.

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Typecheck and lint | PASS (macOS) | `npm run typecheck`, `npm run lint` |
| 2 | Unit and integration tests | PASS (macOS): 239 tests | `npm test` |
| 3 | Packaged-app end-to-end tests, macOS | PASS in the last full run (44/44), but flaky: see check 4 | `npm run test:e2e` |
| 4 | Receipt reader starts reliably on relaunch | FAIL (intermittent) | About 2 in 8 isolated runs of the restart test stall; cause not found (BUILD_STATUS.md, open issue) |
| 5 | Windows CI: tests, packaged tests, installer build | PASS on the latest commit `57ab498` for all stages, Windows and macOS (one run; earlier runs failed on the reader issue, so this is not yet proof of stability) | GitHub Actions |
| 6 | Installer runs on a clean Windows machine (no dev tools) | NOT RUN | |
| 7 | Standard (non-admin) account install and run | NOT RUN | |
| 8 | Offline first launch and OCR on Windows | NOT RUN | |
| 9 | Unicode and space-containing paths on Windows | NOT RUN | |
| 10 | Native dialogs (logo, receipts, save, backup folder) on Windows | NOT RUN | tests bypass dialogs with env hooks |
| 11 | Report export (Excel opens in Excel, PDF in a PDF viewer) | PASS in tests (read back with ExcelJS and pdf.js); not opened in Excel itself | |
| 12 | Backup and restore on a real install, including restart | PARTLY: unit-tested thoroughly; packaged restore flow tests written, last run not confirmed | |
| 13 | Upgrade over an older build keeps data | PARTLY: older-schema restore and upgrade tested; no older installer exists to test against | |
| 14 | Uninstall does not wipe data | NOT RUN (data lives in the user data folder, outside the install folder, by design) | |
| 15 | App version shown in Settings | NOT DONE | |
| 16 | Support diagnostics export (no financial data) | NOT DONE (a support log exists; no export screen) | |
| 17 | App icon (original artwork) packaged | PASS (macOS build); Windows icon not seen | `resources/icon.*` |
| 18 | Keyboard-only, focus, 150% scaling, contrast review | PARTLY: automated keyboard flows and screenshots at 5 sizes; no manual screen-reader pass | `docs/screenshots` (regenerate with `npm run screenshots`) |
| 19 | Code signing | NOT DONE. The installer is unsigned; Windows will show an "unknown publisher" warning | |
| 20 | Supported Windows versions documented | NOT DONE (follow current Electron support; not yet written down) | |

## Before calling it release-ready

1. Fix or explain check 4 and get several consecutive green CI runs on Windows and macOS.
2. Run checks 6–10, 14 on a clean Windows machine and record the results.
3. Add the version display and the diagnostics export (15, 16).
4. Decide on code signing (19), or accept and document the warning for a small pilot.
5. Write the supported Windows versions (20) from current Electron documentation.
