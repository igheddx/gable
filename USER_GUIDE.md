# Gable: user guide

Gable keeps track of your properties, what you spend on them, and what you make when you sell. Everything stays on your computer. There is no account and nothing is sent anywhere.

## First time

1. Open Gable. It asks for your company name. That is the only thing required.
2. Add your first property (or skip it). Enter the address, purchase date and purchase price. Properties bought years ago are fine.

## Your companies

- The box at the top left switches company. **All Companies** shows everything together but is view-only: pick one company to add anything.
- Settings → Companies lets you add companies, choose the **default** (the one Gable opens to) and archive a company. Archiving hides it and keeps all its records; you can restore it.

## Adding an asset

**Assets** → **Add asset**, then choose what you are adding:
- **Renovation**: a house you buy, fix up and sell. Address, purchase date and price. Status is Held, Renovating, Listed or Sold. Marking it Sold asks for the sale date and the **gross** sale price. Enter commissions and closing costs as expenses, not here, so they are never counted twice.
- **Rental**: a property you rent out. Address; the purchase date and price are optional. You record **income** (rent and so on) and expenses, and Gable shows **net income**.
- **Vehicle**: a car or anything you buy, prepare and sell. A name (such as "2018 Honda Accord") and an optional VIN or ID instead of an address. It works like a renovation: purchase, expenses, sale, profit and return.
- Anything else you add yourself under **Settings → Business types** (for example Boats or Equipment, or an ongoing business like a car wash).

Type dates as digits only (for example `01152026`); Gable adds the slashes. What kind of asset it is cannot be changed afterwards.

## Income (rentals and ongoing businesses)

**Income** in the sidebar, or **Add income** on a rental's page. Choose the rental or business, the date received, the amount and the type (Rent, Late fees and so on). A mistake is **voided**, never deleted, and stops counting; you can restore it. Expenses for a rental are entered the normal way (Expenses, or **Add expense** on its page). Rental money is shown separately from the profit on things you sold; Gable never adds the two together.

## Entering an expense

Expenses → **Add expense** (or **Add expense** on a property's page).

- Choose the property (or leave it blank for company overhead), the vendor, the date, the amount and a category.
- The **date of the expense** decides which year it counts in, so enter old expenses with their real dates. No receipt is needed.
- **Split across several categories** lets one receipt cover, for example, $60 materials and $40 electrical. The amounts must add up exactly.
- **Save & add another** keeps the company, property and date so you can enter several in a row.
- To correct an expense, open it from the list. **Void** removes it from every total but keeps it on record, and you can restore it.

## Receipts

Expenses → **Review receipts** → **Add receipts**. Choose photos or PDFs (JPG, PNG, PDF; up to 25 MB each; PDFs up to 30 pages). Gable reads them on your computer and suggests the vendor, date and total. **Always check them**: the reader can be wrong. Suggestions are marked *Needs review* until you change or accept them.

- Pages of one receipt can be combined; a PDF is always one receipt.
- If two amounts look like the total, Gable shows both and you choose.
- **Save expense** saves one receipt. **Mark reviewed** then **Save all reviewed** saves several. Receipts you have not reviewed stay in the queue.
- A receipt that looks like one you already saved shows a warning. If it really is a different purchase, tick the box to save it.
- A receipt that cannot be read can always be entered by hand.

## What each asset shows

On a renovation's or vehicle's page: purchase and sale facts, **days held** (or *Held to date* if unsold), the **lifetime cost** from purchase price to profit, and a **By year** view. Profit and return appear only once sold. An unsold one shows the investment recorded so far. That is cost, not value; Gable never estimates a market value.

On a rental's (or business's) page: **income received**, **expenses paid** and **net income**, by year, plus every income entry. There is no profit or return figure for these.

## Reports and the Overview

- **Overview**: active assets, investment in unsold assets, profit on assets sold in a period, general company expenses, and (if you have rentals or businesses) their income, expenses and net income. They are shown separately because they cover different things.
- **Reports**: sold-asset performance (by sale date; renovations and vehicles), rental and other income (by income and expense date), expense activity (by expense date), current portfolio, and a single-asset report. Export to **Excel** or **PDF**.
- These are management reports, not tax returns or financial statements.

## Backups

Settings → **Backups**. **Back up now** saves everything (data and receipts) in one file. Gable also backs up once a day while it is open, and keeps the 14 newest automatic backups. Backups you make yourself are never deleted automatically.

- Choose a folder on an **external drive** if you can. A backup on the same drive as Gable does not protect you if that drive fails.
- Backups are **not encrypted**. Keep them somewhere private.
- **Restore replaces everything**, every company, with the backup. Gable shows what is in it, saves a backup of your current data first, then restarts.

## Getting help

If something goes wrong, write down what you were doing and any message you saw. A small log is kept at `gable.log` in Gable's data folder; it records what happened and when, not your amounts or receipts.

## Known limits

Gable does not give tax advice or produce tax returns; it does not handle loans, refunds, payroll, rent or multiple currencies; HEIC photos must be converted to JPG first; the receipt reader handles English only.
