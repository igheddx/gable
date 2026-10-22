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

## 11. Open design items (filled at Prompt 2)

Final neutral/divider values, darker brass text variant, font selection and licenses, icon family, app icon (original vector artwork, not emoji), contrast table, screenshots.
