import fs from 'fs';
import path from 'path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

// Writes a Jira-ready bug report for every test that finally failed (flaky passes are skipped):
//   reports/bug-reports/<CASE-ID>__<project>.md  one ticket per failure, copy-paste into Jira
//   reports/failed-test-cases.md                 all failures in one file
//   reports/failed-test-cases.csv                Jira CSV import (Summary, Description, Priority, Labels, ...)
// Ticket content comes from test annotations written by test-generator:
//   description, precondition, step (one per step, in order), expected, severity (optional)
// Actual result, environment, and attachments come from the test run itself.

type BugReport = {
  id: string;
  summary: string;
  description: string;
  preconditions: string[];
  steps: string[];
  failedStep: string;
  expected: string;
  actual: string;
  severity: string;
  environment: string[];
  attachments: string[];
};

const OUT_DIR = 'reports';
const BUG_DIR = path.join(OUT_DIR, 'bug-reports');

const stripAnsi = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');
const slug = (text: string) => text.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const csvCell = (text: string) => `"${text.replace(/"/g, '""')}"`;

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

class BugReporter implements Reporter {
  private root?: Suite;
  private baseURL = '';

  onBegin(config: FullConfig, suite: Suite) {
    this.root = suite;
    this.baseURL = (config.projects[0]?.use?.baseURL as string) || process.env.BASE_URL || '';
  }

  onEnd(_result: FullResult) {
    if (!this.root) return;
    const failed = this.root.allTests().filter((t) => t.outcome() === 'unexpected');

    fs.rmSync(BUG_DIR, { recursive: true, force: true });
    const reports = failed.map((t) => this.build(t));
    if (reports.length === 0) {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, 'failed-test-cases.md'), '# Failed Test Cases\n\nNo failed tests in the last run.\n');
      fs.rmSync(path.join(OUT_DIR, 'failed-test-cases.csv'), { force: true });
      return;
    }

    fs.mkdirSync(BUG_DIR, { recursive: true });
    for (const r of reports) fs.writeFileSync(path.join(BUG_DIR, `${slug(r.id)}.md`), this.markdown(r));

    const header = `# Failed Test Cases\n\nGenerated: ${new Date().toISOString()}\nTarget: ${this.baseURL}\nFailed: ${reports.length}\n\n`;
    fs.writeFileSync(path.join(OUT_DIR, 'failed-test-cases.md'), header + reports.map((r) => this.markdown(r)).join('\n---\n\n'));
    fs.writeFileSync(path.join(OUT_DIR, 'failed-test-cases.csv'), this.csv(reports));
    console.log(`\nBug reports for ${reports.length} failed test(s): ${OUT_DIR}/failed-test-cases.md and ${BUG_DIR}/`);
  }

  private build(test: TestCase): BugReport {
    const result: TestResult = test.results[test.results.length - 1];
    const project = test.parent.project();
    const use = project?.use ?? {};
    const caseId = test.title.match(/^([A-Z]+(?:-[A-Z]+)*-\d+)/)?.[1] ?? 'UNTAGGED';
    const projectName = project?.name ?? 'default';

    const annotatedSteps = annotations(test, 'step');
    const runSteps = userSteps(result.steps).map((s) => s.title);
    const error = result.errors[0] ?? result.error;
    const actualLines = stripAnsi(error?.message ?? `Test ended with status "${result.status}"`).trim().split('\n');

    const viewport = use.viewport ? `${use.viewport.width}x${use.viewport.height}` : 'default';
    const environment = [
      `URL: ${(use.baseURL as string) || this.baseURL}`,
      `Project / device: ${projectName}${project?.metadata?.device ? ` (${project.metadata.device})` : ''}`,
      `Browser: ${use.browserName ?? use.defaultBrowserType ?? 'chromium'}`,
      `Viewport: ${viewport}${use.deviceScaleFactor ? ` @ ${use.deviceScaleFactor}x` : ''}`,
      `Spec: ${path.relative(process.cwd(), test.location.file)}:${test.location.line}`,
      `Run date: ${result.startTime.toISOString()}`,
      `Attempts: ${test.results.length} (all failed)`,
    ];

    const attachments = result.attachments
      .filter((a) => a.path)
      .map((a) => `${a.name}: ${path.relative(process.cwd(), a.path as string)}`);

    return {
      id: `${caseId}__${projectName}`,
      summary: `[${caseId}] ${test.title.replace(/^[A-Z]+(?:-[A-Z]+)*-\d+:\s*/, '')} (${projectName})`,
      description: annotations(test, 'description')[0] ?? test.titlePath().filter(Boolean).slice(1).join(' > '),
      preconditions: annotations(test, 'precondition'),
      steps: annotatedSteps.length ? annotatedSteps : runSteps,
      failedStep: failingStep(result.steps),
      expected: annotations(test, 'expected').join('\n') || 'Not specified in test annotations — see specs/test-plan.md for ' + caseId,
      actual: actualLines.slice(0, 15).join('\n'),
      severity: annotations(test, 'severity')[0] ?? 'To be triaged (see reports/healing-log.md)',
      environment,
      attachments,
    };
  }

  private markdown(r: BugReport): string {
    const list = (items: string[], ordered = false) =>
      items.length ? items.map((s, i) => `${ordered ? `${i + 1}.` : '-'} ${s}`).join('\n') : '- None';
    return [
      `## ${r.summary}`,
      '',
      `**Severity:** ${r.severity}`,
      '',
      '### Description',
      r.description,
      '',
      '### Preconditions',
      list(r.preconditions),
      '',
      '### Steps to Reproduce',
      list(r.steps, true),
      r.failedStep ? `\n**Failed at step:** ${r.failedStep}` : '',
      '',
      '### Expected Result',
      r.expected,
      '',
      '### Actual Result',
      '```',
      r.actual,
      '```',
      '',
      '### Environment',
      list(r.environment),
      '',
      '### Attachments',
      list(r.attachments),
      '',
    ].join('\n');
  }

  private csv(reports: BugReport[]): string {
    const rows = [['Summary', 'Issue Type', 'Priority', 'Labels', 'Description'].map(csvCell).join(',')];
    for (const r of reports) {
      const description = [
        r.description,
        '',
        '*Preconditions*',
        ...(r.preconditions.length ? r.preconditions.map((p) => `* ${p}`) : ['* None']),
        '',
        '*Steps to Reproduce*',
        ...r.steps.map((s) => `# ${s}`),
        ...(r.failedStep ? ['', `Failed at step: ${r.failedStep}`] : []),
        '',
        '*Expected Result*',
        r.expected,
        '',
        '*Actual Result*',
        '{noformat}',
        r.actual,
        '{noformat}',
        '',
        '*Environment*',
        ...r.environment.map((e) => `* ${e}`),
        '',
        '*Attachments (local paths)*',
        ...(r.attachments.length ? r.attachments.map((a) => `* ${a}`) : ['* None']),
      ].join('\n');
      const priority = /^(Critical|High|Medium|Low)$/.test(r.severity) ? r.severity : '';
      rows.push([r.summary, 'Bug', priority, 'qa-automation', description].map(csvCell).join(','));
    }
    return rows.join('\n') + '\n';
  }
}

export default BugReporter;
