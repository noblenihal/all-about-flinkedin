import { ProxyAgent, type Dispatcher } from 'undici';
import { config } from '../config';
import { logger } from '../logger';
import type { CookieJar } from './cookieJar';

export interface HttpResponse {
  status: number;
  headers: Headers;
  location?: string;
  body: string;
  url: string;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: string;
  jar?: CookieJar;
  /** `manual` keeps 3xx responses intact so we can inspect redirect targets. */
  redirect?: 'manual' | 'follow';
  timeoutMs?: number;
}

const proxyUrl =
  process.env.LINKEDIN_PROXY_URL || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';

const dispatcher: Dispatcher | undefined = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

if (proxyUrl) {
  logger.info('Outbound LinkedIn traffic is routed through a proxy.');
}

let lastRequestAt = 0;

/**
 * LinkedIn is quick to throttle bursts, so outbound calls are serialised with a
 * minimum gap. The gate is process-local; a multi-instance deployment would
 * need to move it to a shared store.
 */
async function throttle(): Promise<void> {
  const gap = config.linkedin.minRequestGapMs;
  if (gap <= 0) return;
  const waitMs = lastRequestAt + gap - Date.now();
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastRequestAt = Date.now();
}

export async function httpRequest(
  url: string,
  options: HttpRequestOptions = {},
): Promise<HttpResponse> {
  const {
    method = 'GET',
    headers = {},
    body,
    jar,
    redirect = 'manual',
    timeoutMs = config.linkedin.requestTimeoutMs,
  } = options;

  await throttle();

  const requestHeaders: Record<string, string> = { ...headers };
  if (jar) {
    const cookieHeader = jar.toHeader();
    if (cookieHeader) requestHeaders.cookie = cookieHeader;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body,
      redirect,
      signal: controller.signal,
      // `dispatcher` is an undici extension to the fetch options bag.
      ...(dispatcher ? ({ dispatcher } as Record<string, unknown>) : {}),
    });

    if (jar) {
      jar.ingest(response.headers.getSetCookie());
    }

    const text = await response.text();

    return {
      status: response.status,
      headers: response.headers,
      location: response.headers.get('location') ?? undefined,
      body: text,
      url: response.url || url,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request to ${new URL(url).pathname} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
