import type {
  Certification,
  Company,
  Course,
  Education,
  Honor,
  Language,
  LinkedInProfile,
  Location,
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
  dateRange,
  dig,
  isObject,
  num,
  partialDate,
  str,
  urnId,
  vectorImage,
  type Json,
} from './common';

/** Every `*View` in a profileView response is a paged collection. */
function elements(view: unknown): Json[] {
  const raw = isObject(view) ? view.elements : undefined;
  return asArray(raw).filter(isObject);
}

function buildCompany(element: Json): Company {
  const mini = isObject(element.company)
    ? (element.company.miniCompany as unknown)
    : undefined;
  const miniCompany = isObject(mini) ? mini : {};

  const urn =
    str(element.companyUrn) ?? str(miniCompany.entityUrn) ?? str(dig(element, 'company', 'entityUrn'));

  const universalName = str(miniCompany.universalName);

  return {
    name: str(element.companyName) ?? str(miniCompany.name),
    urn,
    linkedinUrl: universalName
      ? `https://www.linkedin.com/company/${universalName}/`
      : companyUrlFromUrn(urn),
    logo: vectorImage(miniCompany.logo),
    industry: str(dig(element, 'company', 'industries', 0)),
    staffCountRange: formatStaffRange(dig(element, 'company', 'employeeCountRange')),
  };
}

function formatStaffRange(range: unknown): string | null {
  if (!isObject(range)) return null;
  const start = num(range.start);
  const end = num(range.end);
  if (start !== null && end !== null) return `${start}-${end}`;
  if (start !== null) return `${start}+`;
  if (end !== null) return `0-${end}`;
  return null;
}

function parsePosition(element: Json): Position {
  return {
    title: str(element.title),
    employmentType: str(element.employmentType) ?? str(dig(element, 'employmentTypeUrn')),
    company: buildCompany(element),
    location: str(element.locationName) ?? str(element.geoLocationName),
    locationType: str(element.workplaceType) ?? null,
    description: str(element.description),
    dates: dateRange(element.timePeriod),
    skills: asArray(element.skills)
      .map((skill) => str(isObject(skill) ? skill.name : skill))
      .filter((skill): skill is string => skill !== null),
  };
}

/**
 * Positions arrive either flat (`positionView`) or grouped by company
 * (`positionGroupView`, one group per employer with nested role changes).
 * Grouped is preferred when present because it is the shape LinkedIn renders,
 * but it omits nothing the flat list has, so we merge and de-duplicate.
 */
function parseExperience(payload: Json): Position[] {
  const flat = elements(payload.positionView).map(parsePosition);

  const grouped: Position[] = [];
  for (const group of elements(payload.positionGroupView)) {
    for (const role of elements(group.positions ?? group)) {
      grouped.push(parsePosition(role));
    }
  }

  const merged = [...flat, ...grouped];
  const seen = new Set<string>();
  return merged.filter((position) => {
    const key = [
      position.title,
      position.company.name,
      position.dates.startText,
      position.dates.endText,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseEducation(element: Json): Education {
  const school = isObject(element.school) ? element.school : {};
  const urn = str(element.schoolUrn) ?? str(school.entityUrn);
  return {
    schoolName: str(element.schoolName) ?? str(school.schoolName) ?? str(school.name),
    schoolUrn: urn,
    schoolLinkedinUrl: companyUrlFromUrn(urn),
    logo: vectorImage(school.logo),
    degreeName: str(element.degreeName),
    fieldOfStudy: str(element.fieldOfStudy),
    grade: str(element.grade),
    activities: str(element.activities),
    description: str(element.description),
    dates: dateRange(element.timePeriod),
  };
}

function parseSkill(element: Json): Skill {
  return {
    name: str(element.name) ?? '',
    endorsementCount: num(element.endorsementCount) ?? num(dig(element, 'endorsedByViewer')),
    associatedWith: [],
  };
}

function parseCertification(element: Json): Certification {
  const company = isObject(element.company) ? element.company : {};
  const mini = isObject(company.miniCompany) ? company.miniCompany : {};
  return {
    name: str(element.name),
    authority: str(element.authority) ?? str(mini.name),
    authorityUrn: str(element.companyUrn) ?? str(mini.entityUrn),
    logo: vectorImage(mini.logo),
    licenseNumber: str(element.licenseNumber),
    url: str(element.url),
    dates: dateRange(element.timePeriod),
  };
}

function parseLanguage(element: Json): Language {
  return { name: str(element.name), proficiency: str(element.proficiency) };
}

function parseProject(element: Json): Project {
  return {
    title: str(element.title),
    description: str(element.description),
    url: str(element.url),
    dates: dateRange(element.timePeriod),
    contributors: asArray(element.members)
      .filter(isObject)
      .map((member) => {
        const profile = isObject(member.member) ? member.member : {};
        const first = str(profile.firstName);
        const last = str(profile.lastName);
        return [first, last].filter(Boolean).join(' ') || null;
      })
      .filter((name): name is string => name !== null),
  };
}

function parsePublication(element: Json): Publication {
  return {
    name: str(element.name),
    publisher: str(element.publisher),
    description: str(element.description),
    url: str(element.url),
    publishedOn: partialDate(dig(element, 'date')),
    authors: asArray(element.authors)
      .filter(isObject)
      .map((author) => {
        const profile = isObject(author.member) ? author.member : {};
        return [str(profile.firstName), str(profile.lastName)].filter(Boolean).join(' ') || null;
      })
      .filter((name): name is string => name !== null),
  };
}

function parseHonor(element: Json): Honor {
  return {
    title: str(element.title),
    issuer: str(element.issuer),
    description: str(element.description),
    issuedOn: partialDate(element.issueDate),
  };
}

function parseVolunteer(element: Json): VolunteerExperience {
  return {
    role: str(element.role),
    organization: str(element.companyName),
    cause: str(element.cause),
    description: str(element.description),
    dates: dateRange(element.timePeriod),
  };
}

function parseCourse(element: Json): Course {
  return { name: str(element.name), number: str(element.number) };
}

function parseOrganization(element: Json): Organization {
  return {
    name: str(element.name),
    position: str(element.position),
    description: str(element.description),
    dates: dateRange(element.timePeriod),
  };
}

function parsePatent(element: Json): Patent {
  return {
    title: str(element.title),
    number: str(element.number),
    description: str(element.description),
    url: str(element.url),
    issuedOn: partialDate(element.issueDate) ?? partialDate(element.filingDate),
    inventors: asArray(element.inventors)
      .filter(isObject)
      .map((inventor) => {
        const profile = isObject(inventor.member) ? inventor.member : {};
        return [str(profile.firstName), str(profile.lastName)].filter(Boolean).join(' ') || null;
      })
      .filter((name): name is string => name !== null),
  };
}

function parseTestScore(element: Json): TestScore {
  return {
    name: str(element.name),
    score: str(element.score),
    description: str(element.description),
    takenOn: partialDate(element.date),
  };
}

function parseLocation(profile: Json): Location {
  const location = isObject(profile.location) ? profile.location : {};
  const basic = isObject(location.basicLocation) ? location.basicLocation : {};
  return {
    full: str(profile.geoLocationName) ?? str(profile.locationName) ?? str(location.name),
    city: str(basic.city) ?? null,
    state: str(basic.state) ?? null,
    country: str(profile.geoCountryName) ?? str(basic.countryCode),
    countryCode: str(basic.countryCode)?.toUpperCase() ?? null,
  };
}

/** Sections whose absence should be reported rather than shown as empty. */
const SECTION_KEYS: Array<[string, string]> = [
  ['experience', 'positionView'],
  ['education', 'educationView'],
  ['skills', 'skillView'],
  ['certifications', 'certificationView'],
  ['languages', 'languageView'],
  ['projects', 'projectView'],
  ['publications', 'publicationView'],
  ['honors', 'honorView'],
  ['volunteer', 'volunteerExperienceView'],
  ['courses', 'courseView'],
  ['organizations', 'organizationView'],
  ['patents', 'patentView'],
  ['testScores', 'testScoreView'],
];

export interface ProfileViewParseResult {
  profile: LinkedInProfile;
  unavailableSections: string[];
}

export function parseProfileView(payload: unknown, publicId: string): ProfileViewParseResult {
  if (!isObject(payload)) {
    throw new Error('profileView payload was not an object');
  }

  const profile = isObject(payload.profile) ? payload.profile : {};
  const mini = isObject(profile.miniProfile) ? profile.miniProfile : {};

  const firstName = str(profile.firstName) ?? str(mini.firstName);
  const lastName = str(profile.lastName) ?? str(mini.lastName);
  const resolvedPublicId = str(profile.publicIdentifier) ?? str(mini.publicIdentifier) ?? publicId;

  const experience = parseExperience(payload);

  const unavailableSections = SECTION_KEYS.filter(([, viewKey]) => !isObject(payload[viewKey])).map(
    ([name]) => name,
  );

  return {
    unavailableSections,
    profile: {
      publicIdentifier: resolvedPublicId,
      profileUrl: `https://www.linkedin.com/in/${resolvedPublicId}/`,
      urn: str(profile.entityUrn) ?? str(mini.entityUrn),

      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
      maidenName: str(profile.maidenName),
      pronouns: str(dig(profile, 'pronoun', 'standardizedPronoun')) ?? str(profile.customPronoun),

      headline: str(profile.headline) ?? str(mini.occupation),
      about: str(profile.summary),
      location: parseLocation(profile),
      industry: str(profile.industryName),

      isPremium: bool(profile.premium) || bool(mini.premium),
      isInfluencer: bool(profile.influencer) || bool(mini.influencer),
      isOpenToWork: isObject(profile.openToWork) || bool(profile.openToWork),
      isHiring: isObject(profile.hiringOpportunities) || bool(profile.hiring),
      isVerified: bool(profile.verified) || bool(dig(profile, 'verificationData', 'verified')),

      connectionCount: null,
      followerCount: null,

      profilePicture:
        vectorImage(mini.picture) ??
        vectorImage(profile.profilePicture) ??
        vectorImage(profile.picture),
      backgroundImage:
        vectorImage(mini.backgroundImage) ??
        vectorImage(profile.backgroundPicture) ??
        vectorImage(profile.backgroundImage),

      currentPositions: experience.filter((position) => position.dates.current),
      experience,
      education: elements(payload.educationView).map(parseEducation),
      skills: elements(payload.skillView).map(parseSkill).filter((skill) => skill.name !== ''),
      certifications: elements(payload.certificationView).map(parseCertification),
      languages: elements(payload.languageView).map(parseLanguage),
      projects: elements(payload.projectView).map(parseProject),
      publications: elements(payload.publicationView).map(parsePublication),
      honors: elements(payload.honorView).map(parseHonor),
      volunteer: elements(payload.volunteerExperienceView).map(parseVolunteer),
      courses: elements(payload.courseView).map(parseCourse),
      organizations: elements(payload.organizationView).map(parseOrganization),
      patents: elements(payload.patentView).map(parsePatent),
      testScores: elements(payload.testScoreView).map(parseTestScore),
      recommendationsReceived: [],

      contactInfo: null,
    },
  };
}

/** Parsers for the standalone per-section endpoints, reused during enrichment. */
export const sectionParsers = {
  positions: parsePosition,
  educations: parseEducation,
  skills: parseSkill,
  certifications: parseCertification,
  languages: parseLanguage,
  projects: parseProject,
  publications: parsePublication,
  honors: parseHonor,
  volunteerExperiences: parseVolunteer,
  courses: parseCourse,
  organizations: parseOrganization,
  patents: parsePatent,
  testScores: parseTestScore,
} as const;

export { elements as collectionElements, EMPTY_DATE_RANGE, urnId };
