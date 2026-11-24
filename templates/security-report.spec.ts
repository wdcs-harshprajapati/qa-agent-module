import { test, expect } from '@playwright/test';
import fs from 'fs';

// Shows the security-auditor results inside Playwright's HTML report (npm run report).
// Runs only in the "Security" project of playwright.config.ts, which is added when
// reports/security-findings.json exists. No browser is opened.
//
// security-auditor writes reports/security-findings.json: an array of
//   { id: 'SEC-01', title, check, status: 'Pass' | 'Fail' | 'Not Tested', risk: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info',
//     affected, evidence (redacted), remediation, reason? (required when Not Tested) }
// Pass = green test, Fail = red test (and a bug report), Not Tested = skipped with the reason.

type Finding = {
  id: string;
  title: string;
  check?: string;
  status: 'Pass' | 'Fail' | 'Not Tested';
  risk: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  affected?: string;
  evidence?: string;
  remediation?: string;
  reason?: string;
};

const FINDINGS_FILE = 'reports/security-findings.json';
const MARKDOWN_FILE = 'reports/security-findings.md';
const findings: Finding[] = fs.existsSync(FINDINGS_FILE) ? JSON.parse(fs.readFileSync(FINDINGS_FILE, 'utf8')) : [];

const details = (f: Finding) =>
  [
    `# ${f.id}: ${f.title}`,
    '',
    `- Check: ${f.check ?? 'n/a'}`,
    `- Status: ${f.status}`,
    `- Risk: ${f.risk}`,
    `- Affected: ${f.affected ?? 'n/a'}`,
    ...(f.reason ? [`- Reason: ${f.reason}`] : []),
    '',
    '## Evidence (redacted)',
    f.evidence ?? 'None recorded.',
    '',
    '## Remediation',
    f.remediation ?? 'None recorded.',
    '',
  ].join('\n');

test.describe('Security Audit', () => {
  test('SEC-00: Security audit overview', async ({}, testInfo) => {
    const count = (status: Finding['status']) => findings.filter((f) => f.status === status).length;
    const rows = findings.map((f) => `| ${f.id} | ${f.title} | ${f.status} | ${f.risk} | ${f.affected ?? ''} |`);
    const overview = [
      '# Security audit overview',
      '',
      `Checks: ${findings.length} | Pass: ${count('Pass')} | Fail: ${count('Fail')} | Not Tested: ${count('Not Tested')}`,
      '',
      '| ID | Check | Status | Risk | Affected |',
      '|----|-------|--------|------|----------|',
      ...rows,
      '',
    ].join('\n');
    await testInfo.attach('security-overview.md', { body: overview, contentType: 'text/markdown' });
    if (fs.existsSync(MARKDOWN_FILE)) await testInfo.attach('security-findings.md', { path: MARKDOWN_FILE, contentType: 'text/markdown' });
    expect(findings.length, `${FINDINGS_FILE} has no findings`).toBeGreaterThan(0);
  });

  for (const f of findings) {
    const severity = f.risk === 'Info' ? [] : [{ type: 'severity', description: f.risk }];
    test(
      `${f.id}: ${f.title} [${f.risk}]`,
      {
        annotation: [
          { type: 'description', description: `${f.check ?? 'Security check'}: ${f.title}. Affected: ${f.affected ?? 'n/a'}.` },
          { type: 'step', description: 'Run the non-destructive security check described in reports/security-findings.md.' },
          { type: 'expected', description: f.remediation ? `Check passes. Fix: ${f.remediation}` : 'Check passes.' },
          ...severity,
        ],
      },
      async ({}, testInfo) => {
        await testInfo.attach('finding.md', { body: details(f), contentType: 'text/markdown' });
        test.skip(f.status === 'Not Tested', f.reason ?? 'Not tested');
        expect(f.status, `${f.risk} risk: ${f.title}\nAffected: ${f.affected ?? 'n/a'}\nEvidence: ${f.evidence ?? 'n/a'}\nFix: ${f.remediation ?? 'n/a'}`).toBe('Pass');
      },
    );
  }
});
