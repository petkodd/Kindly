import { describe, it, expect, afterEach } from 'vitest';
import { getAppBaseUrl, AppUrlConfigError } from '../src/lib/appUrl';

afterEach(() => {
  delete process.env.APP_BASE_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete process.env.VERCEL_ENV;
});

describe('getAppBaseUrl — production', () => {
  it('throws rather than silently defaulting to localhost when APP_BASE_URL is unset in a Vercel production environment', () => {
    process.env.VERCEL_ENV = 'production';
    expect(() => getAppBaseUrl()).toThrow(AppUrlConfigError);
    expect(() => getAppBaseUrl()).toThrow(/APP_BASE_URL is not set/);
  });

  it('uses the configured APP_BASE_URL in production', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.APP_BASE_URL = 'https://www.dearlyhere.com';
    expect(getAppBaseUrl()).toBe('https://www.dearlyhere.com');
  });

  it('falls back to NEXT_PUBLIC_SITE_URL in production when APP_BASE_URL is unset', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://www.dearlyhere.com';
    expect(getAppBaseUrl()).toBe('https://www.dearlyhere.com');
  });
});

describe('getAppBaseUrl — preview / local (no VERCEL_ENV=production)', () => {
  it('defaults to http://localhost:3000 with nothing configured and no VERCEL_ENV set', () => {
    expect(getAppBaseUrl()).toBe('http://localhost:3000');
  });

  it('defaults to http://localhost:3000 in a Vercel preview environment with nothing configured', () => {
    process.env.VERCEL_ENV = 'preview';
    expect(getAppBaseUrl()).toBe('http://localhost:3000');
  });

  it('uses a Preview-scoped APP_BASE_URL when set', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.APP_BASE_URL = 'https://kindly-app-git-feature-branch.vercel.app';
    expect(getAppBaseUrl()).toBe('https://kindly-app-git-feature-branch.vercel.app');
  });

  it('uses a locally configured APP_BASE_URL for local testing', () => {
    process.env.APP_BASE_URL = 'http://localhost:3001';
    expect(getAppBaseUrl()).toBe('http://localhost:3001');
  });
});

describe('getAppBaseUrl — validation', () => {
  it('throws AppUrlConfigError for a malformed URL', () => {
    process.env.APP_BASE_URL = 'not a url';
    expect(() => getAppBaseUrl()).toThrow(AppUrlConfigError);
  });

  it('throws for a non-http(s) scheme', () => {
    process.env.APP_BASE_URL = 'ftp://example.com';
    expect(() => getAppBaseUrl()).toThrow(AppUrlConfigError);
  });

  it('throws for a protocol-relative or bare-host value new URL() cannot parse as absolute', () => {
    process.env.APP_BASE_URL = 'www.dearlyhere.com';
    expect(() => getAppBaseUrl()).toThrow(AppUrlConfigError);
  });
});

describe('getAppBaseUrl — trailing slash normalization', () => {
  it('strips a single trailing slash from a bare origin', () => {
    process.env.APP_BASE_URL = 'https://www.dearlyhere.com/';
    expect(getAppBaseUrl()).toBe('https://www.dearlyhere.com');
  });

  it('strips repeated trailing slashes', () => {
    process.env.APP_BASE_URL = 'https://www.dearlyhere.com//';
    expect(getAppBaseUrl()).toBe('https://www.dearlyhere.com');
  });

  it('leaves a URL with no trailing slash unchanged', () => {
    process.env.APP_BASE_URL = 'https://www.dearlyhere.com';
    expect(getAppBaseUrl()).toBe('https://www.dearlyhere.com');
  });

  it('strips a trailing slash after a path, keeping the path itself', () => {
    process.env.APP_BASE_URL = 'https://www.dearlyhere.com/app/';
    expect(getAppBaseUrl()).toBe('https://www.dearlyhere.com/app');
  });

  it('APP_BASE_URL takes precedence over NEXT_PUBLIC_SITE_URL when both are set', () => {
    process.env.APP_BASE_URL = 'https://primary.example.com';
    process.env.NEXT_PUBLIC_SITE_URL = 'https://fallback.example.com';
    expect(getAppBaseUrl()).toBe('https://primary.example.com');
  });
});
