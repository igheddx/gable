# DESIGN.md — Gable

Status: direction only. Tokens and screenshots are finalized and recorded here at Prompt 2 (design milestone).

## 1. Direction

"Warm architectural finance": composed, precise, premium, understated. A tool for a non-technical owner; calm, legible, no clutter.

## 2. Palette (core)

| Token | Value | Use |
| --- | --- | --- |
| ink | `#182724` | Primary text, navigation surface, primary buttons |
| ivory | `#F7F5F0` | App background |
| brass | `#A78348` | Restrained accent (rules, selected indicators, large elements) |
| panel | `#FFFFFF` | Panels and forms |
| divider | neutral gray (to be set) | Borders and rules |

Rules:
- Brass is **not** default small text on ivory. Use a darker brass variant for text; verify WCAG AA contrast (4.5:1 body, 3:1 large/UI) for every pairing and record ratios here.
- Red/green are semantic only (negative/positive, error/success) and always paired with text, icon, or sign. Never color alone.
- Define semantic tokens: success, warning, danger, info, focus ring, disabled, and "Needs review" (for OCR suggestions; never labeled "Verified").

## 3. Typography

- Locally bundled, appropriately licensed fonts only. No remote fonts. Record font names and licenses here.
- Readable modern sans for UI; optionally a restrained serif for a few major page headings.
- Tabular numerals for all money and dates in tables.
- Token scale for size, weight, line height, letter spacing.

## 4. Tokens to define

Spacing scale, radius (6–10px), elevation (minimal), borders (subtle), focus (visible, 2px+ ring with offset), motion (short, respects `prefers-reduced-motion`), control height (40–44px), z-index layers.

## 5. Layout

- Left navigation: Overview, Properties, Expenses, Reports; Settings near bottom.
- Persistent company selector, always visible; All Companies state clearly marked read-only.
- Main area: page title, small contextual text, one primary action.
- Target windows: 1280×800, 1366×768, 1920×1080 at 100/125/150% scaling. No clipped forms. Panes condense at smaller widths; no requirement for large screens.

## 6. Components

Buttons, inputs, currency field, date field, searchable select, tables (virtualized or paginated), filters, badges, dialogs, toasts, empty states, error states, receipt review, allocation editor. A development-only showcase page lists every component and state.

Avoid: pill-shaped everything, random gradients, emoji, sparkle icons, excess cards, giant dashboard tiles, icon-only primary actions, stock component-library appearance. One line-icon family used sparingly.

## 7. Key interaction patterns

- **Expense entry:** company/property context, vendor, date, category, amount; optional details disclosed; receipt drop zone. Property preselected when launched from a property. Save and Save & Add Another (retains company, property, date; clears amount, notes, receipts). Inline validation, visible labels, natural tab order, focus management, unsaved-changes guard.
- **Receipt review:** compact queue with readable statuses; large preview beside editable form; suggestions shown as "Needs review"; zoom, rotate, retry, skip, manual entry, Next receipt. Stacked or toggled layout at small widths.
- **Allocation editor:** shows remaining amount; exact-sum validation.
- **Company switch with unsaved work:** save / discard / cancel dialog.
- **Missing data:** render "Unavailable", never fabricated zeros or profits.
- **Destructive actions:** confirm dialog explaining the consequence; void/reopen-sale/restore are reversible or backed up.

## 8. Accessibility

Keyboard operation for every flow, visible focus, accessible names/errors, dialog focus trapping and return, reduced motion, contrast verified, scaling to 150%. Never information by color alone.

## 9. Language

Plain English for David. No "SQLite", "IPC", "OCR engine internals" in normal screens. Terms: *Project cost*, *Profit before taxes*, *Held to date*, *Needs review*. Reports state their basis ("by sale date" / "by expense date") and an as-of date.

## 10. Visual review procedure

1. Run the app with the demo fixture database.
2. Capture screenshots at 1280×800, 1366×768, 1920×1080, plus 125% and 150% scaling.
3. Screens: expense entry, receipt review, property list, component showcase.
4. Inspect alignment, contrast, density, truncation, scrolling; fix; recapture.
5. Record file paths of captures in BUILD_STATUS.md. If tooling is unavailable, say so and list manual steps.

## 11. Implemented system (Prompt 2)

Source: `src/renderer/styles/tokens.css` (tokens), `components.css`, `shell.css`, and `src/renderer/components/`.

### Fonts (bundled locally via npm, no remote loading; both SIL Open Font License 1.1)
- **Inter Variable** (UI sans, tabular figures through `font-variant-numeric`), package `@fontsource-variable/inter`.
- **Source Serif 4 Variable** (page titles, dialog titles, brand), package `@fontsource-variable/source-serif-4`.
- Only the Latin subset is shipped. Licenses are in the packages' `LICENSE` files.

### Icons
`lucide-react` (ISC license), one line-icon family, used sparingly. The Gable mark is original artwork (a simple roofline) in `Shell.tsx`; the packaged app icon is still the default Electron icon and is scheduled for Prompt 8.

### Contrast (WCAG 2.x ratios, computed from the token values)
| Pairing | Ratio | Use |
| --- | --- | --- |
| ink `#182724` on ivory `#F7F5F0` | 14.2 | Body text |
| muted `#55625F` on ivory / white | 5.8 / 6.4 | Secondary text |
| brass `#A78348` on ivory | 3.2 | **Not for text.** Rules, active indicator, large marks only |
| brass-text `#7A5F2B` on ivory / white | 5.5 / 6.0 | Brass-colored text |
| brass-on-ink `#D4B97F` on ink | 8.2 | Brass text in the sidebar |
| ivory on ink | 14.2 | Sidebar and primary buttons |
| muted-on-ink `#B9C4C0` on ink | 8.7 | Sidebar secondary text |
| control border `#8A9490` on white | 3.1 | Input borders (UI component minimum is 3:1) |
| danger `#8E2323` on danger-bg | 7.3 | Errors |
| success `#1A5C3A` on success-bg | 6.9 | Positive status |
| review `#6B531F` on review-bg | 6.1 | "Needs review" |
Status is always text plus an icon; red and green are never the only signal. Divider `#DDD9CE` (1.3:1) is decorative only.

### Components
Button, Field (label, hint, error, ARIA wiring), TextField, TextAreaField, CurrencyField, DateField, SelectField, Combobox (ARIA combobox, keyboard: arrows, Enter, Escape), Badge, Dialog (native `<dialog>`: modal, focus trap, Escape, focus returns to opener), Toast (live region), EmptyState, ErrorState, Notice, Disclosure, ReceiptDropZone (real "Choose files" button, so drag and drop is never required), AllocationEditor (live remaining amount, exact-sum validation). Dev-only showcase at `#/showcase` (included in dev and test builds only; `VITE_SHOWCASE=1`).

### Layout
Sidebar 248px (208px under 1180px wide), main content max 1320px. Receipt review is three panes (queue, preview, form) and switches to a queue strip with Receipt/Details tabs when its container is under 1180px. The Electron window minimum is 800x500 so 1366x768 at 150% scaling (about 910x512) is usable.

### Honesty of the preview
All data on these screens is fictional (`fixtures.ts`). Added expenses and "reviewed" receipts live in memory only, and every such screen carries a visible "Design preview" notice. Pages that are not built (Overview, Reports, Settings) show a plain "not built yet" state with no buttons. The Properties page is read-only sample data with working search and status filter.

### Review procedure (reproducible)
`npm run screenshots` packages a test build and writes PNGs to `docs/screenshots/<size>/`. Scaling is emulated by shrinking the window to screen size divided by scale (Windows DIPs), so no zoom artifacts.
Sizes: 1280x800 @100%, 1366x768 @125% (1093x614), 1920x1080 @100%, 1366x768 @150% (911x512), 1280x800 @150% (853x533).
Screens: expenses list, property list, expense entry (empty, errors, split), receipt review (default, failed, duplicate, preview tab), showcase (top, middle, bottom).
Manual keyboard check: Tab through the expense form (order: property, vendor, date, amount, category, split, notes, receipts, buttons); arrows/Enter/Escape in comboboxes; Escape closes dialogs and focus returns to the opener.

### Known gaps
No packaged app icon yet; dark mode not provided (not requested); the showcase is not exhaustive for every state of every component; real Windows rendering (font smoothing, native select popups) is unverified.
