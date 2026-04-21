---
name: accessibility-static-audit
description: Drive a power-user static accessibility audit of one or more source files (no live URL required) — parallel specialist dispatch, cited by WCAG SC, consolidated into a CSV report, and followed by a batched fix-and-verify loop. Use this whenever the user asks to audit, scan, review, or fix accessibility for a specific file, directory, or set of files — including phrasings like "audit a11y on Button.tsx", "scan this component for accessibility issues", "WCAG check src/components/Modal.jsx", "find a11y bugs in src/features/settings", "static accessibility audit of this file", or any request that names source file paths (not a URL) and asks for an accessibility check. Prefer this skill over route-audit when no dev server is available or the user only wants source-level analysis. Prefer it over ad-hoc specialist dispatch because it enforces parallel delegation, WCAG SC citations, structured CSV output, a triage gate before any edits, and batched remediation — the coordination pieces Claude otherwise skips.
---

# Static accessibility audit — file-based workflow

This skill orchestrates the `accessibility-agents` plugin specialists to produce a complete, WCAG-cited, source-grounded audit of one or more files — without requiring a live URL or dev server — and drives a controlled fix loop against them.

It exists because the plugin's specialists are individually powerful but the model, left to its own devices, tends to invoke them serially, skip WCAG citations, produce unstructured findings, and fix issues one-at-a-time instead of by criterion. Those four mistakes cost 3–5× more turns and produce inconsistent fixes. This skill codifies the coordination so the plugin operates at full capacity on a source-only target.

Use this variant when:
- No dev server is available, or spinning one up is expensive.
- The user names specific files or a directory rather than a URL.
- The audit target is pre-merge code, a pull request, a newly added component, or a module.

When a live URL *is* available and the user wants complete coverage, prefer `route-audit` — it catches runtime-only issues (focus management, dynamic announcements, computed contrast, reflow) that source-only inspection cannot see.

## Inputs the user must provide

Before proceeding, confirm you have:

1. **Target path(s)** — one or more of:
   - a single file (`src/components/Button.tsx`),
   - multiple explicit files,
   - a directory root (`src/features/settings/`) — the skill will walk it for UI-shaped files (`.jsx`, `.tsx`, `.vue`, `.svelte`, `.astro`, `.html`, `.css`).
2. **Project root** — you should be running in the repo that owns the file(s). The `UserPromptSubmit` hook detects web projects by grepping `package.json` in CWD; if you are outside the repo, delegation won't fire automatically.

If the user gave a vague target ("the new feature", "my component"), ask once for concrete paths, then proceed.

## Phase 1 — Scope and plan

Output a one-paragraph plan first: the file list that will be audited, which specialists will run, and why each is relevant. Base specialist selection on what the file(s) actually render — open each file briefly to check imports and top-level markup, don't guess from path names.

If the target is a directory, enumerate the UI files under it once and show the user the list before dispatching. For lists over 20 files, offer to batch (e.g., by subdirectory) or narrow to changed files only (`git diff --name-only`).

## Phase 2 — Parallel static audit

Dispatch `accessibility-agents:accessibility-lead` with an **explicit specialist list**. The lead has a bias toward running only a subset if you don't name them — name them. Base the list on what the file(s) render, not on their paths:

- **Always include**: `aria-specialist`, `keyboard-navigator`, `contrast-master`, `alt-text-headings`, `cognitive-accessibility`, `i18n-accessibility`.
- **Include if applicable**:
  - `forms-specialist` — any `<input>`, `<select>`, `<textarea>`, or form-library usage
  - `modal-specialist` — any dialog, drawer, popover, tooltip, or portal pattern
  - `live-region-controller` — any toast, notification, loading spinner, dynamic status text
  - `tables-data-specialist` — any `<table>` or grid component
  - `media-accessibility` — any `<video>`, `<audio>`, `<iframe>` embeds
  - `data-visualization-accessibility` — any chart/graph library (recharts, d3, chart.js)
  - `web-component-specialist` — any custom element (`<my-el>`) or shadow DOM

Dispatch the lead in a single assistant message. The lead itself fans out to specialists in parallel and normalizes their output — do not invoke specialists directly from this skill; direct dispatch breaks normalization and produces inconsistent CSV column values.

### WCAG citation requirement

Instruct the lead that every finding **must** be tagged with its exact Success Criterion (e.g., `2.1.1 Keyboard`, `4.1.2 Name, Role, Value`, `1.4.3 Contrast (Minimum)`). Findings without WCAG anchors drift into style preferences and cannot be filed as tickets. If the lead is unsure which SC applies, tell it to call `get_accessibility_guidelines` (MCP resource) for the component type first.

### What this skill deliberately cannot catch

Static inspection of source cannot confirm:
- Runtime focus order, focus traps, or return-of-focus after modal close.
- Live announcements actually emitted by `aria-live` regions.
- Computed color contrast after theme/CSS-in-JS runtime application.
- Reflow or overflow at specific viewports and 200% zoom.
- Screen-reader exposure (what names/roles/states end up in the a11y tree after render).

Flag this coverage gap to the user in the report summary (Phase 4). For any route where these runtime concerns matter, the user should follow up with `route-audit` once the dev server is running.

### Cache awareness

On second and subsequent audits of files in the same repo, instruct the lead to call `check_audit_cache` first. If a file's hash is unchanged since the last audit, skip re-scanning it and reuse prior findings. On directories of 50+ files, this drops incremental audits from minutes to seconds.

## Phase 3 — Consolidate into a structured report

Collect findings from Phase 2 and invoke `accessibility-agents:web-csv-reporter`:

**CSV path**: `reports/a11y/static-<target-slug>-<YYYY-MM-DD>.csv` — where `<target-slug>` is the file basename for single-file runs, or the directory name for multi-file runs.

**Columns (exact order)**: `id, severity, wcag_criterion, source, tool_or_agent, file, line_range, element_selector, issue, fix_suggestion, status`

- `severity`: `P0` (AT-blocking WCAG violation), `P1` (serious AT degradation), `P2` (usability issue), `P3` (best practice).
- `source`: always `static` for this skill.
- `element_selector`: the JSX tag, component name, or CSS selector identified in source. Static audit cannot confirm a runtime selector path — report what is visible in the file.
- `status`: all rows start as `open`.
- Sort by `severity` ascending, then `wcag_criterion`.

**Markdown summary**: `reports/a11y/static-<target-slug>-<YYYY-MM-DD>.md` — one page with:
- List of files audited.
- Counts per severity and per top-level WCAG principle (Perceivable / Operable / Understandable / Robust).
- Top 3 critical issues with file:line.
- A "not covered by static audit" section listing the runtime concerns from the previous phase, so the user knows what a follow-up `route-audit` would add.

## Phase 4 — Pause for approval (mandatory gate)

Present the report summary to the user in chat:
- Severity counts.
- The 3 most critical issues with one-line summaries.
- Paths to the CSV and markdown files.
- The static-only caveat.

Then ask a scoped question: **which issues should I fix now — all P0s, P0+P1, specific row IDs, or none yet?** Do not start fixing until the user answers.

The reason: severity triage and fix-scope are subjective enough that automated judgment creates rework. A clear decision point here saves more time than it costs, and gives the user a chance to defer issues that need runtime context instead.

## Phase 5 — Batched fix loop (only after user approval)

Hand the approved row set and the CSV path to `accessibility-agents:web-issue-fixer`. Give these specific instructions:

1. **Group by `wcag_criterion`** before fixing. Repeated ARIA, focus, or labeling issues should land as one coordinated change — not one row at a time — so the fixes share a style across the file/module.
2. **For each group**: explain the pattern in one sentence, make the edits, then re-dispatch the originating specialist against the modified file to verify the finding is gone and nothing adjacent regressed.
3. **Mark `status=fixed` only after the specialist re-check passes**. If the specialist surfaces a new issue that the fix introduced, revert the edits in that group, mark the rows `open` with a note in `issue`, and continue to the next group.
4. **Stop and surface** any regression before moving to the next severity tier.

The Edit/Write gate from the plugin's hooks will already be unlocked from Phase 2 (the `accessibility-lead` touched the session marker). If the user started a fresh session between audit and fix, re-invoke the lead first or the fix tool calls will be blocked.

## Phase 6 — Record

After the fix loop completes:

1. Call `update_audit_cache` to record current file hashes so the next audit is incremental.
2. Append a one-line summary to `reports/a11y/CHANGELOG.md`:
   ```
   YYYY-MM-DD  static:<target-slug>  P0: 4→0  P1: 7→2  P2: 12→8  files: 3  deferred: "P1 modal focus (needs route-audit)"
   ```
3. If any rows were deferred because they require runtime verification, suggest `route-audit` as the follow-up once the dev server is up.

## Fast path for re-audits

For a target that was audited earlier today and a small edit was just made:
- Skip the full specialist list. Read the cached report, identify which WCAG criteria the edit could affect, and re-dispatch only the matching specialist(s) against the touched file.
- Do not go through `accessibility-lead` for a single-specialist re-check — that adds a dispatch hop with no normalization benefit when only one specialist is involved.

## Anti-patterns — don't

- Do not start fixing issues in the same prompt as the audit. Users need the triage gate.
- Do not invoke specialists directly — go through `accessibility-lead`. Direct dispatch breaks normalization and produces inconsistent CSV column values.
- Do not let the lead pick specialists without an explicit list. It consistently runs too few.
- Do not serialize specialist calls across multiple assistant messages. The lead dispatches them in parallel — let it.
- Do not pretend static audit caught runtime issues. Be explicit about the coverage gap so users know when to follow up with `route-audit`.
- Do not fix issues one CSV row at a time. Group by `wcag_criterion`.
- Do not run the MCP runtime tools (`run_axe_scan`, `run_playwright_*`). They need a live URL — that's `route-audit`'s job.
- Do not trust type-check or linter as a verification signal. Re-running the originating specialist is the only source of truth for static findings.

## Specialist agent reference (under `accessibility-agents:*`)

**Coordinator**: `accessibility-lead` (always the entry point for the audit pass).

**Web specialists** (use these for source files): `aria-specialist`, `keyboard-navigator`, `contrast-master`, `forms-specialist`, `modal-specialist`, `alt-text-headings`, `live-region-controller`, `cognitive-accessibility`, `i18n-accessibility`, `tables-data-specialist`, `media-accessibility`, `data-visualization-accessibility`, `web-component-specialist`.

**Reporting/remediation**: `web-csv-reporter`, `web-issue-fixer`.

Skip non-web specialists (office, PDF, EPUB, desktop, markdown) and `playwright-verifier` / `mobile-accessibility` (runtime-dependent) — they're for other workflows.

## Success signal

A run of this skill has succeeded when all of the following are true:
- A CSV report exists at `reports/a11y/static-<target-slug>-<date>.csv` with every row WCAG-cited and `source=static`.
- The user got a clear decision point (Phase 4 gate) rather than auto-fixes they didn't sign off on.
- Every `status=fixed` row was re-verified by the originating specialist after the fix.
- The `.a11y-cache.json` was updated.
- The summary explicitly calls out what static audit could not verify, so the user knows when `route-audit` is the right next step.
