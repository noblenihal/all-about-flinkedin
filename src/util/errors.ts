/** Machine-readable error codes returned in the API envelope. */
export type ApiErrorCode =
  | 'INVALID_URL'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_PRIVATE'
  | 'LINKEDIN_AUTH_FAILED'
  | 'LINKEDIN_CHALLENGE_REQUIRED'
  | 'LINKEDIN_RATE_LIMITED'
  | 'LINKEDIN_UNAVAILABLE'
  | 'PARSE_FAILED'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(code: ApiErrorCode, message: string, details?: unknown): ApiError {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(message = 'A valid API key is required.'): ApiError {
    return new ApiError(401, 'UNAUTHORIZED', message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, 'PROFILE_NOT_FOUND', message);
  }

  static upstream(code: ApiErrorCode, message: string, details?: unknown): ApiError {
    return new ApiError(502, code, message, details);
  }
}

/** Raised when LinkedIn answers a login attempt with a checkpoint/captcha. */
export class LinkedInChallengeError extends Error {
  readonly challengeUrl?: string;

  constructor(message: string, challengeUrl?: string) {
    super(message);
    this.name = 'LinkedInChallengeError';
    this.challengeUrl = challengeUrl;
  }
}

export class LinkedInAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkedInAuthError';
  }
}
