# Dashboard Accessibility

The eBPFsentinel dashboard targets **WCAG 2.2 Level AA**. This page says what
is checked automatically, what the interface does for keyboard and screen-reader
users, and where it falls short.

## What is checked

| Standard | Level | How |
|----------|-------|-----|
| WCAG 2.2 | AA | axe-core on six routes, light and dark |
| WCAG 2.2 | AAA | Not targeted |

The end-to-end suite runs axe-core through Playwright with the `wcag2a`,
`wcag2aa` and `wcag22aa` rule tags and fails on any **critical** or **serious**
violation. It covers six routes, each in the light and the dark theme: Overview
(`/`), Alerts (`/alerts`), Fleet (`/fleet`), Topology (`/topology`), Compliance
(`/compliance`) and Audit & License (`/audit-license`). Every other route is
covered by component tests and review, not by axe-core.

The suite is a `workflow_dispatch` run rather than a pull-request gate: it pulls
the `:dev` images of the agent, the enterprise agent and the dashboard, and the
enterprise manifest is private, so the automatic triggers stay off until those
images are published.

## Keyboard

Every interactive element is reachable with `Tab` / `Shift+Tab`.

| Shortcut | Action |
|----------|--------|
| `Ctrl+K` / `Cmd+K` | Open the command palette |
| `↑` / `↓` | Move through palette results |
| `Enter` | Run the selected palette entry, or activate the focused control |
| `Escape` | Close the palette or a dialog |

### Command palette

The palette searches, in this order:

- the actions the screen on display publishes (the alert list, an alert's
  detail and flow analytics publish theirs);
- the console-wide switches: toggle the theme, change the language, sign out;
- every route the signed-in user can reach, grouped as in the sidebar.

It is loaded on first use, so the first `Ctrl+K` of a session fetches it.

### Dialogs

The palette and the agent enrolment dialog are modal dialogs: focus moves into
the dialog when it opens, stays inside it while it is open, and returns to the
control that opened it when `Escape` closes it.

## Visual

- **Contrast.** Both themes are held to the AA ratios (4.5:1 for normal text,
  3:1 for large text) by axe-core's contrast rule on the six routes above.
- **Focus.** A focused control draws a ring on `:focus-visible` from the
  charter's ring token; a mouse click does not draw it.
- **Theme.** The first visit starts from `prefers-color-scheme`; the theme is
  then stored in the browser and wins over a later change of the system setting.

## Screen readers

- The shell uses landmark elements; the sidebar is a `<nav>` labelled
  "Primary navigation".
- The palette input is a `combobox` over a `listbox`, with
  `aria-activedescendant` following the highlighted result.
- Charts (time series, the severity donut) are inline SVG with `role="img"` and
  an `aria-label` that states what the chart shows.
- On the flow analytics screen each Sankey node is a focusable button with a
  label, and `Enter` applies it as a filter, as a click does. The flow records
  table beneath carries the same data.
- The topology graph is one `role="img"` with a summary label, and the table
  under it lists every flow the picture draws.
- `prefers-reduced-motion: reduce` is honoured everywhere: dialog and sheet
  transitions, loading skeletons and hover fades finish at once, and the in-page
  jumps on the flow analytics screen do not scroll smoothly.

## Known limitations

- **Topology.** The graph itself is not navigable node by node; the table under
  it is the accessible reading.
- **Coverage.** axe-core runs on six routes; the others are not scanned.

## Reporting an accessibility issue

1. Open a GitHub issue at the dashboard repository.
2. Use the label `a11y`.
3. Include:
   - the route and the action you were performing;
   - your browser, OS and assistive technology (screen reader, magnifier, etc.);
   - a screenshot or screen recording if possible;
   - the expected and the actual behaviour.

`critical` and `serious` accessibility issues get the same priority as security
bugs.
