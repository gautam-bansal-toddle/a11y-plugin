#!/usr/bin/env node
/**
 * Capture an authenticated Playwright storageState for the MCP runtime tools.
 *
 * Most real app routes live behind a login. The accessibility-agents MCP tools
 * honor $A11Y_AUTH_STATE_FILE — a path to a Playwright storageState JSON. This
 * script opens a visible browser, lets you log in by hand, then writes that
 * file so subsequent MCP scans run as the logged-in user.
 *
 * Usage:
 *   node capture-auth-state.mjs <start-url> [--out <path>] [--mcp-root <path>]
 *
 * Examples:
 *   # Uses default output: <cwd>/.a11y-auth/state.json
 *   node capture-auth-state.mjs http://localhost:3000/login
 *
 *   # Custom output:
 *   node capture-auth-state.mjs http://localhost:3000/login --out ~/.a11y/toddle.json
 *
 * After it writes the file, export the path so the MCP server picks it up:
 *   export A11Y_AUTH_STATE_FILE=<absolute-path-to-state.json>
 * and (re)start Claude Code so the new env var reaches the MCP subprocess.
 *
 * The storageState is JSON containing cookies + localStorage/sessionStorage
 * snapshots. Treat it like a credential — it grants whatever your logged-in
 * session grants. Do not commit it; add its directory to .gitignore.
 *
 * This script deliberately uses the plugin's vendored Playwright to avoid
 * asking users to install a second copy. It resolves Playwright relative to
 * its own location.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// skills/route-audit/scripts/ → plugin root → mcp-server/
const DEFAULT_MCP_ROOT = resolve(SCRIPT_DIR, "..", "..", "..", "mcp-server");

function parseArgs(argv) {
  const args = { url: null, out: null, mcpRoot: DEFAULT_MCP_ROOT };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--mcp-root") args.mcpRoot = resolve(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: node capture-auth-state.mjs <start-url> [--out <path>] [--mcp-root <path>]"
      );
      process.exit(0);
    } else rest.push(a);
  }
  args.url = rest[0];
  if (!args.url) {
    console.error("Error: start URL is required (e.g. http://localhost:3000/login)");
    process.exit(2);
  }
  const defaultOut = resolve(process.cwd(), ".a11y-auth", "state.json");
  args.out = args.out ? (isAbsolute(args.out) ? args.out : resolve(args.out)) : defaultOut;
  return args;
}

async function importPlaywright(mcpRoot) {
  // Resolve playwright relative to the plugin's mcp-server node_modules so
  // users don't need a second install.
  const pwPath = resolve(mcpRoot, "node_modules", "playwright", "index.mjs");
  try {
    return await import(pwPath);
  } catch (err) {
    console.error(
      `Could not load Playwright from ${pwPath}.\n` +
        `Make sure the plugin's MCP server deps are installed:\n` +
        `  cd ${mcpRoot} && npm install\n` +
        `Underlying error: ${err.message}`
    );
    process.exit(3);
  }
}

async function main() {
  const { url, out, mcpRoot } = parseArgs(process.argv.slice(2));
  const { chromium } = await importPlaywright(mcpRoot);

  console.log(`Opening browser at ${url}`);
  console.log(`When login is complete (you see the authenticated app),`);
  console.log(`come back here and press ENTER to save the session.`);
  console.log("");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);

  const rl = createInterface({ input: stdin, output: stdout });
  await rl.question("Press ENTER when you are signed in... ");
  rl.close();

  await mkdir(dirname(out), { recursive: true });
  await context.storageState({ path: out });

  const state = JSON.parse(
    await (await import("node:fs/promises")).readFile(out, "utf8")
  );
  const cookieCount = (state.cookies || []).length;
  const originCount = (state.origins || []).length;

  await browser.close();

  console.log("");
  console.log(`Saved storageState -> ${out}`);
  console.log(`  cookies: ${cookieCount}`);
  console.log(`  origins with storage: ${originCount}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  export A11Y_AUTH_STATE_FILE="${out}"`);
  console.log(`  # then (re)start Claude Code so the MCP subprocess inherits it`);
  console.log("");
  if (cookieCount === 0 && originCount === 0) {
    console.log(
      "WARNING: no cookies and no origin storage were captured. Either the login did"
    );
    console.log(
      "not complete or the app uses a mechanism the storageState cannot persist"
    );
    console.log("(e.g. a service worker-only token). Scans will run unauthenticated.");
    process.exit(4);
  }
}

await main();
