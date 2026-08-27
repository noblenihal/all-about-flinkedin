/**
 * Vercel serverless entry point.
 *
 * Vercel builds each file under `api/` into its own function. Here we hand the
 * whole Express app to Vercel's Node runtime, which accepts an
 * `(req, res)` handler — so the same server that runs under `npm start` also
 * runs unmodified as a function. `vercel.json` rewrites every path to this
 * file, so Express keeps ownership of routing.
 *
 * Auth note: on Vercel the filesystem is read-only and ephemeral, so configure
 * `LINKEDIN_COOKIE_JAR` (see `npm run login:export`) rather than credentials —
 * that avoids a per-cold-start login, which is what triggers LinkedIn
 * challenges.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from '../src/server';

const app = createServer();

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  (app as unknown as (req: IncomingMessage, res: ServerResponse) => void)(req, res);
}
