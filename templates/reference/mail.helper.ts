/**
 * REFERENCE helper for OTP and verification emails through MailSlurp (free plan: 500 emails/month).
 * Used only when the user chose MailSlurp at intake. test-generator copies it to
 * fixtures/mail.helper.ts and installs the client: npm install -D mailslurp-client
 *
 * .env (the user types these values; never print them):
 *   MAILSLURP_API_KEY   API key from https://app.mailslurp.com
 *   MAILSLURP_INBOX_ID  inbox whose address is the test account's email
 *
 * Usage (inside performLogin or a test):
 *   const since = new Date();
 *   await loginPage.requestCode(requireEnv('TEST_USER'));
 *   const code = await waitForOtp({ since });
 *   await loginPage.enterCode(code);
 */
import { MailSlurp } from 'mailslurp-client';

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env (MailSlurp).`);
  return value;
}

let client: MailSlurp | undefined;
const mailslurp = () => (client ??= new MailSlurp({ apiKey: env('MAILSLURP_API_KEY') }));

/** Waits for the first email that arrives after `since` and returns it. */
export async function waitForEmail(options: { since: Date; timeoutMs?: number; inboxId?: string }) {
  return mailslurp().waitController.waitForLatestEmail({
    inboxId: options.inboxId ?? env('MAILSLURP_INBOX_ID'),
    timeout: options.timeoutMs ?? 60_000,
    unreadOnly: true,
    since: options.since,
  });
}

/** Waits for a new email and extracts the one-time code (default: the first 4-8 digit number). */
export async function waitForOtp(options: { since: Date; pattern?: RegExp; timeoutMs?: number; inboxId?: string }): Promise<string> {
  const email = await waitForEmail(options);
  const text = `${email.subject ?? ''}\n${(email.body ?? '').replace(/<[^>]+>/g, ' ')}`;
  const match = text.match(options.pattern ?? /\b\d{4,8}\b/);
  if (!match) throw new Error(`No code found in the email "${email.subject ?? ''}". Adjust the pattern.`);
  return match[1] ?? match[0];
}

/** Waits for a new email and returns the first link whose URL matches `linkPattern` (e.g. /verify/). */
export async function waitForLink(options: { since: Date; linkPattern: RegExp; timeoutMs?: number; inboxId?: string }): Promise<string> {
  const email = await waitForEmail(options);
  const links = (email.body ?? '').match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  const link = links.find((l) => options.linkPattern.test(l));
  if (!link) throw new Error(`No link matching ${options.linkPattern} in the email "${email.subject ?? ''}".`);
  return link.replace(/&amp;/g, '&');
}
