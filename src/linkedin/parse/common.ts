import type { DateRange, ImageAsset, PartialDate } from '../../types/profile';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

/** Reads a nested path, returning undefined instead of throwing on any gap. */
export function dig(source: unknown, ...path: (string | number)[]): unknown {
  let cursor: unknown = source;
  for (const key of path) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof key === 'number') {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[key];
    } else {
      if (!isObject(cursor)) return undefined;
      cursor = cursor[key];
    }
  }
  return cursor;
}

export function str(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }
  if (typeof value === 'number') return String(value);
  return null;
}

export function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function bool(value: unknown): boolean {
  return value === true;
}

/**
 * LinkedIn wraps most user-authored text in an "attributed text" envelope that
 * carries formatting spans alongside the plain string. Every generation of the
 * API has used a slightly different envelope, so unwrap them all.
 */
export function text(value: unknown): string | null {
  if (typeof value === 'string') return str(value);
  if (!isObject(value)) return null;

  const candidates = [value.text, value.value, dig(value, 'attributedText', 'text')];
  for (const candidate of candidates) {
    const result = str(candidate);
    if (result) return result;
  }

  // Newer dash payloads: { attributesV2: [...], text: "..." } nested one deeper.
  for (const key of ['title', 'subtitle', 'caption', 'description', 'name']) {
    const nested = value[key];
    if (isObject(nested)) {
      const result = str(nested.text);
      if (result) return result;
    }
  }
  return null;
}

export function partialDate(value: unknown): PartialDate | null {
  if (!isObject(value)) return null;
  const year = num(value.year);
  const month = num(value.month);
  const day = num(value.day);
  if (year === null && month === null && day === null) return null;
  return { year, month, day };
}

export function formatPartialDate(date: PartialDate | null): string | null {
  if (!date) return null;
  const month =
    date.month && date.month >= 1 && date.month <= 12 ? (MONTHS[date.month - 1] ?? null) : null;
  if (month && date.year) return `${month} ${date.year}`;
  if (date.year) return String(date.year);
  return month;
}

function monthsBetween(start: PartialDate, end: PartialDate): number | null {
  if (!start.year || !end.year) return null;
  const months = (end.year - start.year) * 12 + ((end.month ?? 1) - (start.month ?? 1));
  return months >= 0 ? months + 1 : null;
}

export function formatDuration(months: number | null): string | null {
  if (months === null || months <= 0) return null;
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} yr${years === 1 ? '' : 's'}`);
  if (remainder > 0) parts.push(`${remainder} mo${remainder === 1 ? '' : 's'}`);
  return parts.join(' ') || null;
}

export const EMPTY_DATE_RANGE: DateRange = {
  start: null,
  end: null,
  startText: null,
  endText: null,
  durationText: null,
  durationMonths: null,
  current: false,
};

/** Builds a DateRange from a Voyager `timePeriod` object. */
export function dateRange(timePeriod: unknown): DateRange {
  if (!isObject(timePeriod)) return { ...EMPTY_DATE_RANGE };

  const start = partialDate(timePeriod.startDate);
  const end = partialDate(timePeriod.endDate);
  const current = start !== null && end === null;

  const durationMonths = start && end ? monthsBetween(start, end) : null;

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

/**
 * Builds a DateRange from a GraphQL `dateRange` object of the shape
 * `{ start: {year, month, day}, end: {...} | null }`. This is the modern
 * profile model's date shape, distinct from the legacy `timePeriod`.
 */
export function graphqlDateRange(value: unknown): DateRange {
  if (!isObject(value)) return { ...EMPTY_DATE_RANGE };

  const start = partialDate(value.start);
  const end = partialDate(value.end);
  const current = start !== null && end === null;

  let durationMonths: number | null = null;
  if (start?.year && end?.year) {
    durationMonths = monthsBetween(start, end);
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

/**
 * Turns a Voyager VectorImage into an ImageAsset.
 *
 * A VectorImage is a `rootUrl` plus a list of artifacts, each carrying the
 * path segment for one rendition. The full URL is the concatenation — the
 * segments are signed and expire, typically within a few weeks.
 */
export function vectorImage(value: unknown): ImageAsset | null {
  if (!isObject(value)) return null;

  // Peel the known wrappers: dash puts it under displayImageReference, the
  // legacy API under a fully-qualified type key.
  const candidates: unknown[] = [
    value,
    value['com.linkedin.common.VectorImage'],
    dig(value, 'displayImageReference', 'vectorImage'),
    dig(value, 'vectorImage'),
    dig(value, 'displayImageReference'),
    dig(value, 'artifact', 'vectorImage'),
  ];

  for (const candidate of candidates) {
    if (!isObject(candidate)) continue;
    const rootUrl = str(candidate.rootUrl);
    const artifacts = asArray(candidate.artifacts);
    if (!rootUrl || artifacts.length === 0) continue;

    const renditions = artifacts
      .filter(isObject)
      .map((artifact) => ({
        url: `${rootUrl}${str(artifact.fileIdentifyingUrlPathSegment) ?? ''}`,
        width: num(artifact.width),
        height: num(artifact.height),
      }))
      .filter((rendition) => rendition.url !== rootUrl)
      .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));

    if (renditions.length === 0) continue;

    return { url: renditions[renditions.length - 1]?.url ?? null, renditions };
  }

  // Some payloads carry a plain absolute URL instead of a vector image.
  const direct = str(value.url) ?? str(dig(value, 'displayImageReference', 'url'));
  if (direct?.startsWith('http')) {
    return { url: direct, renditions: [{ url: direct, width: null, height: null }] };
  }

  return null;
}

/** `urn:li:fsd_company:1234` -> `1234` */
export function urnId(urn: unknown): string | null {
  const value = str(urn);
  if (!value) return null;
  const parts = value.split(':');
  const last = parts[parts.length - 1];
  return last ?? null;
}

export function companyUrlFromUrn(urn: unknown): string | null {
  const id = urnId(urn);
  const value = str(urn);
  if (!id || !value) return null;
  if (value.includes('school')) return `https://www.linkedin.com/school/${id}/`;
  if (value.includes('company')) return `https://www.linkedin.com/company/${id}/`;
  return null;
}

/** Collapses whitespace and decodes the entities LinkedIn emits into HTML. */
export function cleanHtmlText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
