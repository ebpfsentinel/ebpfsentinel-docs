# Dashboard Accessibility

The eBPFsentinel dashboard targets **WCAG 2.2 Level AA** conformance. SOC analysts using screen readers, keyboard-only navigation, or high-contrast modes can perform all critical actions — from triaging alerts to blocking IPs — without a mouse.

## Conformance Level

| Standard | Level | Status |
|----------|-------|--------|
| WCAG 2.2 | AA | Tested |
| WCAG 2.2 | AAA | Not targeted |
| Section 508 | — | Covered by AA |

## What We Test

Every PR runs axe-core via Playwright against all dashboard routes in both light and dark themes. **Critical** and **serious** violations block merge.

Tested routes: Overview, Alerts, Alert Detail, Fleet, Flow Graph, Compliance, Audit & License.

## Keyboard Navigation

All interactive elements are reachable via `Tab` / `Shift+Tab`. Additional keyboard support:

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` / `Cmd+K` | Open command palette |
| `Escape` | Close modal or command palette |
| `Enter` | Activate focused button or palette item |
| `↑` / `↓` | Navigate command palette results |
| `Tab` / `Shift+Tab` | Cycle through interactive elements |

### Command Palette

Press `Ctrl+K` to open a fuzzy search over routes and actions (navigate, toggle theme, block IP, acknowledge alert). Arrow keys select, Enter activates, Escape closes.

### Modal Focus Trapping

When a modal is open (Block IP, Push Config, Generate Report), keyboard focus is trapped inside it. `Tab` wraps from the last to the first focusable element. `Escape` closes.

## Visual Accessibility

### Color Contrast

All text meets the minimum contrast ratios:

- **Normal text** (< 18pt): 4.5:1 against background
- **Large text** (≥ 18pt or 14pt bold): 3:1 against background
- Both light and dark themes are validated

### Focus Indicators

Every focusable element shows a visible `2px solid` outline on `:focus-visible`. Mouse clicks do not trigger the focus ring (`:focus:not(:focus-visible)` suppresses it).

### Reduced Motion

Users with `prefers-reduced-motion: reduce` get instant transitions instead of animations. The right sheet, modals, and all CSS transitions are disabled.

## Screen Reader Support

- All routes use semantic HTML (`<nav>`, `<main>`, `<header>`, `<button>`, `<table>`)
- Icon-only buttons have `aria-label` attributes
- Modals use `role="dialog"` with `aria-modal="true"`
- The sidebar has `aria-label="Primary navigation"`
- The action toolbar uses `role="toolbar"` with `aria-label="Alert actions"`
- The command palette uses `role="combobox"` with `aria-activedescendant` tracking

## Known Limitations

- **Charts**: ECharts (via charming/WASM canvas) are not screen-reader accessible. Hover/focus states show text labels, and tabular data is available alongside each chart.
- **Flow graph**: The force-directed graph is canvas-based. A tabular alternative is available in the node/edge detail sheets.

## Reporting an Accessibility Issue

If you encounter an accessibility barrier:

1. Open a GitHub issue at the dashboard repository
2. Use the label `a11y`
3. Include:
   - The route and action you were performing
   - Your browser, OS, and assistive technology (screen reader, magnifier, etc.)
   - A screenshot or screen recording if possible
   - The expected vs. actual behavior

We treat `critical` and `serious` a11y issues with the same priority as security bugs.
