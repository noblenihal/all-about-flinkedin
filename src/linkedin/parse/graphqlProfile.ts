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
  asArray,
  bool,
  companyUrlFromUrn,
  dig,
  graphqlDateRange,
  isObject,
  num,
  partialDate,
  str,
  urnId,
  vectorImage,
  type Json,
} from './common';

/**
 * Parser for the modern profile GraphQL response.
 *
 * The query is `FullProfileByMemberIdentity`
 * (`voyagerIdentityDashProfiles.5f50f83f76a1e270603613bdd0fb0252`), whose
 * query id and variable name (`memberIdentity`) were lifted from the LinkedIn
 * Android app's generated `ProfileGraphQLClient`. Requested with a plain
 * `application/json` Accept header, it returns the whole profile — every
 * section nested inline — as a single collection element under
 * `data.identityDashProfilesByMemberIdentity.elements[0]`.
 *
 * This is the primary and richest data source. It is the only path observed to
 * return complete data for profiles that the retired REST endpoints refuse
 * (HTTP 410) or that the logged-out page hides behind the auth wall.
 */

/** Unwraps a `{ paging, elements: [...] }` collection to its element array. */
function collection(value: unknown): Json[] {
  if (!isObject(value)) return [];
  return asArray(value.elements).filter(isObject);
}

/**
 * LinkedIn returns a display image under a `*ResolutionResult` wrapper that
 * holds the resolved `vectorImage`. Company logos, school logos, profile and
 * background photos all follow this shape with different wrapper names.
 */
function resolvedImage(value: unknown, ...wrapperKeys: string[]) {
  if (!isObject(value)) return null;
  for (const key of wrapperKeys) {
    const wrapper = value[key];
    const image = vectorImage(isObject(wrapper) ? wrapper.vectorImage ?? wrapper : wrapper);
    if (image) return image;
  }
  return vectorImage(value);
}

function buildCompany(element: Json): Company {
  const company = isObject(element.company) ? element.company : {};
  const urn = str(company.entityUrn) ?? str(element.companyUrn);
  const universalName = str(company.universalName);

  return {
    name: str(element.companyName) ?? str(company.name),
    urn,
    linkedinUrl: universalName
      ? `https://www.linkedin.com/company/${universalName}/`
      : str(company.url) ?? companyUrlFromUrn(urn),
    logo: resolvedImage(company.logoResolutionResult ?? company.logo, 'vectorImage'),
    industry: str(dig(company, 'industry', 0, 'name')) ?? null,
    staffCountRange: null,
  };
}

function parsePosition(element: Json): Position {
  return {
    title: str(element.title),
    employmentType: str(dig(element, 'employmentType', 'name')) ?? str(element.employmentType),
    company: buildCompany(element),
    location: str(element.locationName) ?? str(element.geoLocationName),
    locationType: str(dig(element, 'workplaceType', 0, 'localizedName')) ?? null,
    description: str(element.description),
    dates: graphqlDateRange(element.dateRange),
    skills: [],
  };
}

/**
 * Experience is grouped by employer: each group carries the company plus a
 * nested list of roles held there. A single-role group still nests one role,
 * so flattening the nested lists yields every position uniformly.
 */
function parseExperience(profile: Json): Position[] {
  const groups = collection(profile.profilePositionGroups);
  const positions: Position[] = [];

  for (const group of groups) {
    const roles = collection(group.profilePositionInPositionGroup);
    if (roles.length === 0) {
      // A group with no nested roles is itself a single position.
      positions.push(parsePosition(group));
      continue;
    }
    for (const role of roles) {
      // Roles inherit the group's company when they don't restate it.
      const merged: Json = { ...role };
      if (!merged.company && group.company) merged.company = group.company;
      if (!merged.companyName && group.companyName) merged.companyName = group.companyName;
      positions.push(parsePosition(merged));
    }
  }

  // Some responses only populate the flat `profilePositions` list.
  if (positions.length === 0) {
    for (const position of collection(profile.profilePositions)) {
      positions.push(parsePosition(position));
    }
  }

  return positions;
}

function parseEducation(element: Json): Education {
  const school = isObject(element.school) ? element.school : {};
  const urn = str(school.entityUrn) ?? str(element.schoolUrn);
  return {
    schoolName: str(element.schoolName) ?? str(school.name),
    schoolUrn: urn,
    schoolLinkedinUrl: str(school.url) ?? companyUrlFromUrn(urn),
    logo: resolvedImage(school.logoResolutionResult ?? school.logo, 'vectorImage'),
    degreeName: str(element.degreeName),
    fieldOfStudy: str(element.fieldOfStudy),
    grade: str(element.grade),
    activities: str(element.activities),
    description: str(element.description),
    dates: graphqlDateRange(element.dateRange),
  };
}

function parseSkill(element: Json): Skill {
  return {
    name: str(element.name) ?? '',
    endorsementCount: num(dig(element, 'endorsementCount')),
    associatedWith: [],
  };
}

function parseCertification(element: Json): Certification {
  const company = isObject(element.company) ? element.company : {};
  return {
    name: str(element.name),
    authority: str(element.authority) ?? str(company.name),
    authorityUrn: str(company.entityUrn) ?? str(element.companyUrn),
    logo: resolvedImage(company.logoResolutionResult ?? company.logo, 'vectorImage'),
    licenseNumber: str(element.licenseNumber),
    url: str(element.url),
    dates: graphqlDateRange(element.dateRange),
  };
}

function parseLanguage(element: Json): Language {
  return {
    name: str(element.name),
    proficiency: str(dig(element, 'proficiency', 'name')) ?? str(element.proficiency),
  };
}

function contributorNames(value: unknown): string[] {
  return asArray(value)
    .filter(isObject)
    .map((entry) => {
      const member = isObject(entry.member) ? entry.member : entry;
      const name = [str(member.firstName), str(member.lastName)].filter(Boolean).join(' ');
      return name || str(entry.name) || null;
    })
    .filter((name): name is string => name !== null);
}

function parseProject(element: Json): Project {
  return {
    title: str(element.title),
    description: str(element.description),
    url: str(element.url),
    dates: graphqlDateRange(element.dateRange),
    contributors: contributorNames(dig(element, 'profileProjectMembers', 'elements') ?? element.members),
  };
}

function parsePublication(element: Json): Publication {
  return {
    name: str(element.name),
    publisher: str(element.publisher),
    description: str(element.description),
    url: str(element.url),
    publishedOn: partialDate(element.publishedOn ?? element.date),
    authors: contributorNames(dig(element, 'profilePublicationAuthors', 'elements') ?? element.authors),
  };
}

function parseHonor(element: Json): Honor {
  return {
    title: str(element.title),
    issuer: str(element.issuer),
    description: str(element.description),
    issuedOn: partialDate(element.issuedOn ?? element.issueDate),
  };
}

function parseVolunteer(element: Json): VolunteerExperience {
  return {
    role: str(element.role),
    organization: str(element.companyName) ?? str(dig(element, 'company', 'name')),
    cause: str(dig(element, 'cause', 'name')) ?? str(element.cause),
    description: str(element.description),
    dates: graphqlDateRange(element.dateRange),
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
    dates: graphqlDateRange(element.dateRange),
  };
}

function parsePatent(element: Json): Patent {
  return {
    title: str(element.title),
    number: str(element.number) ?? str(element.applicationNumber),
    description: str(element.description),
    url: str(element.url),
    issuedOn: partialDate(element.issuedOn ?? element.filedOn),
    inventors: contributorNames(dig(element, 'profilePatentInventors', 'elements') ?? element.inventors),
  };
}

function parseTestScore(element: Json): TestScore {
  return {
    name: str(element.name),
    score: str(element.score),
    description: str(element.description),
    takenOn: partialDate(element.dateOn ?? element.date),
  };
}

function parseLocation(profile: Json): Location {
  const geo = isObject(profile.geoLocation) ? profile.geoLocation : {};
  const geoInner = isObject(geo.geo) ? geo.geo : {};
  const country = isObject(geoInner.country) ? geoInner.country : {};

  const full =
    str(profile.geoLocationName) ??
    str(geoInner.defaultLocalizedNameWithoutCountryName) ??
    str(geoInner.defaultLocalizedName);

  return {
    full,
    city: null,
    state: str(profile.state) ?? null,
    country: str(country.defaultLocalizedName),
    countryCode: str(dig(country, 'countryCode'))?.toUpperCase() ?? null,
  };
}

/** Section key on the profile object paired with its output field name. */
const SECTIONS: Array<[keyof LinkedInProfile, string]> = [
  ['education', 'profileEducations'],
  ['skills', 'profileSkills'],
  ['certifications', 'profileCertifications'],
  ['languages', 'profileLanguages'],
  ['projects', 'profileProjects'],
  ['publications', 'profilePublications'],
  ['honors', 'profileHonors'],
  ['volunteer', 'profileVolunteerExperiences'],
  ['courses', 'profileCourses'],
  ['organizations', 'profileOrganizations'],
  ['patents', 'profilePatents'],
  ['testScores', 'profileTestScores'],
];

export interface GraphqlParseResult {
  profile: LinkedInProfile;
  unavailableSections: string[];
}

export function parseGraphqlProfile(payload: unknown, publicId: string): GraphqlParseResult {
  const element = dig(payload, 'data', 'identityDashProfilesByMemberIdentity', 'elements', 0);
  if (!isObject(element)) {
    throw new Error('GraphQL response contained no profile element');
  }

  const profile = element;
  const firstName = str(profile.firstName);
  const lastName = str(profile.lastName);
  const resolvedPublicId = str(profile.publicIdentifier) ?? publicId;

  const experience = parseExperience(profile);
  const education = collection(profile.profileEducations).map(parseEducation);
  const skills = collection(profile.profileSkills).map(parseSkill).filter((s) => s.name !== '');
  const certifications = collection(profile.profileCertifications).map(parseCertification);
  const languages = collection(profile.profileLanguages).map(parseLanguage);
  const projects = collection(profile.profileProjects).map(parseProject);
  const publications = collection(profile.profilePublications).map(parsePublication);
  const honors = collection(profile.profileHonors).map(parseHonor);
  const volunteer = collection(profile.profileVolunteerExperiences).map(parseVolunteer);
  const courses = collection(profile.profileCourses).map(parseCourse);
  const organizations = collection(profile.profileOrganizations).map(parseOrganization);
  const patents = collection(profile.profilePatents).map(parsePatent);
  const testScores = collection(profile.profileTestScores).map(parseTestScore);

  // A section is "unavailable" when the key is absent entirely — distinct from
  // present-but-empty, which means the person simply has no entries.
  const unavailableSections = SECTIONS.filter(([, key]) => !(key in profile)).map(
    ([name]) => name as string,
  );

  const connectionTotal = num(dig(profile, 'connections', 'paging', 'total'));

  return {
    unavailableSections,
    profile: {
      publicIdentifier: resolvedPublicId,
      profileUrl: `https://www.linkedin.com/in/${resolvedPublicId}/`,
      urn: str(profile.entityUrn) ?? str(profile.objectUrn),

      firstName,
      lastName,
      fullName: [firstName, lastName].filter(Boolean).join(' ') || null,
      maidenName: str(profile.maidenName),
      pronouns: str(dig(profile, 'pronoun', 'standardizedPronoun', 'name')) ?? str(profile.pronoun),

      headline: str(profile.headline),
      about: str(profile.summary),
      location: parseLocation(profile),
      industry: str(dig(profile, 'industry', 'name')),

      isPremium: bool(profile.premium) || bool(profile.showPremiumSubscriberBadge),
      isInfluencer: bool(profile.influencer),
      isOpenToWork: 'profileOpenToWorkModule' in profile || bool(profile.openToWork),
      isHiring: bool(profile.hiring),
      isVerified: bool(dig(profile, 'verificationData', 'verified')),

      connectionCount: connectionTotal,
      followerCount: num(dig(profile, 'followingState', 'followerCount')),

      profilePicture: resolvedImage(
        profile.profilePicture,
        'displayImageReferenceResolutionResult',
        'displayImageWithFrameReference',
      ),
      backgroundImage: resolvedImage(
        profile.backgroundPicture ?? profile.backgroundImage,
        'displayImageReferenceResolutionResult',
      ),

      currentPositions: experience.filter((position) => position.dates.current),
      experience,
      education,
      skills,
      certifications,
      languages,
      projects,
      publications,
      honors,
      volunteer,
      courses,
      organizations,
      patents,
      testScores,
      recommendationsReceived: [],

      contactInfo: null,
    },
  };
}

export { urnId };
