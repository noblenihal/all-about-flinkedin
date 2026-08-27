import { ApiError } from './errors';

/**
 * Extracts the public identifier (the `/in/<slug>` segment) from a LinkedIn
 * profile URL.
 *
 * Accepts the shapes people actually paste: with or without a scheme, with any
 * country subdomain (`in.linkedin.com`, `de.linkedin.com`), with tracking
 * query strings, with a trailing path like `/details/experience`, and
 * percent-encoded non-ASCII slugs. A bare slug is accepted too.
 */
export function extractPublicIdentifier(input: string): string {
  const raw = input?.trim();
  if (!raw) {
    throw ApiError.badRequest('INVALID_URL', 'A LinkedIn profile URL is required.');
  }

  // A bare slug: no dots, no slashes.
  if (!raw.includes('/') && !raw.includes('.')) {
    return normaliseSlug(raw);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    throw ApiError.badRequest('INVALID_URL', `Could not parse "${input}" as a URL.`);
  }

  const host = parsed.hostname.toLowerCase();
  if (!host.endsWith('linkedin.com')) {
    throw ApiError.badRequest(
      'INVALID_URL',
      `Expected a linkedin.com URL but received host "${parsed.hostname}".`,
    );
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  const inIndex = segments.findIndex((segment) => segment === 'in');

  if (inIndex === -1 || !segments[inIndex + 1]) {
    // Company and school URLs are a common mistake worth naming explicitly.
    if (segments[0] === 'company' || segments[0] === 'school') {
      throw ApiError.badRequest(
        'INVALID_URL',
        `That is a ${segments[0]} URL. This API returns member profiles, which look like ` +
          'https://www.linkedin.com/in/<slug>.',
      );
    }
    throw ApiError.badRequest(
      'INVALID_URL',
      'URL does not contain an "/in/<slug>" segment. Expected something like ' +
        'https://www.linkedin.com/in/williamhgates.',
    );
  }

  return normaliseSlug(segments[inIndex + 1]!);
}

function normaliseSlug(slug: string): string {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // Malformed escape sequence — fall through with the raw value.
  }

  const cleaned = decoded.trim().replace(/^@/, '');

  if (!cleaned || cleaned.length > 200) {
    throw ApiError.badRequest('INVALID_URL', 'The profile identifier is empty or implausibly long.');
  }

  // LinkedIn slugs are letters, digits, and hyphens; non-Latin scripts appear
  // percent-encoded in the URL but decode to real characters here.
  if (/[\s/?#]/.test(cleaned)) {
    throw ApiError.badRequest('INVALID_URL', `"${slug}" is not a valid profile identifier.`);
  }

  return cleaned;
}

export function profileUrlFor(publicId: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(publicId)}/`;
}
