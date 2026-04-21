# Upstream source

This directory is a local, extended copy of the `accessibility-agents` Claude Code plugin.

- **Upstream repo:** https://github.com/Community-Access/accessibility-agents
- **Synced from commit:** `a03bc2aa9d64ef69aaf65ab877f07ada54abe0f4` (short: `a03bc2a`)
- **Synced on:** 2026-04-17
- **Upstream subtree copied:** `claude-code-plugin/` → this directory root

## Re-sync workflow (manual, no install.sh)

The upstream `install.sh` does a lot we do not want (writes to `~/.claude`, VS Code settings, LaunchAgent for auto-update, etc.). Do NOT run it. To pull updates from upstream:

```sh
TMP=$(mktemp -d)
git clone --depth 1 https://github.com/Community-Access/accessibility-agents.git "$TMP/src"
# Diff upstream against this folder to see what changed upstream:
diff -r "$TMP/src/claude-code-plugin" . | less
# Manually cherry-pick files you want to update. Do not blindly overwrite —
# any local extensions you've made to agents/, commands/, hooks/, or scripts/
# will be lost if you just copy the whole tree over.
rm -rf "$TMP"
```

Known upstream symlink quirk: several files (`CHANGELOG.md`, `CODE_OF_CONDUCT.md`,
`CONTRIBUTING.md`, `SECURITY.md`, `docs/architecture.md`, `docs/hooks-guide.md`,
`docs/getting-started.md`, `docs/configuration.md`) are committed as symlinks
whose targets include a trailing newline byte. `cp -RL` silently skips them.
If you re-sync, copy those files explicitly from `$TMP/src/<basename>` and
`$TMP/src/docs/<basename>`.
