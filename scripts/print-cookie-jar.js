/**
 * Prints the persisted LinkedIn cookie jar as the single-line value expected by
 * the LINKEDIN_COOKIE_JAR environment variable. Reuses the existing session in
 * .session/linkedin.json — it does NOT log in. Local dev helper only; the value
 * it prints is a secret, so never commit or share the output.
 *
 *   node scripts/print-cookie-jar.js
 */
const fs = require('node:fs');
const path = require('node:path');

const file =
  process.env.LINKEDIN_SESSION_FILE || path.join(process.cwd(), '.session', 'linkedin.json');

try {
  const session = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!session.cookies || !session.cookies.li_at) {
    console.error('No usable session found in', file, '- run `npm run login:check` first.');
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(session.cookies) + '\n');
} catch (err) {
  console.error('Could not read session file at', file, '-', err.message);
  console.error('Run `npm run login:check` to create one, then retry.');
  process.exit(1);
}
