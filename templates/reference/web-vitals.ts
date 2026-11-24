/**
 * REFERENCE helper for @perf tests. test-generator copies it to fixtures/web-vitals.ts unchanged.
 *
 * Measures lab Web Vitals for the page that is currently open (call it right after navigation):
 * LCP, CLS, FCP, TTFB. INP needs real user input and is not measured.
 * Results are attached as 'web-vitals' so reporters/bug-reporter.ts writes reports/performance.md.
 * Only "poor" values fail (soft assertions); "needs improvement" is reported only.
 *
 * Usage:
 *   test('PERF-01: home page loads fast', async ({ page }, testInfo) => {
 *     test.skip(!isPerfProject(testInfo), 'Performance is measured in one desktop Chromium project');
 *     await page.goto('/');
 *     await measureWebVitals(page, testInfo, 'Home');
 *   });
 */
import { expect, type Page, type TestInfo } from '@playwright/test';

type Metric = 'lcp' | 'cls' | 'fcp' | 'ttfb';
export type WebVitals = Record<Metric, number | null> & { label: string; url: string; rating: string };

// Google thresholds: [good, poor]. Values above "poor" fail the test.
export const THRESHOLDS: Record<Metric, [number, number]> = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
};

/** LCP and CLS are only reported by Chromium. Measure in the first selected Chromium project (desktop first). */
export function isPerfProject(testInfo: TestInfo): boolean {
  const chromium = testInfo.config.projects.filter(
    (p) => (p.use.browserName ?? p.use.defaultBrowserType ?? 'chromium') === 'chromium' && !p.metadata?.android && !p.metadata?.realDevice,
  );
  const preferred = chromium.find((p) => !p.use.isMobile) ?? chromium[0];
  return preferred?.name === testInfo.project.name;
}

export async function measureWebVitals(page: Page, testInfo: TestInfo, label: string): Promise<WebVitals> {
  await page.waitForLoadState('load');
  const values = await page.evaluate(
    () =>
      new Promise<Record<string, number | null>>((resolve) => {
        const result: Record<string, number | null> = { lcp: null, cls: null, fcp: null, ttfb: null };
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        if (nav) result.ttfb = nav.responseStart;
        const supported = PerformanceObserver.supportedEntryTypes;
        if (supported.includes('paint')) {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) if (e.name === 'first-contentful-paint') result.fcp = e.startTime;
          }).observe({ type: 'paint', buffered: true });
        }
        if (supported.includes('largest-contentful-paint')) {
          new PerformanceObserver((list) => {
            for (const e of list.getEntries()) result.lcp = e.startTime;
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        }
        if (supported.includes('layout-shift')) {
          result.cls = 0;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
              if (!e.hadRecentInput) result.cls = (result.cls ?? 0) + e.value;
            }
          }).observe({ type: 'layout-shift', buffered: true });
        }
        // Let buffered entries and late layout shifts arrive.
        setTimeout(() => resolve(result), 1500);
      }),
  );

  const ratings = (Object.keys(THRESHOLDS) as Metric[]).map((m) => {
    const v = values[m];
    if (v === null) return 'n/a';
    return v <= THRESHOLDS[m][0] ? 'good' : v <= THRESHOLDS[m][1] ? 'needs improvement' : 'poor';
  });
  const rating = ratings.includes('poor') ? 'poor' : ratings.includes('needs improvement') ? 'needs improvement' : 'good';
  const vitals = { ...(values as Record<Metric, number | null>), label, url: page.url(), rating };

  await testInfo.attach('web-vitals', { body: JSON.stringify(vitals), contentType: 'application/json' });
  for (const m of Object.keys(THRESHOLDS) as Metric[]) {
    const v = vitals[m];
    if (v !== null) expect.soft(v, `${label}: ${m.toUpperCase()} is poor`).toBeLessThanOrEqual(THRESHOLDS[m][1]);
  }
  return vitals;
}
