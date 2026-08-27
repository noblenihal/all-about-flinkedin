import { config } from '../config';
import { logger } from '../logger';
import { TtlCache } from '../util/cache';
import { ApiError, LinkedInAuthError, LinkedInChallengeError } from '../util/errors';
import { profileUrlFor } from '../util/url';
import type {
  ContactInfo,
  LinkedInProfile,
  ProfileMeta,
  ProfileResponse,
  ProfileSource,
} from '../types/profile';
import { asArray, dig, isObject, num, partialDate, str, type Json } from './parse/common';
import { parseGraphqlProfile } from './parse/graphqlProfile';
import { parseDashProfile } from './parse/dash';
import { parseProfileView, sectionParsers } from './parse/profileView';
import { parsePublicPage } from './parse/publicPage';
import { fetchPublicProfileHtml, graphqlGet, voyagerGet } from './voyager';

/**
 * Query id for `FullProfileByMemberIdentity`, taken from the LinkedIn Android
 * app's generated GraphQL client. It fetches a complete profile — every
 * section inline — keyed by public identifier. See parse/graphqlProfile.ts.
 */
const FULL_PROFILE_QUERY_ID = 'voyagerIdentityDashProfiles.5f50f83f76a1e270603613bdd0fb0252';

const cache = new TtlCache<ProfileResponse>(config.cache.ttlMs, config.cache.maxEntries);

/**
 * Decoration IDs pin the server-side projection Voyager returns. LinkedIn
 * increments the trailing version whenever the projection changes and retires
 * old ones, so we try the versions we know about newest-first and fall back to
 * the undecorated call, which always works but returns only the core fields.
 */
const DASH_DECORATIONS = [
  'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-100',
  'com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-97',
  'com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-6',
];

interface StrategyOutcome {
  source: ProfileSource;
  profile: LinkedInProfile;
  unavailableSections: string[];
}

async function tryGraphql(publicId: string): Promise<StrategyOutcome> {
  const result = await graphqlGet(FULL_PROFILE_QUERY_ID, `(memberIdentity:${encodeURIComponent(publicId)})`);

  if (result.status === 404) {
    throw ApiError.notFound(`No LinkedIn profile found at /in/${publicId}.`);
  }
  if (result.status >= 400 || !result.json) {
    throw new Error(`GraphQL profile query returned HTTP ${result.status}`);
  }

  // An empty elements list means LinkedIn resolved the query but found nobody.
  const element = dig(result.json, 'data', 'identityDashProfilesByMemberIdentity', 'elements', 0);
  if (!element) {
    throw ApiError.notFound(`No LinkedIn profile found at /in/${publicId}.`);
  }

  const parsed = parseGraphqlProfile(result.json, publicId);
  return { source: 'voyager-graphql', ...parsed };
}

async function tryProfileView(publicId: string): Promise<StrategyOutcome> {
  const result = await voyagerGet(
    `/identity/profiles/${encodeURIComponent(publicId)}/profileView`,
  );

  if (result.status === 404) {
    throw ApiError.notFound(`No LinkedIn profile found at /in/${publicId}.`);
  }
  if (result.status >= 400 || !result.json) {
    throw new Error(`profileView returned HTTP ${result.status}`);
  }

  const parsed = parseProfileView(result.json, publicId);
  if (!parsed.profile.fullName && parsed.profile.experience.length === 0) {
    throw new Error('profileView returned an empty profile');
  }

  return { source: 'voyager-profile-view', ...parsed };
}

async function tryDash(publicId: string): Promise<StrategyOutcome> {
  const base = `/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(publicId)}`;

  for (const decoration of [...DASH_DECORATIONS, null]) {
    const path = decoration ? `${base}&decorationId=${decoration}` : base;
    const result = await voyagerGet(path, { normalized: true });

    if (result.status === 404) {
      throw ApiError.notFound(`No LinkedIn profile found at /in/${publicId}.`);
    }
    if (result.status >= 400 || !result.json) {
      logger.debug('dash decoration rejected', { decoration, status: result.status });
      continue;
    }

    try {
      const parsed = parseDashProfile(result.json, publicId);
      return { source: 'voyager-dash', ...parsed };
    } catch (error) {
      logger.debug('dash parse failed', {
        decoration,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  throw new Error('no dash decoration produced a usable profile');
}

async function tryPublicPage(publicId: string): Promise<StrategyOutcome> {
  const html = await fetchPublicProfileHtml(publicId);
  if (html === null) {
    throw new Error('public profile page was unavailable or behind the auth wall');
  }
  const parsed = parsePublicPage(html, publicId);
  return { source: 'public-page', ...parsed };
}

/** Follower/connection counts live on their own endpoint. */
async function fetchNetworkInfo(
  publicId: string,
): Promise<{ followers: number | null; connections: number | null }> {
  try {
    const result = await voyagerGet(
      `/identity/profiles/${encodeURIComponent(publicId)}/networkinfo`,
    );
    if (result.status >= 400 || !isObject(result.json)) {
      return { followers: null, connections: null };
    }
    return {
      followers: num(result.json.followersCount),
      connections: num(result.json.connectionsCount),
    };
  } catch (error) {
    logger.debug('networkinfo lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return { followers: null, connections: null };
  }
}

function parseContactInfo(payload: unknown): ContactInfo | null {
  if (!isObject(payload)) return null;

  const websites = asArray(payload.websites)
    .filter(isObject)
    .map((site) => {
      const url = str(site.url);
      if (!url) return null;
      // The category is buried under a fully-qualified union key.
      const typeObject = isObject(site.type) ? site.type : {};
      const standard = typeObject['com.linkedin.voyager.identity.profile.StandardWebsite'];
      const custom = typeObject['com.linkedin.voyager.identity.profile.CustomWebsite'];
      const label =
        str(isObject(standard) ? standard.category : null) ??
        str(isObject(custom) ? custom.label : null);
      return { url, label };
    })
    .filter((site): site is { url: string; label: string | null } => site !== null);

  return {
    websites,
    twitterHandles: asArray(payload.twitterHandles)
      .map((handle) => str(isObject(handle) ? handle.name : handle))
      .filter((handle): handle is string => handle !== null),
    emailAddress: str(payload.emailAddress),
    phoneNumbers: asArray(payload.phoneNumbers)
      .filter(isObject)
      .map((phone) => ({ number: str(phone.number) ?? '', type: str(phone.type) }))
      .filter((phone) => phone.number !== ''),
    birthDate: partialDate(payload.birthDateOn),
    address: str(payload.address),
  };
}

async function fetchContactInfo(publicId: string): Promise<ContactInfo | null> {
  try {
    const result = await voyagerGet(
      `/identity/profiles/${encodeURIComponent(publicId)}/profileContactInfo`,
    );
    if (result.status >= 400) return null;
    return parseContactInfo(result.json);
  } catch (error) {
    logger.debug('contact info lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Sections that `profileView` truncates. Skills in particular are capped at a
 * handful inline, so the standalone endpoint is worth the extra call whenever
 * the inline list looks suspiciously short.
 */
const ENRICHABLE = [
  { key: 'skills', endpoint: 'skills', parser: sectionParsers.skills, minExpected: 10 },
  { key: 'certifications', endpoint: 'certifications', parser: sectionParsers.certifications, minExpected: 1 },
  { key: 'languages', endpoint: 'languages', parser: sectionParsers.languages, minExpected: 1 },
  { key: 'honors', endpoint: 'honors', parser: sectionParsers.honors, minExpected: 1 },
  { key: 'projects', endpoint: 'projects', parser: sectionParsers.projects, minExpected: 1 },
] as const;

async function enrichSections(profile: LinkedInProfile, publicId: string): Promise<void> {
  for (const section of ENRICHABLE) {
    const existing = profile[section.key] as unknown[];
    if (existing.length >= section.minExpected) continue;

    try {
      const result = await voyagerGet(
        `/identity/profiles/${encodeURIComponent(publicId)}/${section.endpoint}?count=100&start=0`,
      );
      if (result.status >= 400 || !isObject(result.json)) continue;

      const elements = asArray(result.json.elements).filter(isObject);
      if (elements.length <= existing.length) continue;

      const parsed = elements.map((element) => (section.parser as (e: Json) => unknown)(element));
      (profile[section.key] as unknown[]) = parsed;

      logger.debug('enriched section', { section: section.key, count: parsed.length });
    } catch (error) {
      logger.debug('section enrichment failed', {
        section: section.key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export interface FetchOptions {
  /** Skip the cache and force a fresh upstream fetch. */
  refresh?: boolean;
  /** Skip the extra enrichment calls; faster, but thinner skills/certs. */
  fast?: boolean;
}

export async function fetchProfile(
  publicId: string,
  options: FetchOptions = {},
): Promise<ProfileResponse> {
  const startedAt = Date.now();
  const cacheKey = publicId.toLowerCase();

  if (!options.refresh) {
    const hit = cache.get(cacheKey);
    if (hit) {
      return { ...hit, meta: { ...hit.meta, cached: true } };
    }
  }

  const attempts: ProfileMeta['attempts'] = [];
  // Ordered best-first. GraphQL is the richest and most reliable path; the
  // REST endpoints below it are retained as fallbacks for the day LinkedIn
  // rotates the GraphQL query id, and the public page as a last resort.
  const strategies: Array<{ source: ProfileSource; run: () => Promise<StrategyOutcome> }> = [
    { source: 'voyager-graphql', run: () => tryGraphql(publicId) },
    { source: 'voyager-profile-view', run: () => tryProfileView(publicId) },
    { source: 'voyager-dash', run: () => tryDash(publicId) },
  ];

  if (config.linkedin.allowPublicFallback) {
    strategies.push({ source: 'public-page', run: () => tryPublicPage(publicId) });
  }

  let outcome: StrategyOutcome | null = null;
  let fatal: ApiError | null = null;

  for (const strategy of strategies) {
    try {
      outcome = await strategy.run();
      attempts.push({ source: strategy.source, ok: true });
      break;
    } catch (error) {
      // A 404 or an auth challenge is conclusive — trying the next strategy
      // would just repeat the same failure more slowly.
      if (error instanceof ApiError && error.status === 404) throw error;

      if (error instanceof LinkedInChallengeError) {
        fatal = ApiError.upstream('LINKEDIN_CHALLENGE_REQUIRED', error.message, {
          challengeUrl: error.challengeUrl,
        });
      } else if (error instanceof LinkedInAuthError) {
        fatal = ApiError.upstream('LINKEDIN_AUTH_FAILED', error.message);
      } else if (error instanceof ApiError && error.code === 'LINKEDIN_RATE_LIMITED') {
        throw error;
      }

      attempts.push({ source: strategy.source, ok: false, reason: describeError(error) });
      logger.warn('profile strategy failed', {
        source: strategy.source,
        publicId,
        reason: describeError(error),
      });
    }
  }

  if (!outcome) {
    if (fatal) throw fatal;
    throw ApiError.upstream(
      'LINKEDIN_UNAVAILABLE',
      `Every retrieval strategy failed for /in/${publicId}.`,
      { attempts },
    );
  }

  const { profile } = outcome;
  const unavailable = new Set(outcome.unavailableSections);

  // The GraphQL path already returns every section, plus connection count,
  // inline — so its only missing piece is contact info, which lives behind a
  // separate call. The legacy REST paths need per-section enrichment because
  // they truncate skills and omit network counts.
  if (outcome.source === 'voyager-graphql') {
    // Contact info (email/phone/websites) is not exposed by any endpoint the
    // current app uses for arbitrary members — it is bundled into the profile
    // cards and only rendered for the viewer's own connections. We therefore
    // report it as unavailable rather than spend a round-trip that 302s.
    unavailable.add('contactInfo');
  } else if (outcome.source !== 'public-page') {
    const network = await fetchNetworkInfo(publicId);
    profile.followerCount = network.followers;
    profile.connectionCount = network.connections;

    if (!options.fast) {
      await enrichSections(profile, publicId);
      profile.contactInfo = await fetchContactInfo(publicId);
      if (profile.contactInfo === null) unavailable.add('contactInfo');
    }

    for (const section of ENRICHABLE) {
      if ((profile[section.key] as unknown[]).length > 0) unavailable.delete(section.key);
    }
  }

  profile.currentPositions = profile.experience.filter((position) => position.dates.current);

  const response: ProfileResponse = {
    success: true,
    meta: {
      profileUrl: profileUrlFor(profile.publicIdentifier ?? publicId),
      publicIdentifier: profile.publicIdentifier ?? publicId,
      source: outcome.source,
      attempts,
      fetchedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      cached: false,
      unavailableSections: [...unavailable].sort(),
    },
    data: profile,
  };

  cache.set(cacheKey, response);
  return response;
}

export function cacheStats(): { size: number; ttlMs: number } {
  return { size: cache.size, ttlMs: config.cache.ttlMs };
}

export function clearProfileCache(): void {
  cache.clear();
}
