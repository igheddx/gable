# Gable

Offline desktop app for tracking real estate projects (properties, expenses, receipts, reports) across several companies. Electron + React + TypeScript + SQLite. Windows is the primary target; macOS is used for development.

See `PRODUCT.md`, `DESIGN.md`, `ARCHITECTURE.md`, `TEST_PLAN.md` and `BUILD_STATUS.md`. The build guide is `David_Property_App_Claude_Code_Prompts.md`.

## Requirements

Node 22.13 or newer (`.nvmrc` pins 22). With nvm: `nvm install && nvm use`.

## Commands

| Command | What it does |
| --- | --- |
| `npm ci` | Install locked dependencies |
| `npm run dev` | Start the app in development (data in `.dev-data/default`, never your real data) |
| `npm run dev:demo` | Build the fictional demo database in `.dev-data/demo` and start the app on it |
| `npm run typecheck` / `npm run lint` | Static checks (lint also enforces that UI code cannot import Node, SQL or services) |
| `npm test` | Unit and integration tests (real SQLite in temp folders) |
| `npm run package:mac` | Local macOS package in `out/` |
| `npm run test:e2e` | Packages the app and runs Playwright tests against the packaged build with isolated data |
| `npm run make:win` | Windows x64 installer (must be run on Windows) |

Environment: `GABLE_DATA_DIR=<folder>` overrides where Gable keeps its data (tests and demo use this).

## Windows build

Preferred: GitHub Actions (`.github/workflows/ci.yml`) runs the checks, the packaged-app tests and `make:win` on `windows-latest`, and uploads the installer as an artifact. Local alternative on a Windows PC with Node 22.13+:

```
npm ci
npm run test:e2e
npm run make:win
```

The installer is written to `out\make\squirrel.windows\x64\`. It is unsigned (Windows will show an "unknown publisher" warning). ARM64 is untested.

## Where data lives

Packaged app: the per-user application data folder (`%APPDATA%\Gable\data` on Windows, `~/Library/Application Support/Gable/data` on macOS). Never in the install folder.
