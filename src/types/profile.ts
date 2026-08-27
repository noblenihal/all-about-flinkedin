/**
 * The public response schema.
 *
 * Design rules, applied consistently across every field:
 *  - Scalars that LinkedIn may omit are `string | null`, never `undefined`, so
 *    consumers can rely on the key existing.
 *  - Collections are always arrays; an empty array means "nothing found",
 *    which is distinct from a section the account could not see at all
 *    (reported separately under `meta.unavailableSections`).
 *  - Dates are exposed both structured (`start`/`end`) and as the raw label
 *    LinkedIn rendered (`startText`/`endText`), because LinkedIn frequently
 *    supplies only a month/year and consumers want the original wording.
 */

export interface PartialDate {
  year: number | null;
  month: number | null;
  day: number | null;
}

export interface DateRange {
  start: PartialDate | null;
  end: PartialDate | null;
  /** e.g. "Jan 2021" */
  startText: string | null;
  /** e.g. "Present" */
  endText: string | null;
  /** e.g. "2 yrs 3 mos", as LinkedIn renders it. */
  durationText: string | null;
  durationMonths: number | null;
  current: boolean;
}

export interface ImageAsset {
  /** Largest available rendition. */
  url: string | null;
  /** All renditions LinkedIn returned, smallest first. */
  renditions: Array<{ url: string; width: number | null; height: number | null }>;
}

export interface Location {
  /** The single line LinkedIn shows under the headline. */
  full: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  countryCode: string | null;
}

export interface Company {
  name: string | null;
  urn: string | null;
  linkedinUrl: string | null;
  logo: ImageAsset | null;
  industry: string | null;
  staffCountRange: string | null;
}

export interface Position {
  title: string | null;
  employmentType: string | null;
  company: Company;
  location: string | null;
  locationType: string | null;
  description: string | null;
  dates: DateRange;
  skills: string[];
}

export interface Education {
  schoolName: string | null;
  schoolUrn: string | null;
  schoolLinkedinUrl: string | null;
  logo: ImageAsset | null;
  degreeName: string | null;
  fieldOfStudy: string | null;
  grade: string | null;
  activities: string | null;
  description: string | null;
  dates: DateRange;
}

export interface Skill {
  name: string;
  endorsementCount: number | null;
  /** Companies/schools LinkedIn associates the skill with, when shown. */
  associatedWith: string[];
}

export interface Certification {
  name: string | null;
  authority: string | null;
  authorityUrn: string | null;
  logo: ImageAsset | null;
  licenseNumber: string | null;
  url: string | null;
  dates: DateRange;
}

export interface Language {
  name: string | null;
  proficiency: string | null;
}

export interface Project {
  title: string | null;
  description: string | null;
  url: string | null;
  dates: DateRange;
  contributors: string[];
}

export interface Publication {
  name: string | null;
  publisher: string | null;
  description: string | null;
  url: string | null;
  publishedOn: PartialDate | null;
  authors: string[];
}

export interface Honor {
  title: string | null;
  issuer: string | null;
  description: string | null;
  issuedOn: PartialDate | null;
}

export interface VolunteerExperience {
  role: string | null;
  organization: string | null;
  cause: string | null;
  description: string | null;
  dates: DateRange;
}

export interface Course {
  name: string | null;
  number: string | null;
}

export interface Organization {
  name: string | null;
  position: string | null;
  description: string | null;
  dates: DateRange;
}

export interface Patent {
  title: string | null;
  number: string | null;
  description: string | null;
  url: string | null;
  issuedOn: PartialDate | null;
  inventors: string[];
}

export interface TestScore {
  name: string | null;
  score: string | null;
  description: string | null;
  takenOn: PartialDate | null;
}

export interface Recommendation {
  authorName: string | null;
  authorHeadline: string | null;
  authorProfileUrl: string | null;
  relationship: string | null;
  text: string | null;
}

export interface ContactInfo {
  websites: Array<{ url: string; label: string | null }>;
  twitterHandles: string[];
  emailAddress: string | null;
  phoneNumbers: Array<{ number: string; type: string | null }>;
  birthDate: PartialDate | null;
  address: string | null;
}

export interface LinkedInProfile {
  publicIdentifier: string | null;
  profileUrl: string | null;
  urn: string | null;

  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  /** Phonetic/alternate name LinkedIn shows in parentheses, when set. */
  maidenName: string | null;
  pronouns: string | null;

  headline: string | null;
  about: string | null;
  location: Location;
  industry: string | null;

  isPremium: boolean;
  isInfluencer: boolean;
  isOpenToWork: boolean;
  isHiring: boolean;
  isVerified: boolean;

  connectionCount: number | null;
  followerCount: number | null;

  profilePicture: ImageAsset | null;
  backgroundImage: ImageAsset | null;

  currentPositions: Position[];
  experience: Position[];
  education: Education[];
  skills: Skill[];
  certifications: Certification[];
  languages: Language[];
  projects: Project[];
  publications: Publication[];
  honors: Honor[];
  volunteer: VolunteerExperience[];
  courses: Course[];
  organizations: Organization[];
  patents: Patent[];
  testScores: TestScore[];
  recommendationsReceived: Recommendation[];

  contactInfo: ContactInfo | null;
}

/** Which upstream strategy produced the payload. */
export type ProfileSource =
  | 'voyager-graphql'
  | 'voyager-profile-view'
  | 'voyager-dash'
  | 'public-page';

export interface ProfileMeta {
  profileUrl: string;
  publicIdentifier: string;
  source: ProfileSource;
  /** Strategies that were tried and rejected, with the reason. */
  attempts: Array<{ source: ProfileSource; ok: boolean; reason?: string }>;
  fetchedAt: string;
  durationMs: number;
  cached: boolean;
  /**
   * Sections the upstream response did not include at all. An empty
   * `certifications` array plus `"certifications"` here means "we could not
   * see them", not "this person has none".
   */
  unavailableSections: string[];
}

export interface ProfileResponse {
  success: true;
  meta: ProfileMeta;
  data: LinkedInProfile;
}
