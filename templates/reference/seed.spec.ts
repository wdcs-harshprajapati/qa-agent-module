/**
 * REFERENCE seed test. test-generator copies it to tests/seed.spec.ts.
 *
 * The Playwright Test MCP server (plugin:qa:playwright-test) runs this test to open a page with
 * the suite's own fixtures: the shared tab, state reset, and the restored login session. The
 * generator and healer then explore and record from that exact state (generator_setup_page,
 * test_debug). Keep it empty; it always passes.
 */
import { test } from '../fixtures/auth.fixture';

test.describe('Seed', () => {
  test('seed', async ({ page }) => {
    // The fixture has opened the shared tab and restored the session. Generated steps start here.
    void page;
  });
});
