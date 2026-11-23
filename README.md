# QA Agent Module for Claude Code

Give Claude Code a URL. It explores the site, writes a test plan for you to approve, generates a Playwright + TypeScript suite (Page Object Model), runs it, fixes broken tests without hiding real bugs, runs a non-destructive security audit, and writes a QA report.

```
/qa:run-qa https://your-app.example.com
```

## What You Need

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (CLI, desktop app, or IDE extension). The claude.ai web chat cannot run this.
- [Node.js](https://nodejs.org) 18 or newer.
- Google Chrome (used by the Playwright MCP browser). If it is missing, Claude can install a browser through the MCP `browser_install` tool.

## Install

### Option A: Let Claude Do It (Recommended)

Open Claude Code in any folder and paste this:

```text
Install the QA Agent Module plugin from https://github.com/wdcs-harshprajapati/qa-agent-module for me:
1. Check that Node.js 18+ is installed (node -v). If not, stop and tell me how to install it.
2. Run: claude plugin marketplace add wdcs-harshprajapati/qa-agent-module
3. Run: claude plugin install qa@qa-agent-module --scope user
4. Run: claude plugin details qa  and confirm it lists run-qa, 5 agents, 1 hook and the playwright MCP server.
5. If I already have a user-level MCP server named "playwright" (claude mcp list), ask me whether to remove it, because the plugin brings its own.
6. Tell me to restart Claude Code, then run /qa:run-qa <my-url>.
```

### Option B: Slash Commands

Inside Claude Code:

```text
/plugin marketplace add wdcs-harshprajapati/qa-agent-module
/plugin install qa@qa-agent-module
```

### Option C: Terminal

```bash
claude plugin marketplace add wdcs-harshprajapati/qa-agent-module
claude plugin install qa@qa-agent-module --scope user
```

Restart Claude Code after installing. Then check `/mcp`: it should list `plugin:qa:playwright` as connected. The first start downloads `@playwright/mcp`, which can take a minute.

## Use It

1. Create an empty folder for the QA workspace and open Claude Code there.
2. Run `/qa:run-qa https://your-app.example.com`.
3. Answer the intake questions: Web2 or Web3, login details, test data, and whether write actions (forms, orders) are safe.
4. Review the test plan Claude shows you. Approve it or ask for changes. No code is generated before you approve.
5. Claude generates the suite, runs it, heals test issues, runs the security audit, and writes the report.

Claude never guesses credentials, OTPs, or business rules. When something is missing, it asks you.

## What You Get

```
your-workspace/
├── CLAUDE.md               # QA rules for this workspace (read by Claude automatically)
├── .env / .env.example     # BASE_URL and credentials (.env is git-ignored)
├── playwright.config.ts    # Desktop Chrome + Mobile Safari, single-tab mode
├── specs/test-plan.md      # Approved plan: UI-xx, POS-xx, NEG-xx cases
├── pages/*.page.ts         # Page objects (all selectors live here)
├── fixtures/auth.fixture.ts# Shared tab, state reset, saved login session
├── tests/*.spec.ts         # Positive Cases / Negative Cases specs
├── reports/
│   ├── qa-report-latest.md # Summary, coverage, defects, security
│   ├── healing-log.md      # What was fixed, what is a real defect
│   └── security-findings.md
└── README.md               # Runbook for the generated suite
```

Run the generated suite without Claude:

```bash
npm test               # all tests, one tab per browser
npm run test:headed    # watch the browser
npm run test:ui        # Playwright UI mode
npm run report         # HTML report with screenshots and traces
```

## How It Works

| Component | Role |
|---|---|
| `/qa:run-qa` | Orchestrator: preflight, intake, workspace setup, plan approval gate, delegation, final summary |
| `qa:test-planner` | Explores the site (desktop and mobile), finds console/network/a11y issues, writes `specs/test-plan.md` |
| `qa:test-generator` | Builds page objects, the single-tab fixture, and typed specs from the approved plan |
| `qa:test-healer` | Runs the suite, fixes locator and timing issues in page objects, keeps real defects failing |
| `qa:security-auditor` | Non-destructive checks: sessions, cookies, headers, encoding, access control (target origin only) |
| `qa:qa-reporter` | Writes `reports/qa-report-latest.md` and the workspace `README.md` |
| Hook | Runs `tsc --noEmit` after each `.ts` edit in a QA workspace and feeds errors back to Claude |
| MCP | Bundled Playwright MCP server (`plugin:qa:playwright`), started through a cross-platform Node launcher |

### Defaults

- **Web2** unless you choose Web3. For Web3 you connect the wallet yourself; Claude never asks for a seed phrase or private key.
- **Single-tab mode:** all cases run in order in one browser tab per project. A failed test opens a new tab, because Playwright restarts its worker after a failure.
- **No bug masking:** assertions are never weakened to make tests pass.
- **Secrets only in `.env`**, never in code, reports, or chat.
- **Local only:** no CI/CD files are generated.
- **Script fallback:** if the Playwright MCP server cannot connect, Claude asks whether to explore and heal with local Playwright scripts instead.

## Update and Uninstall

```bash
claude plugin marketplace update qa-agent-module
claude plugin update qa@qa-agent-module
claude plugin uninstall qa@qa-agent-module
```

## Troubleshooting

| Problem | Fix |
|---|---|
| `/qa:run-qa` not found | Restart Claude Code after installing. Check `claude plugin list`. |
| `plugin:qa:playwright` not connected | Run `/mcp` and reconnect it. Check `node -v` (18+). The first start downloads `@playwright/mcp` and may be slow. |
| Two `playwright` MCP servers | A user-level `playwright` server from an older setup also exists. Remove it with `claude mcp remove playwright -s user`. |
| Browser not found | Install Google Chrome, or ask Claude to run the MCP `browser_install` tool. |
| `BASE_URL is not set` | Copy `.env.example` to `.env` in the workspace and fill in the values. |
