#!/usr/bin/env node
// PostToolUse hook: runs `tsc --noEmit` after a .ts file is written or edited,
// but only inside QA workspaces (playwright.config.ts + tsconfig.json + local typescript).
// Exit code 2 feeds the type errors back to Claude so it fixes them immediately.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {
    process.exit(0);
  }

  const file = (data.tool_input && data.tool_input.file_path) || '';
  if (!file.endsWith('.ts')) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd();
  const isQaWorkspace =
    fs.existsSync(path.join(root, 'playwright.config.ts')) &&
    fs.existsSync(path.join(root, 'tsconfig.json'));
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!isQaWorkspace || !fs.existsSync(tsc)) process.exit(0);

  const result = spawnSync(process.execPath, [tsc, '--noEmit', '-p', root], { cwd: root, encoding: 'utf8' });
  if (result.status === 0) process.exit(0);

  process.stderr.write(`TypeScript errors after editing ${file}:\n${result.stdout}${result.stderr}`);
  process.exit(2);
});
