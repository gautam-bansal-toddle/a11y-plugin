---
name: route-audit
description: Drive a power-user accessibility audit of a single web route — runtime + static in parallel, cited by WCAG SC, consolidated into a CSV report, and followed by a batched fix-and-verify loop. Use this whenever the user asks to audit, scan, review, or fix accessibility for a specific URL, route, page, component, screen, or view of a web app — including phrasings like "check a11y on /checkout", "audit my settings page", "WCAG audit the dashboard", "find accessibility bugs on this route", "fix the a11y issues on /foo", or any request that mentions a URL + source file together. Prefer this skill over firing individual agents ad-hoc, because it enforces parallel specialist dispatch, WCAG SC citations, structured CSV output, pre-fix snapshots, batched remediation, and post-fix verification — the coordination pieces Claude otherwise skips.
---

# Route accessibility audit — power-user workflow

This skill orchestrates the `accessibility-agents` plugin (80 specialist agents + 24 MCP tools under the `a11y-agent-team` server) to produce a complete, WCAG-cited, file-grounded audit of one web route and drive a controlled fix loop against it.

It exists because the plugin's pieces are individually powerful but the model, left to its own devices, tends to serialize specialists, skip runtime verification, produce unstructured findings, and fix issues one-at-a-time instead of by WCAG criterion. Those four mistakes cost 3–5× more turns and produce inconsistent fixes. This skill codifies the coordination so the plugin actually operates at full capacity.

## Inputs the user must provide

Before proceeding, confirm you have:

1. **Live URL** (e.g., `http://localhost:3000/platform/settings/templates`). The dev server must be running — the runtime pass depends on it. If the URL is not reachable, stop and tell the user.
2. **Source file path** backing that route (e.g., `src/routes/.../Templates.js` or `src/pages/settings/templates.tsx`). This pins the static pass — specialists read these exact files rather than guessing.
3. **Project root** — you should be running in the repo that owns the route (check `pwd`). The `UserPromptSubmit` hook detects web projects by grepping `package.json` in CWD; if you are outside the repo, delegation won't fire automatically.
4. **Auth state file (only for logged-in routes)** — path at `$A11Y_AUTH_STATE_FILE`, or absence for public routes. Phase 0 covers capturing and wiring this if needed.

If any of these is missing or ambiguous, ask once, then proceed.

## Phase 0 — Authentication check (fast, skip when possible)

Most real app routes sit behind a login. Before Phase 1, do a two-second probe against the URL. If the page returns a login form, redirects to `/login`, or the interactive element count comes back as zero from `run_playwright_keyboard_scan`, the runtime pass is hitting a login wall — every runtime finding will be noise about the login page, not the intended route.

Resolve this by pointing the MCP tools at a saved authenticated session via the `A11Y_AUTH_STATE_FILE` environment variable. The variable takes a path to a Playwright `storageState` JSON (cookies + localStorage). When set, every runtime tool launches a Chromium context with that state loaded, so scans run as the logged-in user.

**To capture the state file**, use the bundled helper:

```sh
node ${CLAUDE_PLUGIN_ROOT}/skills/route-audit/scripts/capture-auth-state.mjs \
  http://localhost:3000/login \
  --out $(pwd)/.a11y-auth/state.json
```

This opens a visible browser, waits for the user to log in manually, then writes the state file. Tell the user to:
1. Run the script in a terminal (not inside Claude Code's sandbox — it needs a display).
2. Sign in through the opened browser.
3. Return to the terminal and press Enter to save.
4. Export the path and (re)launch Claude Code so the MCP subprocess inherits the env var:
   ```sh
   export A11Y_AUTH_STATE_FILE=$(pwd)/.a11y-auth/state.json
   cd <repo-root>
   claude --plugin-dir /Users/gautambansal/Coding/a11y-plugin
   ```

Add `.a11y-auth/` to `.gitignore` — the state file is effectively a credential.

If the route is public, skip all of this and go straight to Phase 1.

## Phase 1 — Parallel runtime + static audit

Output a one-paragraph plan first: which specialists will run, which MCP tools will run, and why each is relevant to the route. Wait for user "go" only if the user has been explicit about wanting a preview; otherwise proceed directly — most users want execution, not permission.

Then dispatch **in a single assistant message with multiple Agent tool calls** so the runs execute concurrently. Serial dispatch wastes ~60% of wall time on this workflow.

### Runtime pass (MCP `a11y-agent-team` tools, against the live URL)

Always run these five on first audit of a route:

| Tool | What it catches |
|---|---|
| `run_axe_scan` | axe-core WCAG 2.1 AA violations in the current DOM |
| `run_playwright_a11y_tree` | What a screen reader actually exposes (names/roles/states) |
| `run_playwright_keyboard_scan` | Tab order, focus traps, reachability of interactive elements |
| `run_playwright_contrast_scan` | Runtime text contrast (catches things computed CSS hides from static) |
| `run_playwright_viewport_scan` | Reflow/overflow at 320px, 768px, 1024px, 1440px and 200% zoom |

Run `run_axe_scan` in multiple UI states whenever the route has interactive affordances (drawers, modals, forms, wizard steps, validation). At minimum: initial load. Additionally, if applicable:
- after opening each primary modal/drawer
- after submitting a form with an intentionally invalid field
- after toggling a theme or dark mode
- after triggering a toast/notification

Capture each state's axe output to `reports/a11y/snapshots/axe-<state-slug>-before.json` so post-fix diffs are possible.

### Static pass (delegate to `accessibility-agents:accessibility-lead`)

Dispatch the lead with an explicit specialist list. The lead has a bias toward running only a subset if you don't name them — name them. Base the list on what the route renders, not what it's named:

- **Always include**: `aria-specialist`, `keyboard-navigator`, `contrast-master`, `alt-text-headings`, `cognitive-accessibility`, `i18n-accessibility`.
- **Include if applicable**:
  - `forms-specialist` — any `<input>`, `<select>`, `<textarea>`, or form library usage
  - `modal-specialist` — any dialog, drawer, popover, tooltip, or portal pattern
  - `live-region-controller` — any toast, notification, loading spinner, dynamic status text
  - `tables-data-specialist` — any `<table>` or grid component
  - `media-accessibility` — any `<video>`, `<audio>`, `<iframe>` embeds
  - `data-visualization-accessibility` — any chart/graph library (recharts, d3, chart.js)
  - `web-component-specialist` — any custom element (`<my-el>`) or shadow DOM
  - `mobile-accessibility` — if the viewport scan surfaces mobile-specific issues

### WCAG citation requirement

Before specialists report findings, instruct the lead to call `get_accessibility_guidelines` (MCP resource) for each component type involved. Every finding must be tagged with the exact Success Criterion (e.g., `2.1.1 Keyboard`, `4.1.2 Name, Role, Value`, `1.4.3 Contrast (Minimum)`). This matters because fix suggestions without WCAG anchors can't be filed as tickets and tend to drift into style preferences.

### Cache awareness

On second and subsequent audits of files in the same repo, instruct the lead to call `check_audit_cache` first. If a file's hash is unchanged since the last audit, skip it and reuse prior findings. This is how incremental audits stay fast on monorepos.

## Phase 2 — Consolidate into a structured report

Collect findings from Phase 1 and invoke `accessibility-agents:web-csv-reporter`:

**CSV path**: `reports/a11y/<route-slug>-<YYYY-MM-DD>.csv`

**Columns (exact order)**: `id, severity, wcag_criterion, source, tool_or_agent, file, line_range, element_selector, issue, fix_suggestion, status`

- `severity`: `P0` (AT-blocking WCAG violation), `P1` (serious AT degradation), `P2` (usability issue), `P3` (best practice).
- `source`: `runtime` (from an MCP scan tool) or `static` (from a specialist agent).
- `status`: all rows start as `open`.
- Sort by `severity` ascending, then `wcag_criterion`.

**Markdown summary**: `reports/a11y/<route-slug>-<YYYY-MM-DD>.md` — one page with:
- Counts per severity and per top-level WCAG principle (Perceivable / Operable / Understandable / Robust).
- Top 3 critical issues with file:line.
- List of files audited.
- Any tools that failed to run (dev server down, browser binary missing, etc.).

## Phase 3 — Pause for approval (default behavior)

Present the report summary to the user in chat:
- Severity counts.
- The 3 most critical issues with one-line summaries.
- Link to the CSV and markdown files.

Then ask a scoped question: **which severity tier should I fix now — all P0s, P0+P1, or none yet?** Do not start fixing until the user answers.

The reason: severity triage is subjective enough that automated judgment creates rework. Giving the user a clear decision point at this gate saves more time than it costs.

## Phase 4 — Batched fix loop (only after user approval)

Hand the approved severity tier and the CSV path to `accessibility-agents:web-issue-fixer`. Give these specific instructions:

1. **Group by `wcag_criterion`** before fixing. Repeated ARIA or focus-management issues should be fixed as one coordinated change — not one row at a time — so the fixes share a style.
2. **For each group**: explain the pattern, make the edits, then run the relevant runtime verifier:
   - ARIA / semantics issues → `run_axe_scan` + `run_playwright_a11y_tree`
   - Keyboard issues → `run_playwright_keyboard_scan`
   - Contrast issues → `run_playwright_contrast_scan`
   - Viewport / reflow → `run_playwright_viewport_scan`
3. **Mark `status=fixed` only after verification passes**. If a verifier regresses (new violations appear), revert the edits in that group, mark the rows `open` with a note in `issue`, and continue to the next group.
4. **Stop and surface** any regression before moving to the next severity tier.

The Edit/Write gate from the plugin's hooks will already be unlocked from Phase 1 (the `accessibility-lead` touched the session marker). If the user started a fresh session between audit and fix, re-invoke the lead first or the fix tool calls will be blocked.

## Phase 5 — Verify and record

After the fix loop completes:

1. Re-run the original Phase 1 runtime suite and save snapshots to `reports/a11y/snapshots/axe-<state-slug>-after.json`.
2. Diff before/after counts and confirm zero new issues introduced.
3. Call `update_audit_cache` to record current file hashes so the next audit is incremental.
4. Append a one-line summary to `reports/a11y/CHANGELOG.md`:
   ```
   YYYY-MM-DD  /route/path  P0: 4→0  P1: 7→2  P2: 12→8  files: 3  deferred: "P1 modal focus (tracking #123)"
   ```

## Fast path for re-audits

For a route that was audited earlier today and a small edit was just made:
- Skip the full specialist list. Read the cached report, identify which WCAG criteria the edit could affect, and run only the matching verifiers.
- Do not go through `accessibility-lead` for read-only verification — that adds a dispatch hop and the lead has no value to add when you already know what to check.

## Anti-patterns — don't

- Do not start fixing issues in the same prompt as the audit. Users need the triage gate.
- Do not let the lead pick specialists without an explicit list. It consistently runs too few.
- Do not serialize specialist Task calls across multiple assistant messages. Dispatch in one message.
- Do not trust type-check as a verification signal. Runtime verification is the only source of truth.
- Do not skip `run_playwright_a11y_tree` because "axe already ran". They catch different bugs — axe misses semantic / naming issues that the tree exposes directly.
- Do not fix issues one CSV row at a time. Group by `wcag_criterion`.
- Do not run the MCP tools if the dev server isn't up. Fail fast with a clear error to the user.
- Do not proceed with Phase 1 when the runtime probe shows a login wall (keyboard scan finds zero interactive elements, URL redirects to `/login`, visible login form). Stop, instruct the user to capture auth state via the Phase 0 script, then retry. Scanning the login page itself is not the audit the user asked for.

## MCP tool reference (`a11y-agent-team` server)

**Runtime (live URL required)**: `run_axe_scan`, `run_playwright_a11y_tree`, `run_playwright_keyboard_scan`, `run_playwright_contrast_scan`, `run_playwright_viewport_scan`.

**Static HTML / source**: `check_heading_structure`, `check_link_text`, `check_form_labels`, `check_contrast`, `check_color_blindness`, `check_reading_level`.

**Meta / guidance**: `get_accessibility_guidelines` (WCAG rules by component type), `check_audit_cache`, `update_audit_cache`.

**Documents (not used by this skill — route audits only)**: `scan_pdf_document`, `scan_office_document`, `batch_scan_documents`, `run_verapdf_scan`, `convert_pdf_form_to_html`, `fix_document_metadata`, `fix_document_headings`.

**Media / text**: `validate_caption_file`, `check_reading_level`.

**Reporting**: `generate_accessibility_statement` (skip unless the user specifically asks for a public statement).

## Specialist agent reference (under `accessibility-agents:*`)

**Coordinator**: `accessibility-lead` (always the entry point for the static pass).

**Web specialists** (use these for routes): `aria-specialist`, `keyboard-navigator`, `contrast-master`, `forms-specialist`, `modal-specialist`, `alt-text-headings`, `live-region-controller`, `cognitive-accessibility`, `i18n-accessibility`, `mobile-accessibility`, `tables-data-specialist`, `media-accessibility`, `data-visualization-accessibility`, `web-component-specialist`.

**Reporting/remediation**: `web-csv-reporter`, `web-issue-fixer`, `playwright-verifier`.

Skip non-web specialists (office, PDF, EPUB, desktop, markdown) — they're for other workflows.

## Success signal

A run of this skill has succeeded when all of the following are true:
- A CSV report exists at `reports/a11y/<route-slug>-<date>.csv` with every row WCAG-cited.
- Runtime snapshots exist before and after any fix phase.
- Every `status=fixed` row was verified by a runtime tool after the fix.
- The `.a11y-cache.json` was updated.
- The user has a clear decision point (Phase 3 gate) rather than auto-fixes they didn't sign off on.
