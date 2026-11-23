#!/usr/bin/env node
// Cross-platform launcher for the Playwright MCP server.
// Starting `npx` directly from an MCP config breaks on Windows (it needs a shell to run
// npx.cmd, and `cmd /c` added from Git Bash gets rewritten to `C:/`). Starting Node and
// letting it spawn npx avoids both problems on Windows, macOS, and Linux.
const { spawn } = require('child_process');

const isWindows = process.platform === 'win32';
const args = ['-y', '@playwright/mcp@latest', ...process.argv.slice(2)];

// On Windows npx is a .cmd file, which needs a shell. Pass one command string there
// (Node warns when args are combined with shell: true).
const child = isWindows
  ? spawn(['npx.cmd', ...args].join(' '), { stdio: 'inherit', shell: true })
  : spawn('npx', args, { stdio: 'inherit' });

child.on('error', (err) => {
  process.stderr.write(`Failed to start Playwright MCP via npx: ${err.message}\n`);
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
