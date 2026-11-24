import { test as base, expect, _android, type AndroidDevice, type BrowserContext, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Single-tab mode: every test in a worker reuses ONE browser context and ONE page (tab).
// Playwright normally opens a fresh context and page for each test, which in headed mode means a new
// window per case. Import `test` and `expect` from this file (or from a fixture that extends it)
// instead of '@playwright/test' so cases run one by one in the same tab.
//
// Per-test cleanup: extra tabs are closed, routes and page listeners are removed.
// Per-test evidence (replaces Playwright's per-context artifacts, which a shared context cannot produce):
//   screenshot  attached to each test per SCREENSHOT (on | only-on-failure | off)
//   trace       attached to each failed test (one trace chunk per test)
//   video       one recording per worker/project in test-results/session-videos/<project>/ per VIDEO
//               (a shared tab cannot give one video per test)
// Playwright restarts a worker after a failed test, so one new window can open after a failure.
//
// Mobile modes (metadata on the project in playwright.config.ts):
//   metadata.android     Chrome inside a running Android emulator (QA_MOBILE_MODE=android-emulator, adb)
//   metadata.realDevice  real device through the BrowserStack SDK (QA_MOBILE_MODE=browserstack)
// Both skip emulation options and video: the device itself provides the screen and BrowserStack records its own.

const screenshotMode = (['on', 'only-on-failure', 'off'] as const).find((v) => v === process.env.SCREENSHOT) ?? 'on';
const videoMode = (['on', 'retain-on-failure', 'off'] as const).find((v) => v === process.env.VIDEO) ?? 'on';

let workerHadFailure = false;

type WorkerFixtures = { sharedContext: BrowserContext; sharedPage: Page };
type TestFixtures = { _singleTab: void };

export const test = base.extend<TestFixtures, WorkerFixtures>({
  sharedContext: [
    async ({ browser, playwright }, use, workerInfo) => {
      const u = workerInfo.project.use;
      // Manually created contexts do not get the config's testIdAttribute; set it globally.
      if (u.testIdAttribute) playwright.selectors.setTestIdAttribute(u.testIdAttribute);
      const common = { baseURL: u.baseURL, proxy: u.proxy, ignoreHTTPSErrors: u.ignoreHTTPSErrors, acceptDownloads: true };
      const meta = workerInfo.project.metadata ?? {};
      const videoDir = path.join('test-results', 'session-videos', workerInfo.project.name.replace(/\s+/g, '-'));
      let device: AndroidDevice | undefined;
      let context: BrowserContext;

      if (meta.android) {
        // ANDROID_SERIAL picks one device when several are attached (see `adb devices`).
        const devices = await _android.devices();
        device = devices.find((d) => !process.env.ANDROID_SERIAL || d.serial() === process.env.ANDROID_SERIAL);
        if (!device) throw new Error('No Android emulator found. Start one and check `adb devices`.');
        await device.shell('am force-stop com.android.chrome');
        context = await device.launchBrowser(common);
      } else if (meta.realDevice) {
        context = await browser.newContext(common);
      } else {
        const options = Object.fromEntries(
          Object.entries({
            ...common,
            viewport: u.viewport,
            screen: u.screen,
            userAgent: u.userAgent,
            deviceScaleFactor: u.deviceScaleFactor,
            isMobile: u.isMobile,
            hasTouch: u.hasTouch,
            locale: u.locale,
            timezoneId: u.timezoneId,
            colorScheme: u.colorScheme,
            storageState: u.storageState,
          }).filter(([, v]) => v !== undefined),
        );
        context = await browser.newContext({
          ...options,
          ...(videoMode !== 'off' ? { recordVideo: { dir: videoDir, size: u.viewport ?? undefined } } : {}),
        });
      }
      await context.tracing.start({ screenshots: true, snapshots: true });
      await use(context);
      await context.close(); // finalizes the session video
      await device?.close();
      if (videoMode === 'retain-on-failure' && !workerHadFailure) fs.rmSync(videoDir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],

  sharedPage: [
    async ({ sharedContext }, use) => {
      await use(await sharedContext.newPage());
    },
    { scope: 'worker' },
  ],

  context: async ({ sharedContext }, use) => {
    await use(sharedContext);
  },

  page: async ({ sharedPage }, use) => {
    await use(sharedPage);
  },

  _singleTab: [
    async ({ sharedContext, sharedPage }, use, testInfo) => {
      await sharedContext.tracing.startChunk({ title: testInfo.title });
      await use();

      const failed = testInfo.status !== testInfo.expectedStatus;
      if (failed) workerHadFailure = true;

      if (screenshotMode === 'on' || (screenshotMode === 'only-on-failure' && failed)) {
        const file = testInfo.outputPath('screenshot.png');
        await sharedPage.screenshot({ path: file }).catch(() => undefined);
        if (fs.existsSync(file)) await testInfo.attach('screenshot', { path: file, contentType: 'image/png' });
      }

      if (failed) {
        const file = testInfo.outputPath('trace.zip');
        await sharedContext.tracing.stopChunk({ path: file }).catch(() => undefined);
        if (fs.existsSync(file)) await testInfo.attach('trace', { path: file, contentType: 'application/zip' });
      } else {
        await sharedContext.tracing.stopChunk().catch(() => undefined);
      }

      // Keep one tab: close popups, drop mocks and listeners added by the test.
      for (const other of sharedContext.pages()) if (other !== sharedPage) await other.close().catch(() => undefined);
      await sharedPage.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
      await sharedContext.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => undefined);
      sharedPage.removeAllListeners();
    },
    { auto: true },
  ],
});

export { expect };
