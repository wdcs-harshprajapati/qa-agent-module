# QA Agent Module (plugin source)

This repository is the source of the `qa` Claude Code plugin. It is also its own marketplace (`qa-agent-module`).

## If the user asks to install or set up this module
1. Check `node -v` (Node 18+ required). If missing, stop and tell the user to install Node from https://nodejs.org.
2. Run `claude plugin marketplace add wdcs-harshprajapati/qa-agent-module`. If the user wants to install from this local clone instead, use the path of this folder.
3. Run `claude plugin install qa@qa-agent-module --scope user`.
4. Run `claude plugin details qa`. Confirm it lists `run-qa`, 5 agents, 1 hook, and the `playwright` MCP server.
5. Run `claude mcp list`. If a user-level server named `playwright` exists, ask the user before removing it (`claude mcp remove playwright -s user`). The plugin brings its own (`plugin:qa:playwright`).
6. Tell the user to restart Claude Code, open an empty folder for the QA workspace, and run `/qa:run-qa <url>`.

## If the user asks to change the module
- Layout: `.claude-plugin/plugin.json` (manifest and MCP server), `.claude-plugin/marketplace.json`, `commands/run-qa.md`, `agents/*.md`, `hooks/`, `scripts/playwright-mcp.js`, `templates/`.
- Agent tool names for the bundled MCP use the prefix `mcp__plugin_qa_playwright__`.
- Refer to bundled files with `${CLAUDE_PLUGIN_ROOT}`.
- Validate with `claude plugin validate . --strict` and `claude plugin validate .claude-plugin/plugin.json --strict`. Test without installing: `claude --plugin-dir <this folder>`.
- Bump `version` in `.claude-plugin/plugin.json` for each release so users get the update.
