/**
 * Verifies that the configured LinkedIn credentials produce a working session,
 * and reports exactly which failure mode was hit if not.
 *
 *   npm run login:check
 *   npm run login:check -- williamhgates     # also fetch a profile end-to-end
 *
 * Nothing here prints credential material.
 */
import 'dotenv/config';
import { hasCredentials, hasSessionCookie } from '../src/config';
import { getSession } from '../src/linkedin/session';
import { voyagerGet } from '../src/linkedin/voyager';
import { fetchProfile } from '../src/linkedin/profile';
import { LinkedInAuthError, LinkedInChallengeError } from '../src/util/errors';

async function main(): Promise<void> {
  console.log('Configuration');
  console.log(`  credentials present : ${hasCredentials() ? 'yes' : 'no'}`);
  console.log(`  li_at cookie present: ${hasSessionCookie() ? 'yes' : 'no'}`);
  console.log(`  proxy configured    : ${process.env.LINKEDIN_PROXY_URL ? 'yes' : 'no'}`);
  console.log('');

  console.log('Authenticating…');
  const session = await getSession(true);
  console.log(`  OK — session obtained via ${session.origin}`);
  console.log(`  cookies: ${session.jar.names().join(', ')}`);
  console.log('');

  console.log('Calling Voyager (/me)…');
  const me = await voyagerGet('/me');
  console.log(`  HTTP ${me.status}`);
  if (me.status === 200 && me.json && typeof me.json === 'object') {
    const mini = (me.json as Record<string, unknown>).miniProfile as
      | Record<string, unknown>
      | undefined;
    if (mini) {
      console.log(`  signed in as: ${mini.firstName} ${mini.lastName} (/in/${mini.publicIdentifier})`);
    }
  } else {
    console.log('  Voyager did not return a usable /me payload.');
    console.log(`  first 300 chars: ${me.raw.slice(0, 300)}`);
  }

  const target = process.argv[2];
  if (target) {
    console.log('');
    console.log(`Fetching profile: ${target}`);
    const result = await fetchProfile(target, { refresh: true });
    console.log(`  source        : ${result.meta.source}`);
    console.log(`  duration      : ${result.meta.durationMs}ms`);
    console.log(`  name          : ${result.data.fullName}`);
    console.log(`  headline      : ${result.data.headline}`);
    console.log(`  location      : ${result.data.location.full}`);
    console.log(`  experience    : ${result.data.experience.length}`);
    console.log(`  education     : ${result.data.education.length}`);
    console.log(`  skills        : ${result.data.skills.length}`);
    console.log(`  certifications: ${result.data.certifications.length}`);
    console.log(`  languages     : ${result.data.languages.length}`);
    console.log(`  unavailable   : ${result.meta.unavailableSections.join(', ') || 'none'}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error('');
    if (error instanceof LinkedInChallengeError) {
      console.error('CHALLENGE REQUIRED');
      console.error(error.message);
      console.error('');
      console.error('Fix: log in to LinkedIn in a browser, open DevTools > Application >');
      console.error('Cookies > linkedin.com, copy the "li_at" value, and add it to .env as');
      console.error('LINKEDIN_LI_AT=<value>');
    } else if (error instanceof LinkedInAuthError) {
      console.error('AUTHENTICATION FAILED');
      console.error(error.message);
    } else {
      console.error('FAILED');
      console.error(error instanceof Error ? error.message : String(error));
    }
    process.exit(1);
  });
