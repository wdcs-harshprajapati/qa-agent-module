/**
 * REFERENCE helper for @mobile-ux tests. test-generator copies it to fixtures/mobile-ux.ts unchanged.
 *
 * Audits the page that is currently open on a mobile project:
 * - viewport-meta     (Medium) no <meta name="viewport" content="width=device-width ...">
 * - horizontal-scroll (Medium) page is wider than the screen
 * - tap-target        (Medium) control smaller than 24x24 CSS px (WCAG 2.5.8 AA)
 *                     (Low)    control smaller than 44x44 CSS px (Apple HIG, WCAG 2.5.5 AAA)
 * - small-text        (Low)    visible text under 12px
 * - input-zoom        (Low)    input font under 16px (iOS Safari zooms in on focus)
 * Results are attached as 'mobile-ux' so reporters/bug-reporter.ts writes reports/mobile-ux.md.
 * Medium issues fail the test; Low issues are reported only.
 *
 * Usage:
 *   test('MUX-01: home page is usable on phones', async ({ page }, testInfo) => {
 *     test.skip(!testInfo.project.use.isMobile && !testInfo.project.metadata?.android && !testInfo.project.metadata?.realDevice, 'Mobile projects only');
 *     await page.goto('/');
 *     await auditMobileUx(page, testInfo, 'Home');
 *   });
 */
import { expect, type Page, type TestInfo } from '@playwright/test';

export type MobileUxIssue = { rule: string; severity: 'Medium' | 'Low'; detail: string };

export async function auditMobileUx(page: Page, testInfo: TestInfo, label: string): Promise<MobileUxIssue[]> {
  await page.waitForLoadState('load');
  const issues = await page.evaluate(() => {
    const found: { rule: string; severity: 'Medium' | 'Low'; detail: string }[] = [];
    const describe = (el: Element) => {
      const name = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.getAttribute('placeholder') || '').trim().slice(0, 40);
      return `<${el.tagName.toLowerCase()}>${name ? ` "${name}"` : ''}`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0;
    };

    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta || !/width\s*=\s*device-width/.test(meta.getAttribute('content') ?? '')) {
      found.push({ rule: 'viewport-meta', severity: 'Medium', detail: 'Missing <meta name="viewport" content="width=device-width, initial-scale=1">' });
    }

    const width = document.documentElement.scrollWidth;
    if (width > window.innerWidth + 1) {
      found.push({ rule: 'horizontal-scroll', severity: 'Medium', detail: `Page is ${width}px wide on a ${window.innerWidth}px screen` });
    }

    const controls = document.querySelectorAll(
      'a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [role="menuitem"]',
    );
    let small = 0;
    for (const el of Array.from(controls)) {
      if (!visible(el)) continue;
      // WCAG exception: links inside a sentence or paragraph.
      if (el.tagName === 'A' && el.closest('p, li') && (el.closest('p, li') as HTMLElement).innerText.trim().length > (el as HTMLElement).innerText.trim().length + 20) continue;
      const r = el.getBoundingClientRect();
      const size = `${Math.round(r.width)}x${Math.round(r.height)}px`;
      if (r.width < 24 || r.height < 24) {
        if (small++ < 15) found.push({ rule: 'tap-target', severity: 'Medium', detail: `${describe(el)} is ${size} (minimum 24x24)` });
      } else if (r.width < 44 || r.height < 44) {
        if (small++ < 15) found.push({ rule: 'tap-target', severity: 'Low', detail: `${describe(el)} is ${size} (recommended 44x44)` });
      }
    }

    let tiny = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    while (walker.nextNode() && tiny < 10) {
      const parent = walker.currentNode.parentElement;
      if (!parent || seen.has(parent) || !walker.currentNode.textContent?.trim() || !visible(parent)) continue;
      seen.add(parent);
      const px = parseFloat(getComputedStyle(parent).fontSize);
      if (px < 12) {
        tiny++;
        found.push({ rule: 'small-text', severity: 'Low', detail: `${describe(parent)} uses ${px}px text` });
      }
    }

    for (const el of Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), select, textarea'))) {
      if (!visible(el)) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 16) found.push({ rule: 'input-zoom', severity: 'Low', detail: `${describe(el)} uses ${px}px text (iOS zooms in below 16px)` });
    }
    return found;
  });

  await testInfo.attach('mobile-ux', { body: JSON.stringify({ label, url: page.url(), issues }), contentType: 'application/json' });
  const blocking = issues.filter((i) => i.severity === 'Medium');
  expect(blocking, `${label}: mobile UX issues\n${blocking.map((i) => `- ${i.rule}: ${i.detail}`).join('\n')}`).toEqual([]);
  return issues;
}
