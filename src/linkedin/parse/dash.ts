import type {
  Certification,
  Company,
  Course,
  DateRange,
  Education,
  Honor,
  Language,
  LinkedInProfile,
  Organization,
  Patent,
  Position,
  Project,
  Publication,
  Skill,
  TestScore,
  VolunteerExperience,
} from '../../types/profile';
import {
  EMPTY_DATE_RANGE,
  asArray,
  bool,
  companyUrlFromUrn,
  dig,
  formatDuration,
  formatPartialDate,
  isObject,
  num,
  partialDate,
  str,
  text,
  vectorImage,
  type Json,
} from './common';

const TYPE = {
  profile: 'com.linkedin.voyager.dash.identity.profile.Profile',
  position: 'com.linkedin.voyager.dash.identity.profile.Position',
  education: 'com.linkedin.voyager.dash.identity.profile.Education',
  skill: 'com.linkedin.voyager.dash.identity.profile.Skill',
  certification: 'com.linkedin.voyager.dash.identity.profile.Certification',
  language: 'com.linkedin.voyager.dash.identity.profile.Language',
  honor: 'com.linkedin.voyager.dash.identity.profile.Honor',
  project: 'com.linkedin.voyager.dash.identity.profile.Project',
  publication: 'com.linkedin.voyager.dash.identity.profile.Publication',
  volunteer: 'com.linkedin.voyager.dash.identity.profile.VolunteerExperience',
  course: 'com.linkedin.voyager.dash.identity.profile.Course',
  organization: 'com.linkedin.voyager.dash.identity.profile.Organization',
  patent: 'com.linkedin.voyager.dash.identity.profile.Patent',
  testScore: 'com.linkedin.voyager.dash.identity.profile.TestScore',
  company: 'com.linkedin.voyager.dash.organization.Company',
  school: 'com.linkedin.voyager.dash.organization.School',
  industry: 'com.linkedin.voyager.dash.common.Industry',
  geo: 'com.linkedin.voyager.dash.common.Geo',
} as const;

/**
 * An index over a `normalized+json` response.
 *
 * LinkedIn returns a flat `included` array of entities that reference each
 * other by `entityUrn`. Walking a fixed path through `data` is brittle because
 * LinkedIn reshuffles the wrapper structure between releases, but the leaf
 * `$type` values are stable. So we ignore the wrappers entirely and select by
 * type, dereferencing `*Urn` fields on demand.
 */
class Graph {
  private readonly byUrn = new Map<string, Json>();
  private readonly byType = new Map<string, Json[]>();

  constructor(included: unknown) {
    for (const entity of asArray(included)) {
      if (!isObject(entity)) continue;

      const urn = str(entity.entityUrn);
      if (urn) this.byUrn.set(urn, entity);

      const type = str(entity.$type);
      if (type) {
        const bucket = this.byType.get(type);
        if (bucket) bucket.push(entity);
        else this.byType.set(type, [entity]);
      }
    }
  }

  ofType(type: string): Json[] {
    return this.byType.get(type) ?? [];
  }

  resolve(urn: unknown): Json | undefined {
    const key = str(urn);
    return key ? this.byUrn.get(key) : undefined;
  }

  /** Resolves a field that may hold either an inline object or a URN string. */
  deref(value: unknown): Json | undefined {
    if (isObject(value)) return value;
    return this.resolve(value);
  }

  has(type: string): boolean {
    return this.byType.has(type);
  }
}

/** Dash uses `dateRange: {start, end}` rather than the legacy `timePeriod`. */
function dashDateRange(value: unknown): DateRange {
  if (!isObject(value)) return { ...EMPTY_DATE_RANGE };

  const start = partialDate(value.start);
  const end = partialDate(value.end);
  const current = start !== null && end === null;

  let durationMonths: number | null = null;
  if (start?.year && end?.year) {
    const months = (end.year - start.year) * 12 + ((end.month ?? 1) - (start.month ?? 1));
    durationMonths = months >= 0 ? months + 1 : null;
  }

  return {
    start,
    end,
    startText: formatPartialDate(start),
    endText: end ? formatPartialDate(end) : current ? 'Present' : null,
    durationText: formatDuration(durationMonths),
    durationMonths,
    current,
  };
}

function companyFrom(graph: Graph, element: Json): Company {
  const company = graph.deref(element.company ?? element.companyUrn) ?? {};
  const universalName = str(company.universalName);
  const urn = str(element.companyUrn) ?? str(company.entityUrn);

  return {
    name: str(element.companyName) ?? text(company.name) ?? str(company.name),
    urn,
    linkedinUrl: universalName
      ? `https://www.linkedin.com/company/${universalName}/`
      : str(company.url) ?? companyUrlFromUrn(urn),
    logo: vectorImage(company.logo ?? company.logoResolutionResult),
    industry: text(graph.deref(dig(company, 'industry', 0))?.name) ?? null,
    staffCountRange: null,
  };
}

function toPosition(graph: Graph, element: Json): Position {
  return {
    title: text(element.title) ?? str(element.title),
    employmentType: str(element.employmentType) ?? null,
    company: companyFrom(graph, element),
    location: str(element.locationName) ?? text(element.location),
    locationType: str(element.workplaceType) ?? null,
    description: text(element.description) ?? str(element.description),
    dates: dashDateRange(element.dateRange),
    skills: [],
  };
}

function toEducation(graph: Graph, element: Json): Education {
  const school = graph.deref(element.school ?? element.schoolUrn) ?? {};
  const urn = str(element.schoolUrn) ?? str(school.entityUrn);
  return {
    schoolName: str(element.schoolName) ?? text(school.name),
    schoolUrn: urn,
    schoolLinkedinUrl: str(school.url) ?? companyUrlFromUrn(urn),
    logo: vectorImage(school.logo ?? school.logoResolutionResult),
    degreeName: str(element.degreeName),
    fieldOfStudy: str(element.fieldOfStudy),
    grade: str(element.grade),
    activities: str(element.activities),
    description: text(element.description) ?? str(element.description),
    dates: dashDateRange(element.dateRange),
  };
}

function toSkill(element: Json): Skill {
  return {
    name: text(element.name) ?? str(element.name) ?? '',
    endorsementCount: num(dig(element, 'endorsementCount')),
    associatedWith: [],
  };
}

function toCertification(graph: Graph, element: Json): Certification {
  const authority = graph.deref(element.company ?? element.companyUrn) ?? {};
  return {
    name: text(element.name) ?? str(element.name),
    authority: str(element.authority) ?? text(authority.name),
    authorityUrn: str(element.companyUrn) ?? str(authority.entityUrn),
    logo: vectorImage(authority.logo ?? authority.logoResolutionResult),
    licenseNumber: str(element.licenseNumber),
    url: str(element.url),
    dates: dashDateRange(element.dateRange),
  };
}

function toLanguage(element: Json): Language {
  return {
    name: text(element.name) ?? str(element.name),
    proficiency: str(element.proficiency),
  };
}

function toProject(element: Json): Project {
  return {
    title: text(element.title) ?? str(element.title),
    description: text(element.description) ?? str(element.description),
    url: str(element.url),
    dates: dashDateRange(element.dateRange),
    contributors: [],
  };
}

function toPublication(element: Json): Publication {
  return {
    name: text(element.name) ?? str(element.name),
    publisher: str(element.publisher),
    description: text(element.description) ?? str(element.description),
    url: str(element.url),
    publishedOn: partialDate(element.publishedOn ?? element.date),
    authors: [],
  };
}

function toHonor(element: Json): Honor {
  return {
    title: text(element.title) ?? str(element.title),
    issuer: str(element.issuer),
    description: text(element.description) ?? str(element.description),
    issuedOn: partialDate(element.issuedOn ?? element.issueDate),
  };
}

function toVolunteer(element: Json): VolunteerExperience {
  return {
    role: str(element.role),
    organization: str(element.companyName),
    cause: str(element.cause),
    description: text(element.description) ?? str(element.description),
    dates: dashDateRange(element.dateRange),
  };
}

function toCourse(element: Json): Course {
  return { name: text(element.name) ?? str(element.name), number: str(element.number) };
}

function toOrganization(element: Json): Organization {
  return {
    name: text(element.name) ?? str(element.name),
    position: str(element.position),
    description: text(element.description) ?? str(element.description),
    dates: dashDateRange(element.dateRange),
  };
}

function toPatent(element: Json): Patent {
  return {
    title: text(element.title) ?? str(element.title),
    number: str(element.number),
    description: text(element.description) ?? str(element.description),
    url: str(element.url),
    issuedOn: partialDate(element.issuedOn ?? element.filedOn),
    inventors: [],
  };
}

function toTestScore(element: Json): TestScore {
  return {
    name: text(element.name) ?? str(element.name),
    score: str(element.score),
    description: text(element.description) ?? str(element.description),
    takenOn: partialDate(element.dateOn ?? element.date),
  };
}

/**
 * Picks the Profile entity belonging to the person we asked for. A dash
 * response also includes Profile entities for connections, recommenders and
 * post authors, so matching on `publicIdentifier` matters.
 */
function selectProfile(graph: Graph, publicId: string): Json | undefined {
  const profiles = graph.ofType(TYPE.profile);
  const exact = profiles.find(
    (profile) => str(profile.publicIdentifier)?.toLowerCase() === publicId.toLowerCase(),
  );
  if (exact) return exact;
  // Fall back to the most fully-populated entity — the subject of the request
  // is always the one LinkedIn decorated with the most fields.
  return profiles.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0];
}

export interface DashParseResult {
  profile: LinkedInProfile;
  unavailableSections: string[];
}

export function parseDashProfile(payload: unknown, publicId: string): DashParseResult {
  if (!isObject(payload)) throw new Error('dash payload was not an object');

  // `included` is the normalized graph; `elements`/`data` hold the entry points.
  const graph = new Graph(payload.included ?? dig(payload, 'data', 'included'));
  const profile = selectProfile(graph, publicId) ?? {};

  if (Object.keys(profile).length === 0) {
    throw new Error('dash payload contained no Profile entity');
  }

  const firstName = str(profile.firstName);
  const lastName = str(profile.lastName);
  const resolvedPublicId = str(profile.publicIdentifier) ?? publicId;

  const experience = graph.ofType(TYPE.position).map((element) => toPosition(graph, element));

  const geo = graph.deref(profile.geoLocation ?? profile.geoLocationUrn) ?? {};
  const locationLabel =
    text(dig(profile, 'geoLocation', 'geo', 'defaultLocalizedName')) ??
    str(profile.geoLocationName) ??
    text(geo.defaultLocalizedName) ??
    text(dig(profile, 'location', 'countryRegion'));

  const unavailableSections = (
    [
      ['experience', TYPE.position],
      ['education', TYPE.education],
      ['skills', TYPE.skill],
      ['certifications', TYPE.certification],
      ['languages', TYPE.language],
      ['projects', TYPE.project],
      ['publications', TYPE.publication],
      ['honors', TYPE.honor],
      ['volunteer', TYPE.volunteer],
      ['courses', TYPE.course],
      ['organizations', TYPE.organization],
      ['patents', TYPE.patent],
      ['testScores', TYPE.testScore],
    ] as Array<[string, string]>
  )
    .filter(([, type]) => !graph.has(type))
    .map(([name]) => name);

  return {
    unavailableSections,
    profile: {
      publicIdentifier: resolvedPublicId,
      profileUrl: `https://www.linkedin.com/in/${resolvedPublicId}/`,
      urn: str(profile.entityUrn),

      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
      maidenName: str(profile.maidenName),
      pronouns: str(profile.standardizedPronoun) ?? str(profile.customPronoun),

      headline: text(profile.headline) ?? str(profile.headline),
      about: text(profile.summary) ?? str(profile.summary),
      location: {
        full: locationLabel,
        city: null,
        state: null,
        country: text(dig(profile, 'location', 'countryRegion')) ?? null,
        countryCode: str(dig(profile, 'location', 'countryCode'))?.toUpperCase() ?? null,
      },
      industry: text(graph.deref(profile.industry ?? profile.industryUrn)?.name) ?? null,

      isPremium: bool(profile.premium),
      isInfluencer: bool(profile.influencer),
      isOpenToWork: bool(profile.openToWork),
      isHiring: bool(profile.hiring),
      isVerified: bool(dig(profile, 'verificationData', 'verified')),

      connectionCount: null,
      followerCount: null,

      profilePicture: vectorImage(profile.profilePicture),
      backgroundImage: vectorImage(profile.backgroundImage ?? profile.backgroundPicture),

      currentPositions: experience.filter((position) => position.dates.current),
      experience,
      education: graph.ofType(TYPE.education).map((element) => toEducation(graph, element)),
      skills: graph.ofType(TYPE.skill).map(toSkill).filter((skill) => skill.name !== ''),
      certifications: graph
        .ofType(TYPE.certification)
        .map((element) => toCertification(graph, element)),
      languages: graph.ofType(TYPE.language).map(toLanguage),
      projects: graph.ofType(TYPE.project).map(toProject),
      publications: graph.ofType(TYPE.publication).map(toPublication),
      honors: graph.ofType(TYPE.honor).map(toHonor),
      volunteer: graph.ofType(TYPE.volunteer).map(toVolunteer),
      courses: graph.ofType(TYPE.course).map(toCourse),
      organizations: graph.ofType(TYPE.organization).map(toOrganization),
      patents: graph.ofType(TYPE.patent).map(toPatent),
      testScores: graph.ofType(TYPE.testScore).map(toTestScore),
      recommendationsReceived: [],

      contactInfo: null,
    },
  };
}
