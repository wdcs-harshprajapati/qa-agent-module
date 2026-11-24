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
   At intake Claude also asks whether the app has several environments (dev, staging, production) and whether login sends OTP or verification emails (optionally read automatically through MailSlurp, free for 500 emails a month).
5. Choose the run settings: which browsers to test (Chrome, Firefox, Safari, Mobile Chrome, Mobile Safari), whether screenshots and video are recorded for every test, only on failure, or not at all, and how mobile browsers run: emulation (default screen sizes), BrowserStack real devices, or an Android emulator from the Android SDK.
6. Claude generates the suite (functional, visual, API, performance, and mobile UX tests), runs it in a visible browser, heals test issues, runs the security audit (including an exposed-secret scan), and writes the report.
7. If tests failed, Claude asks whether to file the defects in Jira through the Atlassian MCP (or only show Jira-style issues), and whether to re-run only the failed tests.

Claude never guesses credentials, OTPs, or business rules. When something is missing, it asks you.

## What You Get

```
your-workspace/
├── CLAUDE.md               # QA rules for this workspace (read by Claude automatically)
├── .env / .env.example     # BASE_URL, credentials, browsers, screenshot/video settings (.env is git-ignored)
├── playwright.config.ts    # 5 browser projects, headed, single-tab mode
├── specs/test-plan.md      # Approved plan: UI-xx, POS-xx, NEG-xx cases
├── pages/*.page.ts         # Page objects (all selectors live here)
├── fixtures/shared-page.fixture.ts # Single-tab fixture (copied from the plugin, unchanged)
├── fixtures/auth.fixture.ts# Extends it: state reset, saved login session
├── specs/api-inventory.md  # API calls seen while exploring (no values)
├── tests/*.spec.ts         # Positive/Negative, @visual, @api, @perf, @mobile-ux specs
├── tests/security-report.spec.ts # Shows security findings in the HTML report (from the plugin, unchanged)
├── tests/__screenshots__/  # Visual regression baselines
├── reporters/bug-reporter.ts # Writes a Jira-ready bug report for each failed test
├── reports/
│   ├── qa-report-latest.md # Summary, coverage, defects, security
│   ├── failed-test-cases.md  # All failed tests: description, steps, expected, actual
│   ├── failed-test-cases.csv # Jira "Import issues from CSV"
│   ├── bug-reports/        # One ticket per failed test case (all affected browsers)
│   ├── run-comparison.md   # New failures, fixed, still failing vs earlier runs
│   ├── history.json        # Totals of every run
│   ├── performance.md      # Web Vitals per page
│   ├── mobile-ux.md        # Mobile UX issues
│   ├── secret-scan.json    # Exposed secrets and files (redacted)
│   ├── runs/<run-id>/      # Archive of each run with screenshots, videos, traces
│   ├── healing-log.md      # What was fixed, what is a real defect
│   ├── security-findings.md
│   └── security-findings.json # Same findings as data; becomes the Security project in the HTML report
├── playwright-report/      # HTML report: browser projects and the Security project
└── README.md               # Runbook for the generated suite
```

Run the generated suite without Claude:

```bash
npm test               # all tests in the browsers from .env, headed, one tab per browser
npm run test:headless  # no browser window
npm run test:desktop   # Chrome, Firefox, Safari
npm run test:mobile    # Mobile Chrome (Galaxy S25 Ultra), Mobile Safari (iPhone 16 Pro)
npm run test:failed    # only the tests that failed last time
npm run test:visual    # visual regression (refresh baselines: npm run test:update-baselines)
npm run test:api       # API tests; also test:perf and test:mobile-ux
npm run test:ui        # Playwright UI mode
npm run report         # HTML report with screenshots, traces, and security results
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
- **Browsers:** Chrome, Firefox, Safari (1440x900), Mobile Chrome (Samsung Galaxy S25 Ultra, 412x891), and Mobile Safari (iPhone 16 Pro, 402x874). You pick which ones after approving the plan.
- **Headed:** tests run in a visible browser. Set `HEADLESS=true` in `.env` or use `npm run test:headless` to hide it.
- **Screenshots and video:** on for every test by default; you can choose only-on-failure or off.
- **Bug reports:** one Jira-ready ticket per failed test case (description, preconditions, steps, expected, actual per browser, environment, attachments) in `reports/bug-reports/`, plus `reports/failed-test-cases.csv` for Jira CSV import. With the Atlassian MCP connected, Claude can create the Jira issues for you after your approval.
- **Run history:** every run is archived in `reports/runs/`, and `reports/run-comparison.md` shows what is new, fixed, still failing, or unstable.
- **Mobile modes:** emulation by default; real devices on BrowserStack (account needed) or real Chrome in an Android emulator (Android SDK). iOS simulators are not supported by Playwright.
- **More checks:** visual regression, API tests from the endpoints seen while exploring, Web Vitals on key pages (only "poor" values fail), mobile UX (tap targets, horizontal scroll, text size), and an exposed-secret scan in the security audit.
- **Playwright Test MCP:** the plugin also starts Playwright's own Test MCP server (`plugin:qa:playwright-test`) inside a QA workspace, so the generator and healer can debug tests at the exact failure point. Reconnect it with `/mcp` after the first scaffold.
- **Single-tab mode:** all cases run one by one in one browser tab per project (`WORKERS` defaults to 1). See [Single tab](#single-tab).
- **Security in the HTML report:** security-auditor findings show up next to the browser results. See [One HTML report with security results](#one-html-report-with-security-results).
- **No bug masking:** assertions are never weakened to make tests pass.
- **Secrets only in `.env`**, never in code, reports, or chat.
- **Local only:** no CI/CD files are generated.
- **Script fallback:** if the Playwright MCP server cannot connect, Claude asks whether to explore and heal with local Playwright scripts instead.

## Single tab

Cases run strictly one by one in one browser tab per browser project. Playwright normally opens a new window for every test; this module avoids that.

| File | Role |
|---|---|
| `templates/playwright.config.ts` | `WORKERS` from `.env` (default 1), `fullyParallel: false`, `retries: 0`. Built-in `screenshot`, `video`, and `trace` are `off` because the fixture handles them. |
| `templates/shared-page.fixture.ts` | Copied to `fixtures/` unchanged. Worker-scoped `sharedContext` and `sharedPage` replace the built-in `context` and `page`, so every test in a worker shares one tab. After each test it closes extra tabs, removes `page.route()` mocks and listeners, attaches a screenshot (`SCREENSHOT`), and attaches a trace only when the test failed. |
| `templates/reference/auth.fixture.ts` | The generator adapts it to `fixtures/auth.fixture.ts`. It extends the shared `test`, resets cookies and storage between tests, and logs in once per worker (state saved under `.auth/`). |

Specs import `test` and `expect` from `fixtures/auth.fixture`, never from `@playwright/test`, and never create contexts or pages. Parallel runs happen only when you ask: Claude writes `WORKERS=<n>` to `.env` and warns that each worker opens its own window.

Known limits:

- Playwright kills the worker after any failed test, so one new window opens after each failure. This is Playwright's behavior and is accepted.
- Video is one recording per browser project (`test-results/session-videos/<project>/`), not one per test, because a shared tab has one recording.

## One HTML report with security results

`qa:security-auditor` writes `reports/security-findings.md` and `reports/security-findings.json` (an array of `SEC-xx` findings with status, risk, affected, redacted evidence, remediation, and a reason for Not Tested). `tests/security-report.spec.ts` (copied from `templates/security-report.spec.ts`, never edited) turns them into tests in a browserless `Security` project that `playwright.config.ts` adds only when the JSON file exists:

- **Pass** shows green.
- **Fail** shows red with a severity annotation, so `reporters/bug-reporter.ts` files a bug report for it too.
- **Not Tested** is skipped with the reason.
- `SEC-00` attaches the overview and the findings markdown.

Order in `/qa:run-qa`: generator, security-auditor, test-healer (its final run includes `Security`), qa-reporter. The healer never heals `SEC-*` failures, because they are security findings. Run `npm run report` to see browser results and security results in one report.

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
| `QA_PROJECTS has unknown project(s)` | Use only `all`, `Chrome`, `Firefox`, `Safari`, `Mobile Chrome`, `Mobile Safari` in `.env`. |
| Firefox or Safari browser missing | Run `npm run setup` in the workspace. |
| `plugin:qa:playwright-test` failed to connect | Normal before the workspace exists. After `/qa:run-qa` has run `npm install`, reconnect it with `/mcp`. |
| Android emulator: `sharedContext` timeout | Chrome is not reading Playwright's command line. Run `adb shell am set-debug-app --persistent com.android.chrome` (or enable "Enable command line on non-rooted devices" in the emulator's `chrome://flags`) and dismiss Chrome's first-run screens. For a `localhost` app run `adb reverse tcp:<port> tcp:<port>`. |
| `QA_ENV is "x" but .env.x does not exist` | Create `.env.x` with that environment's `BASE_URL`, or fix `QA_ENV` in `.env`. |
| A `@visual` test fails after an intended UI change | Review the diff image in the bug report, then run `npm run test:update-baselines`. |
