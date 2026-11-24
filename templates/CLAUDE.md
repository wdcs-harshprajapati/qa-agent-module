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
- `playwright.config.ts`: `workers: 1`, `fullyParallel: false`, `retries: 0`. Keep these unless the user asks for parallel runs.
- `fixtures/auth.fixture.ts` gives each project one shared tab, resets cookies and storage between tests, and restores the saved session (`.auth/`) for authenticated tests. Login happens in that same tab.
- Use one `test` object everywhere. Logged-out tests use `test.use({ authenticated: false })` inside their `describe`. A second test object forces a new worker, which opens a new tab.
- Playwright restarts the worker after a failed test, so each failure opens a new tab. This is expected.

## 5. Browsers, Headed Mode, and Artifacts
- Projects: `Chrome`, `Firefox`, `Safari` (1440x900), `Mobile Chrome` (Samsung Galaxy S25 Ultra, 412x891), `Mobile Safari` (iPhone 16 Pro, 402x874). `QA_PROJECTS` in `.env` selects which ones run.
- Tests run headed (visible browser) by default. `HEADLESS=true` in `.env` or `npm run test:headless` turns the window off.
- `SCREENSHOT` and `VIDEO` in `.env` control per-test artifacts. The shared-tab fixture records them (video through `page.screencast`), because the built-in options only cover per-test contexts.
- Only the user changes `QA_PROJECTS`, `HEADLESS`, `SCREENSHOT`, and `VIDEO`. Agents never edit them.

## 6. Bug Reports for Failed Tests
- Every test carries `description`, `precondition`, `step`, and `expected` annotations copied from `specs/test-plan.md`, and wraps actions in `test.step()` with the same wording.
- `reporters/bug-reporter.ts` turns each failed test into a Jira-ready ticket: `reports/bug-reports/<CASE-ID>__<browser>.md`, `reports/failed-test-cases.md`, and `reports/failed-test-cases.csv`.
- Confirmed defects get a `severity` annotation (`Critical`/`High`/`Medium`/`Low`) from the healer.

## 7. Reliability Lessons
- Contexts created by hand (`browser.newContext`/`newPage`) ignore the config's `testIdAttribute`. Set it with `playwright.selectors.setTestIdAttribute()` in worker fixtures.
- After a click that changes the SPA route, wait for an element of the new view inside the page object before returning. Strict-mode violations fail at once and do not retry, so they can hit the old view.
- Menus and drawers: re-click only while the menu is still closed (a retry can toggle an open menu shut). Treat "open" as the item being in the viewport. A closed `aria-hidden` menu does not match role locators.
- For form fields that can re-render right after navigation, confirm the value with `toHaveValue` and refill if it was dropped.
- Before calling something flaky, rerun it with `--repeat-each` to measure it. Do not hide flakiness.

## 8. Security Testing Scope
- Test only the target origin confirmed at intake. Never scan third-party domains.
- Non-destructive only: benign markers, no brute force, no load or DoS, no data deletion, no exploitation beyond proving a finding exists.
- Respect the write-safety answer from intake.

## 9. Bug Severity
- **Critical:** crash, data loss, authentication bypass, broken core checkout or transaction flow.
- **High:** major feature failure with no workaround, API `500` errors, session token still valid after logout or wallet disconnect.
- **Medium:** functional edge-case failure, missing input validation, `@axe-core/playwright` serious or critical violations, responsive layout collisions.
- **Low:** minor cosmetic issues, non-blocking console warnings.

## 10. Exploration Mode
- Default: Playwright MCP (the `qa` plugin's bundled `playwright` server).
- If the user approved script fallback (Run Context `Exploration: scripts`), explore and heal with local Node scripts that use the workspace's `node_modules/playwright`. Put temporary scripts in `.qa-tmp/` (git-ignored) and delete them when done.
