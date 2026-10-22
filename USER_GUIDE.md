# Gable: user guide

Gable keeps track of your properties, what you spend on them, and what you make when you sell. Everything stays on your computer. There is no account and nothing is sent anywhere.

## First time

1. Open Gable. It asks for your company name. That is the only thing required.
2. Add your first property (or skip it). Enter the address, purchase date and purchase price. Properties bought years ago are fine.

## Your companies

- The box at the top left switches company. **All Companies** shows everything together but is view-only: pick one company to add anything.
- Settings → Companies lets you add companies, choose the **default** (the one Gable opens to) and archive a company. Archiving hides it and keeps all its records; you can restore it.

## Adding a property

Properties → **Add property**. Status is Held, Renovating, Listed or Sold. Marking a property Sold asks for the sale date and the **gross** sale price. Enter commissions and closing costs as expenses, not here, so they are never counted twice.

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

## What each property shows

On a property's page: purchase and sale facts, **days held** (or *Held to date* if unsold), the **lifetime cost** from purchase price to profit, and a **By year** view. Profit and return appear only for sold properties. An unsold property shows the investment recorded so far. That is cost, not value; Gable never estimates a market value.

## Reports and the Overview

- **Overview**: active properties, investment in unsold properties, profit on properties sold in a period, and general company expenses. They are shown separately because they cover different things.
- **Reports**: sold-property performance (by sale date), expense activity (by expense date), current portfolio, and a single-property report. Export to **Excel** or **PDF**.
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
