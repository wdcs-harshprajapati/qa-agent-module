# QA Workspace Rules

This folder is a QA workspace created by the `qa` plugin (`/qa:run-qa <url>`). These rules apply to the main session and to every QA agent (`qa:test-planner`, `qa:test-generator`, `qa:test-healer`, `qa:security-auditor`, `qa:qa-reporter`).

## 1. Never Guess
- Never invent credentials, OTPs, 2FA codes, API keys, wallet seed phrases, test data formats, or business rules.
- Main session: when anything is missing, unclear, or blocked, stop and ask the user with `AskUserQuestion`.
- Sub-agents cannot ask the user. On a login screen, OTP/2FA prompt, CAPTCHA, wallet popup, unclear expected behavior, or missing config, they stop and return exactly:
  `STATUS: NEEDS_USER_INPUT | REASON: <exact blocker> | QUESTION: <exact question for the user>`

## 2. Secrets
- Credentials, tokens, and wallet values go only in `.env` (git-ignored). Code reads them through `process.env`.
- Never write secret values into `pages/`, `fixtures/`, `tests/`, `specs/`, `reports/`, the README, or chat output.
- Never ask for or store a wallet seed phrase or private key. The user connects wallets manually.

## 3. Architecture and Code
- Default to Web2 unless the user chose Web3 at intake.
- Page Object Model: no raw `page.locator()` in `tests/*.spec.ts`. Selectors and actions live in `pages/*.page.ts`.
- Locator priority: `getByRole()` > `getByLabel()` > `getByPlaceholder()` > `getByTestId()` > `getByText()`. No XPath and no generated CSS utility classes.
- Never weaken, skip, or delete an assertion to make a test pass. If the app is wrong, keep the test failing and log a Confirmed Defect.
- Local execution only. Never create CI/CD files (GitHub Actions, GitLab CI, Jenkins, Docker).

## 4. Single-Tab Mode (Default)
- `playwright.config.ts`: `fullyParallel: false`, `retries: 0`, and `workers` from `WORKERS` in `.env` (default 1). Never raise `WORKERS`; only the user does, when they ask for parallel runs (one window per worker).
- `fixtures/shared-page.fixture.ts` (copied unchanged from the plugin) gives each worker one shared tab, attaches screenshots and failure traces, records one session video per browser project, and closes extra tabs and removes mocks and listeners after each test.
- `fixtures/auth.fixture.ts` extends it: it resets cookies and storage between tests and restores the saved session (`.auth/`) for authenticated tests. Login happens once per worker in that same tab.
- Specs import `test` and `expect` from `../fixtures/auth.fixture`, never from `@playwright/test` (only `tests/security-report.spec.ts` does). Never call `newContext()` or `newPage()`. Logged-out tests use `test.use({ authenticated: false })` inside their `describe`. A second test object forces a new worker, which opens a new tab.
- Playwright restarts the worker after a failed test, so each failure opens a new tab. This is expected.

## 5. Browsers, Headed Mode, and Artifacts
- Projects: `Chrome`, `Firefox`, `Safari` (1440x900), `Mobile Chrome` (Samsung Galaxy S25 Ultra, 412x891), `Mobile Safari` (iPhone 16 Pro, 402x874). `QA_PROJECTS` in `.env` selects which ones run.
- Tests run headed (visible browser) by default. `HEADLESS=true` in `.env` or `npm run test:headless` turns the window off.
- `SCREENSHOT` and `VIDEO` in `.env` control artifacts. The shared-page fixture records them, because the built-in options only cover per-test contexts: screenshots per test, traces on failure, and video as one recording per browser project (`test-results/session-videos/<project>/`).
- Only the user changes `QA_PROJECTS`, `HEADLESS`, `SCREENSHOT`, and `VIDEO`. Agents never edit them (the same applies to `QA_MOBILE_MODE` and `QA_ENV`).
- Mobile browsers run in one of three modes (`QA_MOBILE_MODE`): `emulation` (default screen sizes), `android-emulator` (real Chrome in an Android emulator via adb; Mobile Safari stays emulated), or `browserstack` (real devices, `npm run test:browserstack`).
- Several environments: `.env.<name>` holds each environment's `BASE_URL` and credentials, `QA_ENV` picks one. Never copy secrets between environment files.

## 6. Bug Reports, Run History, and Jira
- Every test carries `description`, `precondition`, `step`, and `expected` annotations copied from `specs/test-plan.md`, and wraps actions in `test.step()` with the same wording.
- `reporters/bug-reporter.ts` writes one Jira-ready ticket per failed test case, grouping all affected browsers: `reports/bug-reports/<CASE-ID>.md`, `reports/failed-test-cases.md`, and `reports/failed-test-cases.csv`.
- Every run is archived in `reports/runs/<run-id>/` (summary, tickets, comparison, and copies of failure screenshots, videos, and traces). `reports/run-comparison.md` lists new failures, fixed tests, still-failing tests, and unstable tests. `reports/history.json` keeps the totals of every run.
- Confirmed defects get a `severity` annotation (`Critical`/`High`/`Medium`/`Low`) from the healer.
- Jira issues are created only through the Jira (Atlassian) MCP, only after the user approves each one, and after a duplicate search. Created keys are stored in `reports/jira-issues.json`.
- Re-running failed tests (`npm run test:failed`) happens only when the user asks.

## 7. Visual, API, Performance, Mobile UX, and Secrets
- `@visual`: `toHaveScreenshot` against baselines in `tests/__screenshots__/`. Comparison is strict; mask dynamic areas. Never refresh baselines to make a test pass; refresh (`npm run test:update-baselines`) only after the user confirms an intended UI change.
- `@api`: `page.request` calls from `specs/api-inventory.md`, run once per run (first selected project). Only `GET` unless write actions are allowed; never `DELETE`.
- `@perf`: Web Vitals (LCP, CLS, FCP, TTFB) in one desktop Chromium project; only "poor" values fail. Local lab numbers: use them for trends, not as field data.
- `@mobile-ux`: tap targets, horizontal scroll, text size, input zoom on mobile projects. Medium issues fail; Low issues are reported.
- Exposed secrets: the security audit runs `scripts/secret-scan.mjs` from the plugin (GET only, target origin only). Findings are always redacted.
- OTP/verification emails: only through MailSlurp (`fixtures/mail.helper.ts`) when the user chose it. The user types the MailSlurp key into `.env`.

## 8. Reliability Lessons
- Contexts created by hand (`browser.newContext`/`newPage`) ignore the config's `testIdAttribute`. Set it with `playwright.selectors.setTestIdAttribute()` in worker fixtures.
- After a click that changes the SPA route, wait for an element of the new view inside the page object before returning. Strict-mode violations fail at once and do not retry, so they can hit the old view.
- Menus and drawers: re-click only while the menu is still closed (a retry can toggle an open menu shut). Treat "open" as the item being in the viewport. A closed `aria-hidden` menu does not match role locators.
- For form fields that can re-render right after navigation, confirm the value with `toHaveValue` and refill if it was dropped.
- Before calling something flaky, rerun it with `--repeat-each` to measure it. Do not hide flakiness.

## 9. Security Testing Scope
- Test only the target origin confirmed at intake. Never scan third-party domains.
- Non-destructive only: benign markers, no brute force, no load or DoS, no data deletion, no exploitation beyond proving a finding exists.
- Respect the write-safety answer from intake.

## 10. Security Results in the HTML Report
- `qa:security-auditor` writes `reports/security-findings.md` and `reports/security-findings.json` (array of `SEC-xx` findings with status, risk, evidence, remediation).
- `tests/security-report.spec.ts` (from the plugin templates, never edited) turns each finding into a test in the browserless `Security` project of `playwright.config.ts`, which exists only when the JSON file exists. Pass is green, Fail is red with a `severity` annotation (so it gets a bug report), Not Tested is skipped with its reason. `SEC-00` attaches the overview.
- `qa:test-healer` never heals, edits, or skips `SEC-*` failures: they are security findings, not test problems.
- `npm run report` opens one HTML report with every browser project and the `Security` project.

## 11. Bug Severity
- **Critical:** crash, data loss, authentication bypass, broken core checkout or transaction flow.
- **High:** major feature failure with no workaround, API `500` errors, session token still valid after logout or wallet disconnect.
- **Medium:** functional edge-case failure, missing input validation, `@axe-core/playwright` serious or critical violations, responsive layout collisions.
- **Low:** minor cosmetic issues, non-blocking console warnings.

## 12. Exploration Mode
- Default: Playwright MCP (the `qa` plugin's bundled `playwright` server).
- If the user approved script fallback (Run Context `Exploration: scripts`), explore and heal with local Node scripts that use the workspace's `node_modules/playwright`. Put temporary scripts in `.qa-tmp/` (git-ignored) and delete them when done.
