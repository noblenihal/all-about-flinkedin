/**
 * Logs in once with the configured credentials and prints the resulting cookie
 * jar as a single-line JSON string, ready to paste into the
 * `LINKEDIN_COOKIE_JAR` environment variable of a stateless host (Vercel,
 * Lambda, etc.).
 *
 *   npm run login:export
 *
 * The point of this indirection: serverless functions have no persistent disk,
 * so they cannot reuse a session across cold starts. Logging in on every cold
 * start is what provokes LinkedIn's verification challenges. Capturing the jar
 * once here and injecting it as config means the deployed function authenticates
 * with zero logins.
 *
 * Treat the output like a password — it grants access to the account.
 */
import 'dotenv/config';
// Force a fresh credential login rather than reusing any stored/env session.
delete process.env.LINKEDIN_LI_AT;
delete process.env.LINKEDIN_COOKIE_JAR;
process.env.LINKEDIN_SESSION_FILE = '/dev/null';

import { loginWithCredentials } from '../src/linkedin/auth';
import { config } from '../src/config';
import { LinkedInAuthError, LinkedInChallengeError } from '../src/util/errors';

async function main(): Promise<void> {
  process.stderr.write('Logging in to capture a session jar…\n');
  const session = await loginWithCredentials(config.linkedin.email, config.linkedin.password);

  const jar = JSON.stringify(session.jar.toJSON());

  process.stderr.write('\nDone. Set this as LINKEDIN_COOKIE_JAR on your host:\n\n');
  // The jar itself is the only thing written to stdout, so it can be piped.
  process.stdout.write(`${jar}\n`);
  process.stderr.write(
    '\nCookies captured: ' + session.jar.names().join(', ') + '\n' +
      'Keep it secret. It is valid until you log out, change your password, or ' +
      'LinkedIn expires it (typically weeks).\n',
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write('\n');
    if (error instanceof LinkedInChallengeError) {
      process.stderr.write(
        'CHALLENGE REQUIRED — LinkedIn asked for verification during login.\n' +
          'Run this from a machine/IP that has recently logged in from a browser, ' +
          'or export the jar from a browser session manually.\n',
      );
    } else if (error instanceof LinkedInAuthError) {
      process.stderr.write(`AUTH FAILED — ${error.message}\n`);
    } else {
      process.stderr.write(`FAILED — ${error instanceof Error ? error.message : String(error)}\n`);
    }
    process.exit(1);
  });
