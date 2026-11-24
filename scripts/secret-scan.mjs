#!/usr/bin/env node
// Non-destructive exposed-secret scan for the QA security audit (qa:security-auditor).
//
//   node secret-scan.mjs <BASE_URL> [more same-origin URLs ...] [--out reports/secret-scan.json]
//
// Only GET requests to the target origin. It scans:
// - the given pages, their same-origin <script src> files, and inline scripts
// - extra URLs (for example GET API endpoints from specs/api-inventory.md)
// - source maps referenced by those scripts (exposed source code)
// - well-known files that should never be public (/.env, /.git/config, ...)
// Matches are redacted (first 6 characters). Output: JSON findings + a short console summary.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outFile = outIndex >= 0 ? args.splice(outIndex, 2)[1] : 'reports/secret-scan.json';
if (!args.length) {
  console.error('Usage: node secret-scan.mjs <BASE_URL> [more same-origin URLs ...] [--out file]');
  process.exit(1);
}

const base = new URL(args[0]);
const origin = base.origin;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_SCRIPTS = 200;

// [rule, severity, regex]. Severity follows the workspace CLAUDE.md scale.
const RULES = [
  ['Private key', 'Critical', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ['AWS access key ID', 'High', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['Stripe secret/restricted key', 'Critical', /\b(?:sk|rk)_live_[0-9a-zA-Z]{20,}\b/g],
  ['GitHub token', 'Critical', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g],
  ['Slack token', 'High', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g],
  ['Slack webhook', 'Medium', /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{20,}/g],
  ['OpenAI API key', 'High', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ['Anthropic API key', 'High', /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ['SendGrid API key', 'High', /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g],
  ['Twilio API key (review)', 'Medium', /\bSK[0-9a-fA-F]{32}\b/g],
  ['Mailgun API key', 'High', /\bkey-[0-9a-zA-Z]{32}\b/g],
  ['Google API key (check it is restricted)', 'Low', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['RPC provider key in URL (Infura/Alchemy)', 'Medium', /(?:infura\.io\/v3\/[0-9a-f]{32}|alchemy\.com\/v2\/[A-Za-z0-9_-]{32})/g],
  ['Hardcoded JWT', 'Medium', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['Hardcoded secret assignment (review)', 'Medium', /(?:api[_-]?key|secret|client[_-]?secret|access[_-]?token|auth[_-]?token|password)["']?\s*[:=]\s*["']([^"'\s]{12,})["']/gi],
];

// Files that must not be served. `looks` filters out SPA fallbacks that return index.html with 200.
const SENSITIVE_FILES = [
  ['/.env', 'High', (t) => /^\s*[A-Z_][A-Z0-9_]*\s*=/m.test(t) && !/<html/i.test(t)],
  ['/.git/config', 'High', (t) => t.includes('[core]')],
  ['/.git/HEAD', 'High', (t) => /^ref: refs\//.test(t)],
  ['/.svn/entries', 'Medium', (t) => !/<html/i.test(t) && t.length > 0],
  ['/.DS_Store', 'Low', (t) => t.startsWith('\u0000\u0000\u0000\u0001Bud1')],
  ['/server-status', 'Medium', (t) => /Apache Server Status/i.test(t)],
  ['/phpinfo.php', 'Medium', (t) => /phpinfo\(\)|PHP Version/i.test(t)],
];

const findings = [];
const scanned = new Set();
const redact = (s) => `${s.slice(0, 6)}…(${s.length} chars)`;
const sameOrigin = (u) => {
  try {
    return new URL(u, origin).origin === origin;
  } catch {
    return false;
  }
};

async function get(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'qa-secret-scan' } });
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type') ?? '', text: buf.subarray(0, MAX_BYTES).toString('utf8') };
  } catch (err) {
    return { status: 0, type: '', text: '', error: String(err) };
  }
}

function scanText(text, source) {
  const lines = text.split('\n');
  for (const [rule, severity, regex] of RULES) {
    regex.lastIndex = 0;
    for (const m of text.matchAll(regex)) {
      const value = m[1] ?? m[0];
      const line = text.slice(0, m.index).split('\n').length;
      if (findings.some((f) => f.source === source && f.rule === rule && f.match === redact(value))) continue;
      findings.push({ rule, severity, source, line: lines.length > 1 ? line : undefined, match: redact(value) });
    }
  }
}

async function scanScript(url) {
  if (scanned.has(url) || scanned.size > MAX_SCRIPTS) return;
  scanned.add(url);
  const res = await get(url);
  if (res.status !== 200) return;
  scanText(res.text, url);
  const mapRef = res.text.match(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/);
  const mapUrl = mapRef && !mapRef[1].startsWith('data:') ? new URL(mapRef[1], url).href : `${url}.map`;
  if (sameOrigin(mapUrl) && !scanned.has(mapUrl)) {
    scanned.add(mapUrl);
    const map = await get(mapUrl);
    if (map.status === 200 && /"sources"\s*:/.test(map.text)) {
      findings.push({ rule: 'Source map publicly accessible (exposes original source)', severity: 'Low', source: mapUrl, match: 'sources[] present' });
      scanText(map.text, mapUrl);
    }
  }
}

async function scanPage(url) {
  if (scanned.has(url)) return;
  scanned.add(url);
  const res = await get(url);
  if (res.status === 0) {
    findings.push({ rule: 'Request failed', severity: 'Info', source: url, match: res.error });
    return;
  }
  scanText(res.text, url);
  if (!/html/i.test(res.type)) return;
  for (const m of res.text.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const src = new URL(m[1], url).href;
    if (sameOrigin(src)) await scanScript(src);
  }
}

for (const target of args) {
  const url = new URL(target, origin).href;
  if (!sameOrigin(url)) {
    console.error(`Skipped ${url}: not on the target origin ${origin}`);
    continue;
  }
  await scanPage(url);
}

for (const [file, severity, looks] of SENSITIVE_FILES) {
  const url = origin + file;
  const res = await get(url);
  if (res.status === 200 && looks(res.text)) findings.push({ rule: `Sensitive file exposed: ${file}`, severity, source: url, match: redact(res.text.trim()) });
}

const order = ['Critical', 'High', 'Medium', 'Low', 'Info'];
findings.sort((a, b) => order.indexOf(a.severity) - order.indexOf(b.severity));
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ origin, scannedAt: new Date().toISOString(), urlsScanned: [...scanned], findings }, null, 2));

console.log(`Secret scan of ${origin}: ${scanned.size} URL(s), ${findings.length} finding(s). Details: ${outFile}`);
for (const f of findings) console.log(`- [${f.severity}] ${f.rule}: ${f.source}${f.line ? `:${f.line}` : ''} (${f.match})`);
