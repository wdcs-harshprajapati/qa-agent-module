import fs from 'fs';
import path from 'path';
import type { FullConfig, Reporter, Suite, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

// Writes Jira-ready bug reports, a run archive, and a comparison with the previous run.
//
// Every run (one folder per run, kept for QA_KEEP_RUNS runs, default 20):
//   reports/runs/<run-id>/summary.json          outcome of every test in every browser project
//   reports/runs/<run-id>/bug-reports/<ID>.md   one ticket per failed test case, all browsers grouped
//   reports/runs/<run-id>/failed-test-cases.md  all tickets in one file
//   reports/runs/<run-id>/failed-test-cases.csv Jira CSV import (one row per test case)
//   reports/runs/<run-id>/run-comparison.md     new failures, fixed, still failing vs the previous run
//   reports/runs/<run-id>/performance.md        Web Vitals per page (from 'web-vitals' attachments)
//   reports/runs/<run-id>/mobile-ux.md          mobile UX issues (from 'mobile-ux' attachments)
//   reports/runs/<run-id>/attachments/          screenshots, videos, traces of failed tests
// Latest copies of the files above are also written to reports/ (replaced on every run),
// and reports/history.json keeps one line of totals per run.
//
// Ticket content comes from test annotations written by test-generator:
//   description, precondition, step (one per step, in order), expected, severity (optional)
// Jira keys created by /qa:run-qa are read from reports/jira-issues.json and shown on tickets.

type Outcome = 'passed' | 'failed' | 'skipped' | 'flaky';

type BrowserFailure = {
  project: string;
  device: string;
  browser: string;
  viewport: string;
  failedStep: string;
  actual: string;
  attachments: string[];
};

type Ticket = {
  caseId: string;
  fileName: string;
  title: string;
  summary: string;
  description: string;
  preconditions: string[];
  steps: string[];
  expected: string;
  severity: string;
  spec: string;
  failures: BrowserFailure[];
  passedIn: string[];
  jira?: { key: string; url?: string };
};

type TestRecord = { key: string; caseId: string; title: string; project: string; device: string; outcome: Outcome; durationMs: number };

type Summary = {
  runId: string;
  startedAt: string;
  environment: string;
  baseURL: string;
  projects: string[];
  totals: Record<Outcome | 'total', number>;
  tests: TestRecord[];
};

const REPORTS = 'reports';
const RUNS = path.join(REPORTS, 'runs');
const CASE_ID = /^([A-Z]+(?:-[A-Z]+)*-\d+)/;

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');
const slug = (text: string) => text.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const csvCell = (text: string) => `"${text.replace(/"/g, '""')}"`;
const rel = (p: string) => path.relative(process.cwd(), p).split(path.sep).join('/');
const list = (items: string[], ordered = false) =>
  items.length ? items.map((s, i) => `${ordered ? `${i + 1}.` : '-'} ${s}`).join('\n') : '- None';

function annotations(test: TestCase, type: string): string[] {
  return test.annotations.filter((a) => a.type === type && a.description).map((a) => a.description as string);
}

function userSteps(steps: TestStep[]): TestStep[] {
  return steps.flatMap((s) => (s.category === 'test.step' ? [s, ...userSteps(s.steps)] : userSteps(s.steps)));
}

function failingStep(steps: TestStep[]): string {
  for (const step of steps) {
    if (step.category !== 'test.step' || !step.error) continue;
    return failingStep(step.steps) || step.title;
  }
  return '';
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

class BugReporter implements Reporter {
  private root?: Suite;
  private config?: FullConfig;
  private startedAt = new Date();

  onBegin(config: FullConfig, suite: Suite) {
    this.config = config;
    this.root = suite;
    this.startedAt = new Date();
  }

  onEnd() {
    if (!this.root) return;
    const tests = this.root.allTests();
    if (!tests.some((t) => t.results.length)) return; // e.g. --list

    const runId = this.startedAt.toISOString().replace(/[:T]/g, '-').replace(/\..+$/, '');
    const runDir = path.join(RUNS, runId);
    fs.mkdirSync(runDir, { recursive: true });

    const previous = this.previousSummary(runId);
    const summary = this.summary(runId, tests);
    const tickets = this.tickets(tests, runDir);

    fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
    this.writeTickets(runDir, tickets, summary);
    fs.writeFileSync(path.join(runDir, 'run-comparison.md'), this.comparison(summary, previous));
    this.writeAudit(runDir, tests, 'web-vitals', 'performance.md', (rows) => this.performanceTable(rows));
    this.writeAudit(runDir, tests, 'mobile-ux', 'mobile-ux.md', (rows) => this.mobileUxTable(rows));

    this.publishLatest(runDir);
    this.appendHistory(summary);
    this.prune();

    const failed = tickets.length;
    console.log(
      `\nQA run ${runId}: ${summary.totals.passed} passed, ${summary.totals.failed} failed, ${summary.totals.skipped} skipped.` +
        (failed ? ` ${failed} bug report(s): reports/failed-test-cases.md and reports/bug-reports/` : '') +
        `\nComparison with previous run: reports/run-comparison.md`,
    );
  }

  private summary(runId: string, tests: TestCase[]): Summary {
    const records: TestRecord[] = tests
      .filter((t) => t.results.length)
      .map((t) => {
        const outcome = t.outcome();
        const title = t.title;
        return {
          key: t.titlePath().slice(2).join(' > '),
          caseId: title.match(CASE_ID)?.[1] ?? 'UNTAGGED',
          title,
          project: t.parent.project()?.name ?? 'default',
          device: (t.parent.project()?.metadata?.device as string) ?? '',
          outcome: outcome === 'expected' ? 'passed' : outcome === 'unexpected' ? 'failed' : outcome,
          durationMs: t.results.reduce((sum, r) => sum + r.duration, 0),
        } as TestRecord;
      });
    const totals = { total: records.length, passed: 0, failed: 0, skipped: 0, flaky: 0 };
    for (const r of records) totals[r.outcome]++;
    return {
      runId,
      startedAt: this.startedAt.toISOString(),
      environment: process.env.QA_ENV || 'default',
      baseURL: (this.config?.projects[0]?.use?.baseURL as string) || process.env.BASE_URL || '',
      projects: [...new Set(records.map((r) => r.project))],
      totals,
      tests: records,
    };
  }

  private tickets(tests: TestCase[], runDir: string): Ticket[] {
    const jiraIssues = readJson<Record<string, { key: string; url?: string }>>(path.join(REPORTS, 'jira-issues.json'), {});
    const groups = new Map<string, TestCase[]>();
    for (const t of tests) {
      const key = t.titlePath().slice(2).join(' > ');
      groups.set(key, [...(groups.get(key) ?? []), t]);
    }

    const tickets: Ticket[] = [];
    const usedNames = new Set<string>();
    for (const group of groups.values()) {
      const failedRuns = group.filter((t) => t.outcome() === 'unexpected');
      if (!failedRuns.length) continue;
      const first = failedRuns[0];
      const caseId = first.title.match(CASE_ID)?.[1] ?? 'UNTAGGED';
      const shortTitle = first.title.replace(/^[A-Z]+(?:-[A-Z]+)*-\d+:\s*/, '');

      let fileName = slug(caseId === 'UNTAGGED' ? shortTitle : caseId);
      for (let i = 2; usedNames.has(fileName); i++) fileName = `${slug(caseId)}-${i}`;
      usedNames.add(fileName);

      const failures = failedRuns.map((t) => this.browserFailure(t, runDir, fileName));
      const annotatedSteps = annotations(first, 'step');
      const runSteps = userSteps(first.results[first.results.length - 1].steps).map((s) => s.title);
      const browsers = failures.map((f) => f.project).join(', ');

      tickets.push({
        caseId,
        fileName,
        title: shortTitle,
        summary: `[${caseId}] ${shortTitle} (${browsers})`,
        description: annotations(first, 'description')[0] ?? first.titlePath().filter(Boolean).slice(1).join(' > '),
        preconditions: annotations(first, 'precondition'),
        steps: annotatedSteps.length ? annotatedSteps : runSteps,
        expected: annotations(first, 'expected').join('\n') || `Not specified in test annotations; see specs/test-plan.md for ${caseId}.`,
        severity: annotations(first, 'severity')[0] ?? 'To be triaged (see reports/healing-log.md)',
        spec: `${rel(first.location.file)}:${first.location.line}`,
        failures,
        passedIn: group.filter((t) => t.outcome() === 'expected').map((t) => t.parent.project()?.name ?? 'default'),
        jira: jiraIssues[caseId],
      });
    }
    return tickets;
  }

  private browserFailure(test: TestCase, runDir: string, fileName: string): BrowserFailure {
    const result: TestResult = test.results[test.results.length - 1];
    const project = test.parent.project();
    const use = project?.use ?? {};
    const projectName = project?.name ?? 'default';
    const error = result.errors[0] ?? result.error;

    // Copy artifacts into the run archive: test-results/ is replaced by the next run.
    const target = path.join(runDir, 'attachments', `${fileName}__${slug(projectName)}`);
    const attachments: string[] = [];
    for (const a of result.attachments) {
      if (!a.path || !fs.existsSync(a.path)) continue;
      fs.mkdirSync(target, { recursive: true });
      const ext = path.extname(a.path);
      const dest = path.join(target, `${a.name}${a.name.endsWith(ext) ? '' : ext}`.replace(/[^\w.-]+/g, '-'));
      fs.copyFileSync(a.path, dest);
      attachments.push(`${a.name}: ${rel(dest)}`);
    }

    const viewport = use.viewport ? `${use.viewport.width}x${use.viewport.height}` : 'device default';
    return {
      project: projectName,
      device: (project?.metadata?.device as string) ?? '',
      browser: (use.browserName ?? use.defaultBrowserType ?? 'chromium') as string,
      viewport: `${viewport}${use.deviceScaleFactor ? ` @ ${use.deviceScaleFactor}x` : ''}`,
      failedStep: failingStep(result.steps),
      actual: stripAnsi(error?.message ?? `Test ended with status "${result.status}"`).trim().split('\n').slice(0, 15).join('\n'),
      attachments,
    };
  }

  private ticketMarkdown(t: Ticket, s: Summary): string {
    // Identical errors across browsers are shown once.
    const byActual = new Map<string, BrowserFailure[]>();
    for (const f of t.failures) byActual.set(f.actual, [...(byActual.get(f.actual) ?? []), f]);
    const actual = [...byActual.entries()]
      .map(([text, items]) => `**${items.map((f) => f.project).join(', ')}**${items[0].failedStep ? ` (failed at step: ${items[0].failedStep})` : ''}\n\`\`\`\n${text}\n\`\`\``)
      .join('\n\n');

    return [
      `## ${t.summary}`,
      '',
      `**Severity:** ${t.severity}`,
      t.jira ? `**Jira:** ${t.jira.url ? `[${t.jira.key}](${t.jira.url})` : t.jira.key}` : '',
      `**Affected browsers:** ${t.failures.map((f) => `${f.project}${f.device ? ` (${f.device})` : ''}`).join(', ')}`,
      `**Passed in:** ${t.passedIn.length ? t.passedIn.join(', ') : 'None of the browsers in this run'}`,
      '',
      '### Description',
      t.description,
      '',
      '### Preconditions',
      list(t.preconditions),
      '',
      '### Steps to Reproduce',
      list(t.steps, true),
      '',
      '### Expected Result',
      t.expected,
      '',
      '### Actual Result',
      actual,
      '',
      '### Environment',
      list([
        `URL: ${s.baseURL}`,
        `Environment: ${s.environment}`,
        ...t.failures.map((f) => `${f.project}: ${f.browser}, ${f.device || 'device default'}, viewport ${f.viewport}`),
        `Spec: ${t.spec}`,
        `Run: ${s.runId}`,
      ]),
      '',
      '### Attachments',
      list(t.failures.flatMap((f) => f.attachments.map((a) => `${f.project} ${a}`))),
      '',
    ]
      .filter((line, i, all) => line !== '' || all[i - 1] !== '')
      .join('\n');
  }

  private writeTickets(runDir: string, tickets: Ticket[], s: Summary) {
    const bugDir = path.join(runDir, 'bug-reports');
    if (!tickets.length) {
      fs.writeFileSync(path.join(runDir, 'failed-test-cases.md'), `# Failed Test Cases\n\nRun ${s.runId}: no failed tests.\n`);
      return;
    }
    fs.mkdirSync(bugDir, { recursive: true });
    const blocks = tickets.map((t) => this.ticketMarkdown(t, s));
    tickets.forEach((t, i) => fs.writeFileSync(path.join(bugDir, `${t.fileName}.md`), blocks[i]));

    const header = `# Failed Test Cases\n\nRun: ${s.runId}\nTarget: ${s.baseURL} (${s.environment})\nBrowsers: ${s.projects.join(', ')}\nFailed test cases: ${tickets.length}\n\n`;
    fs.writeFileSync(path.join(runDir, 'failed-test-cases.md'), header + blocks.join('\n---\n\n'));
    fs.writeFileSync(path.join(runDir, 'failed-test-cases.csv'), this.csv(tickets, s));
  }

  private csv(tickets: Ticket[], s: Summary): string {
    const rows = [['Summary', 'Issue Type', 'Priority', 'Labels', 'Description'].map(csvCell).join(',')];
    for (const t of tickets) {
      const description = [
        t.description,
        '',
        `*Affected browsers:* ${t.failures.map((f) => f.project).join(', ')}`,
        `*Passed in:* ${t.passedIn.join(', ') || 'None'}`,
        '',
        '*Preconditions*',
        ...(t.preconditions.length ? t.preconditions.map((p) => `* ${p}`) : ['* None']),
        '',
        '*Steps to Reproduce*',
        ...t.steps.map((step) => `# ${step}`),
        '',
        '*Expected Result*',
        t.expected,
        '',
        '*Actual Result*',
        ...t.failures.flatMap((f) => [`${f.project}${f.failedStep ? ` (failed at step: ${f.failedStep})` : ''}:`, '{noformat}', f.actual, '{noformat}']),
        '',
        '*Environment*',
        `* URL: ${s.baseURL} (${s.environment})`,
        ...t.failures.map((f) => `* ${f.project}: ${f.browser}, ${f.device || 'device default'}, viewport ${f.viewport}`),
        '',
        '*Attachments (local paths, attach manually)*',
        ...t.failures.flatMap((f) => f.attachments.map((a) => `* ${f.project} ${a}`)),
      ].join('\n');
      const priority = /^(Critical|High|Medium|Low)$/.test(t.severity) ? t.severity : '';
      rows.push([t.summary, 'Bug', priority, 'qa-automation', description].map(csvCell).join(','));
    }
    return rows.join('\n') + '\n';
  }

  private comparison(s: Summary, prev: Summary | undefined): string {
    const head = `# Run Comparison\n\nThis run: ${s.runId} (${s.environment}) - ${s.totals.passed} passed, ${s.totals.failed} failed, ${s.totals.skipped} skipped\n`;
    if (!prev) return `${head}\nNo previous run to compare with.\n`;

    // Each test is compared with its most recent passed/failed result in earlier runs, so partial
    // runs (one tag, one browser, --last-failed) do not hide history. The device is part of the
    // key, so emulated and real-device runs of the same project are not mixed.
    const id = (r: TestRecord) => `${r.key} [${r.project}|${r.device ?? ''}]`;
    const earlier = this.recentSummaries(50).filter((x) => x.runId < s.runId);
    const last = new Map<string, TestRecord & { runId: string }>();
    for (const run of earlier) {
      for (const r of run.tests) if (r.outcome === 'passed' || r.outcome === 'failed') last.set(id(r), { ...r, runId: run.runId });
    }

    const groups: Record<string, string[]> = { 'New failures': [], Fixed: [], 'Still failing': [], 'First result': [] };
    for (const r of s.tests) {
      if (r.outcome !== 'passed' && r.outcome !== 'failed') continue;
      const old = last.get(id(r));
      const name = `${r.title} [${r.project}]`;
      if (!old) groups['First result'].push(`${name}: ${r.outcome}`);
      else if (r.outcome === 'failed' && old.outcome === 'passed') groups['New failures'].push(`${name} (passed in ${old.runId})`);
      else if (r.outcome === 'passed' && old.outcome === 'failed') groups.Fixed.push(`${name} (failed in ${old.runId})`);
      else if (r.outcome === 'failed') groups['Still failing'].push(`${name} (also failed in ${old.runId})`);
    }

    // Tests whose result changed at least twice over the last 6 runs that included them are unstable.
    const recent = [...earlier.slice(-5), s];
    const unstable = s.tests
      .filter((r) => {
        const outcomes = recent.map((h) => h.tests.find((x) => id(x) === id(r))?.outcome).filter((o) => o === 'passed' || o === 'failed');
        return outcomes.filter((o, i) => i > 0 && o !== outcomes[i - 1]).length >= 2;
      })
      .map((r) => `${r.title} [${r.project}]`);

    const sections = Object.entries({ ...groups, 'Unstable across recent runs (possible flaky)': unstable }).map(
      ([name, items]) => `## ${name} (${items.length})\n${items.length ? list(items) : '- None'}`,
    );
    const partial = s.tests.length < prev.tests.length ? `\nPartial run: ${s.tests.length} of ${prev.tests.length} tests ran. Each test is compared with its own last result.\n` : '';
    return `${head}Previous run: ${prev.runId} (${prev.environment}) - ${prev.totals.passed} passed, ${prev.totals.failed} failed\n${partial}\n${sections.join('\n\n')}\n`;
  }

  private writeAudit(runDir: string, tests: TestCase[], name: string, file: string, render: (rows: { test: TestCase; project: string; data: any }[]) => string) {
    const rows = tests.flatMap((t) =>
      (t.results[t.results.length - 1]?.attachments ?? [])
        .filter((a) => a.name === name && a.body)
        .map((a) => ({ test: t, project: t.parent.project()?.name ?? 'default', data: JSON.parse(a.body!.toString('utf8')) })),
    );
    if (rows.length) fs.writeFileSync(path.join(runDir, file), render(rows));
  }

  private performanceTable(rows: { test: TestCase; project: string; data: any }[]): string {
    const fmt = (v: number | null, unit: string) => (v === null || v === undefined ? 'n/a' : unit === 'ms' ? `${Math.round(v)} ms` : v.toFixed(3));
    const lines = rows.map(
      ({ project, data: d }) =>
        `| ${d.label} | ${project} | ${fmt(d.lcp, 'ms')} | ${fmt(d.cls, '')} | ${fmt(d.fcp, 'ms')} | ${fmt(d.ttfb, 'ms')} | ${d.rating} |`,
    );
    return [
      '# Performance (Web Vitals)',
      '',
      'Thresholds: good / poor. LCP 2500 / 4000 ms, CLS 0.1 / 0.25, FCP 1800 / 3000 ms, TTFB 800 / 1800 ms. Only "poor" values fail a test.',
      'Measured in a local, headed browser: use for trends and outliers, not as field data.',
      '',
      '| Page | Browser | LCP | CLS | FCP | TTFB | Rating |',
      '|---|---|---|---|---|---|---|',
      ...lines,
      '',
    ].join('\n');
  }

  private mobileUxTable(rows: { test: TestCase; project: string; data: any }[]): string {
    const lines = rows.flatMap(({ project, data }) =>
      (data.issues as { rule: string; severity: string; detail: string }[]).map((i) => `| ${data.label} | ${project} | ${i.severity} | ${i.rule} | ${i.detail.replace(/\|/g, '\\|')} |`),
    );
    return [
      '# Mobile UX Audit',
      '',
      lines.length ? '| Page | Browser | Severity | Rule | Detail |\n|---|---|---|---|---|\n' + lines.join('\n') : 'No mobile UX issues found.',
      '',
    ].join('\n');
  }

  private publishLatest(runDir: string) {
    for (const f of ['failed-test-cases.md', 'failed-test-cases.csv', 'run-comparison.md', 'performance.md', 'mobile-ux.md']) {
      const src = path.join(runDir, f);
      const dest = path.join(REPORTS, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, dest);
      else fs.rmSync(dest, { force: true });
    }
    const latestBugs = path.join(REPORTS, 'bug-reports');
    fs.rmSync(latestBugs, { recursive: true, force: true });
    if (fs.existsSync(path.join(runDir, 'bug-reports'))) fs.cpSync(path.join(runDir, 'bug-reports'), latestBugs, { recursive: true });
    fs.writeFileSync(path.join(REPORTS, 'latest-run.txt'), `${rel(runDir)}\n`);
  }

  private appendHistory(s: Summary) {
    const file = path.join(REPORTS, 'history.json');
    const history = readJson<object[]>(file, []);
    history.push({ runId: s.runId, environment: s.environment, baseURL: s.baseURL, projects: s.projects, totals: s.totals });
    fs.writeFileSync(file, JSON.stringify(history, null, 2));
  }

  private recentSummaries(count: number): Summary[] {
    if (!fs.existsSync(RUNS)) return [];
    return fs
      .readdirSync(RUNS)
      .sort()
      .slice(-count)
      .map((d) => readJson<Summary | null>(path.join(RUNS, d, 'summary.json'), null))
      .filter((x): x is Summary => !!x);
  }

  private previousSummary(runId: string): Summary | undefined {
    return this.recentSummaries(50)
      .filter((x) => x.runId < runId)
      .pop();
  }

  private prune() {
    const keep = Math.max(1, Number(process.env.QA_KEEP_RUNS) || 20);
    const runs = fs.readdirSync(RUNS).sort();
    for (const old of runs.slice(0, Math.max(0, runs.length - keep))) fs.rmSync(path.join(RUNS, old), { recursive: true, force: true });
  }
}

export default BugReporter;
