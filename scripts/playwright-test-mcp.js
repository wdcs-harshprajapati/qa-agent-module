#!/usr/bin/env node
// Launcher for Playwright's own Test MCP server (`playwright run-test-mcp-server`), which gives the
// QA agents the official test tools: test_run, test_debug, test_list, generator_setup_page,
// browser_generate_locator, and more.
//
// The server must run with the workspace's own Playwright, so it only starts inside a QA
// workspace (a folder with playwright.config.ts and node_modules/playwright). Before /qa:run-qa
// has created the workspace it exits with a message; reconnect it with /mcp afterwards.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const cli = path.join(root, 'node_modules', 'playwright', 'cli.js');

if (!fs.existsSync(path.join(root, 'playwright.config.ts')) || !fs.existsSync(cli)) {
  process.stderr.write(
    `playwright-test MCP: ${root} is not a QA workspace yet (needs playwright.config.ts and npm install). ` +
      'Run /qa:run-qa first, then reconnect "plugin:qa:playwright-test" with /mcp.\n',
  );
  process.exit(1);
}

const child = spawn(process.execPath, [cli, 'run-test-mcp-server', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });

child.on('error', (err) => {
  process.stderr.write(`Failed to start the Playwright Test MCP server: ${err.message}\n`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
