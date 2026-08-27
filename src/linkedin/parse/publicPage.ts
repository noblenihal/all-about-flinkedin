import type { Education, LinkedInProfile, Position } from '../../types/profile';
import {
  EMPTY_DATE_RANGE,
  asArray,
  cleanHtmlText,
  dig,
  isObject,
  num,
  str,
  type Json,
} from './common';

/**
 * Parses the logged-out public profile page.
 *
 * This is the degraded path. LinkedIn embeds a schema.org JSON-LD block in the
 * public page, which gives name, headline, location, about, and coarse
 * employment/education history — but no dates, no skills, no certifications.
 * It exists so the API can still answer when the authenticated paths are
 * blocked, with `meta.source` telling the caller the data is thinner.
 */

function extractJsonLd(html: string): Json[] {
  const blocks: Json[] = [];
  const pattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    const body = match[1];
    if (!body) continue;
    try {
      const parsed: unknown = JSON.parse(body.trim());
      // LinkedIn wraps everything in an @graph array.
      for (const node of asArray(isObject(parsed) ? (parsed['@graph'] ?? parsed) : parsed)) {
        if (isObject(node)) blocks.push(node);
      }
    } catch {
      // A malformed block is not worth failing the whole parse over.
    }
  }
  return blocks;
}

function findPerson(nodes: Json[]): Json | undefined {
  return nodes.find((node) => {
    const type = node['@type'];
    return type === 'Person' || (Array.isArray(type) && type.includes('Person'));
  });
}

function metaTag(html: string, property: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]*)"`,
    'i',
  );
  const match = html.match(pattern);
  return match?.[1] ? cleanHtmlText(match[1]) : null;
}

function toPosition(node: unknown): Position | null {
  if (!isObject(node)) return null;

  const organization = isObject(node.worksFor) ? node.worksFor : node;
  const name = str(organization.name) ?? str(node.name);
  const title = str(node.jobTitle) ?? str(dig(node, 'hasOccupation', 'name'));

  if (!name && !title) return null;

  return {
    title,
    employmentType: null,
    company: {
      name,
      urn: null,
      linkedinUrl: str(organization.url) ?? null,
      logo: null,
      industry: null,
      staffCountRange: null,
    },
    location: str(dig(node, 'location', 'name')) ?? null,
    locationType: null,
    description: str(node.description),
    dates: { ...EMPTY_DATE_RANGE },
    skills: [],
  };
}

function toEducation(node: unknown): Education | null {
  if (!isObject(node)) return null;
  const name = str(node.name);
  if (!name) return null;

  return {
    schoolName: name,
    schoolUrn: null,
    schoolLinkedinUrl: str(node.url),
    logo: null,
    degreeName: null,
    fieldOfStudy: null,
    grade: null,
    activities: null,
    description: null,
    dates: { ...EMPTY_DATE_RANGE },
  };
}

export interface PublicPageParseResult {
  profile: LinkedInProfile;
  unavailableSections: string[];
}

/** Sections the public page never contains, whatever the person actually has. */
const ALWAYS_MISSING = [
  'skills',
  'certifications',
  'languages',
  'projects',
  'publications',
  'honors',
  'volunteer',
  'courses',
  'organizations',
  'patents',
  'testScores',
  'contactInfo',
  'experienceDates',
  'educationDates',
];

export function parsePublicPage(html: string, publicId: string): PublicPageParseResult {
  const nodes = extractJsonLd(html);
  const person = findPerson(nodes);

  const metaName =
    [metaTag(html, 'profile:first_name'), metaTag(html, 'profile:last_name')]
      .filter(Boolean)
      .join(' ') || null;

  const resolvedName = str(person?.name) ?? metaName;
  const [firstName = null, ...restName] = (resolvedName ?? '').split(' ');

  const headline =
    str(person?.jobTitle) ??
    (Array.isArray(person?.jobTitle) ? str(person?.jobTitle[0]) : null) ??
    metaTag(html, 'og:title')?.replace(/\s*\|\s*LinkedIn\s*$/, '') ??
    null;

  const about = str(person?.description) ?? metaTag(html, 'og:description');

  const address = isObject(person?.address) ? person.address : {};
  const locationFull =
    [str(address.addressLocality), str(address.addressRegion), str(address.addressCountry)]
      .filter(Boolean)
      .join(', ') || null;

  const image =
    str(dig(person, 'image', 'contentUrl')) ?? metaTag(html, 'og:image');

  const experience = asArray(person?.worksFor)
    .map(toPosition)
    .filter((position): position is Position => position !== null);

  const education = asArray(person?.alumniOf)
    .map(toEducation)
    .filter((entry): entry is Education => entry !== null);

  if (!resolvedName && experience.length === 0) {
    throw new Error('public page contained no recognisable profile data');
  }

  return {
    unavailableSections: [...ALWAYS_MISSING],
    profile: {
      publicIdentifier: publicId,
      profileUrl: `https://www.linkedin.com/in/${publicId}/`,
      urn: null,

      firstName: firstName || null,
      lastName: restName.join(' ') || null,
      fullName: resolvedName,
      maidenName: null,
      pronouns: null,

      headline,
      about,
      location: {
        full: locationFull,
        city: str(address.addressLocality),
        state: str(address.addressRegion),
        country: str(address.addressCountry),
        countryCode: null,
      },
      industry: null,

      isPremium: false,
      isInfluencer: false,
      isOpenToWork: false,
      isHiring: false,
      isVerified: false,

      connectionCount: num(dig(person, 'interactionStatistic', 'userInteractionCount')),
      followerCount: null,

      profilePicture: image
        ? { url: image, renditions: [{ url: image, width: null, height: null }] }
        : null,
      backgroundImage: null,

      currentPositions: [],
      experience,
      education,
      skills: [],
      certifications: [],
      languages: [],
      projects: [],
      publications: [],
      honors: [],
      volunteer: [],
      courses: [],
      organizations: [],
      patents: [],
      testScores: [],
      recommendationsReceived: [],

      contactInfo: null,
    },
  };
}
