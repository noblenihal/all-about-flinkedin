/**
 * A deliberately small cookie jar.
 *
 * Every request this service makes goes to a `*.linkedin.com` host, so the
 * full RFC 6265 domain/path matching machinery would be dead weight. What we
 * do need is exact: LinkedIn's Voyager API rejects requests whose `JSESSIONID`
 * cookie and `csrf-token` header disagree, so the jar has to preserve the
 * quoting of the JSESSIONID value verbatim.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Feed this the raw `set-cookie` lines from a response. */
  ingest(setCookieHeaders: readonly string[]): void {
    for (const header of setCookieHeaders) {
      const [pair] = header.split(';');
      if (!pair) continue;
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;

      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!name) continue;

      // LinkedIn clears cookies by setting them to `""` on logout/challenge.
      if (value === '' || value === '""') {
        this.cookies.delete(name);
        continue;
      }
      this.cookies.set(name, value);
    }
  }

  set(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  /** Cookie value with surrounding double quotes stripped. */
  getUnquoted(name: string): string | undefined {
    const value = this.cookies.get(name);
    if (value === undefined) return undefined;
    return value.replace(/^"(.*)"$/, '$1');
  }

  has(name: string): boolean {
    return this.cookies.has(name);
  }

  delete(name: string): void {
    this.cookies.delete(name);
  }

  clear(): void {
    this.cookies.clear();
  }

  /** Serialised for the `cookie` request header. */
  toHeader(): string {
    return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  names(): string[] {
    return [...this.cookies.keys()];
  }

  toJSON(): Record<string, string> {
    return Object.fromEntries(this.cookies);
  }

  static fromJSON(record: Record<string, string>): CookieJar {
    const jar = new CookieJar();
    for (const [name, value] of Object.entries(record)) jar.set(name, value);
    return jar;
  }
}
