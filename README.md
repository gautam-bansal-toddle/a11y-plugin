# a11y-plugin — local Claude Code marketplace

A single-plugin Claude Code marketplace containing an extended copy of
[`Community-Access/accessibility-agents`](https://github.com/Community-Access/accessibility-agents).
Everything lives in this folder — no global installs, no LaunchAgents, no
VS Code settings edits, no auto-update jobs. You extend the files here,
and Claude Code loads them directly.

See `SOURCE.md` for the upstream commit hash and re-sync instructions.
See `README.upstream.md` for the original plugin-level README.

## Layout

```
.
├── .claude-plugin/
│   ├── marketplace.json      # namespace: gautam-a11y
│   └── plugin.json           # plugin: accessibility-agents@3.2.0
├── .mcp.json                 # registers the a11y-agent-team MCP server
├── agents/                   # 80 specialist subagents
├── commands/                 # 17 slash commands
├── hooks/hooks.json          # 3 enforcement hooks
├── scripts/                  # hook implementations
│   ├── a11y-team-eval.sh     # UserPromptSubmit
│   ├── a11y-enforce-edit.sh  # PreToolUse on Edit|Write
│   └── a11y-mark-reviewed.sh # PostToolUse on Agent
├── mcp-server/               # MCP server (stdio transport)
│   ├── stdio.js              # entry point Claude Code spawns
│   ├── server-core.js        # MCP tool definitions
│   ├── tools/                # playwright, pdf-form, verapdf tool impls
│   ├── package.json
│   └── node_modules/         # gitignored
├── docs/                     # upstream docs
├── example/                  # upstream demo project
├── templates/                # config templates (EPUB, enterprise, etc.)
├── CLAUDE.md                 # plugin CLAUDE.md (not auto-loaded)
├── AGENTS.md                 # agent inventory
└── SOURCE.md                 # upstream sync record
```

## Loading the plugin

### Dev loop — `--plugin-dir` (recommended while extending)

Launch Claude Code with this plugin loaded directly from source:

```sh
claude --plugin-dir /Users/gautambansal/Coding/a11y-plugin
```

Claude Code reads files from this directory in-place — every edit to agents,
commands, hooks, or the MCP server takes effect after `/reload-plugins`. No
cache, no version bumps needed.

### Marketplace install (once stable)

```
/plugin marketplace add /Users/gautambansal/Coding/a11y-plugin
/plugin install accessibility-agents@gautam-a11y
```

Claude Code copies this directory into `~/.claude/plugins/cache/...`. After
that, local edits here will *not* be picked up until you bump
`version` in `.claude-plugin/plugin.json` and run `/plugin update`.

Uninstall cleanly:

```
/plugin uninstall accessibility-agents@gautam-a11y
/plugin marketplace remove gautam-a11y
```

Neither touches this folder.

## MCP server

The MCP server provides runtime scanning tools that several agents rely on:
`run_axe_scan`, `scan_pdf_document`, `scan_office_document`, `scan_html_file`,
`run_verapdf_scan`, `convert_pdf_form`, Playwright-driven browser tools, etc.

### How it starts

`.mcp.json` at the plugin root registers the server with Claude Code:

```json
{
  "mcpServers": {
    "a11y-agent-team": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp-server/stdio.js"]
    }
  }
}
```

Claude Code spawns `node mcp-server/stdio.js` as a child process on stdio when
the plugin is enabled. No daemon, no port — it lives with your session.

### What's installed

`mcp-server/node_modules/` (64 MB, gitignored) contains:

- `@modelcontextprotocol/sdk`, `express`, `zod` (core)
- `playwright@1.58.2` + `@axe-core/playwright@4.11.1` (browser-based scans)
- `pdf-lib@1.17.1` (PDF form conversion)

Chromium 1208 for Playwright is at `~/Library/Caches/ms-playwright/chromium-1208/`.

### What's NOT installed (deliberately)

- **Java + veraPDF** for deep PDF/UA validation. Without them, `run_verapdf_scan`
  won't work but `scan_pdf_document` (baseline) still does. To add later:
  `brew install openjdk verapdf`.

### Smoke test

```sh
cd mcp-server && node --test server-core.test.js
```
All 59 upstream tests should pass.

### When you edit MCP code

Restart the Claude Code session (or `/reload-plugins`) so the new `stdio.js`
child process picks up changes. Hot-reload does not apply to MCP subprocesses.

## Extending

- **Agents:** drop a new `<name>.md` into `agents/` with standard YAML
  frontmatter (`name`, `description`, `tools`). Restart Claude Code to pick it up.
- **Slash commands:** drop a new `<name>.md` into `commands/`. Becomes `/<name>`.
- **Hooks:** edit `hooks/hooks.json` to add/remove events; edit the shell
  scripts under `scripts/` to change enforcement logic. Paths in `hooks.json`
  use `${CLAUDE_PLUGIN_ROOT}` so moving this folder works.

## Enforcement hooks

The three hooks are **enabled** by default (same behavior as upstream):

1. **UserPromptSubmit** → injects a "MANDATORY accessibility check" preamble
   into your prompts whenever the project looks like web UI or the prompt
   mentions web/a11y keywords.
2. **PreToolUse** (matcher: `Edit|Write`) → blocks edits to UI files
   (`.tsx/.vue/.html/.css/…`) until you delegate to the `accessibility-lead`
   subagent once per session.
3. **PostToolUse** (matcher: `Agent`) → writes a session marker at
   `/tmp/a11y-reviewed-<session-id>` after `accessibility-lead` runs, which
   unlocks edits for the rest of that session.

To disable without removing: clear the arrays in `hooks/hooks.json`, or
uninstall the plugin via the commands above.

## Bumping the version

If you change enough that you want a distinct version string, edit both:

- `.claude-plugin/plugin.json` → `version`
- `.claude-plugin/marketplace.json` → `plugins[0].version`
