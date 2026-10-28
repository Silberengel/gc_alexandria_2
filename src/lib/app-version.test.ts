import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { APP_BUILD, APP_VERSION } from './constants';

describe('APP_VERSION', () => {
  it('matches package.json so About can show the release in the GUI', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    expect(APP_BUILD).toMatch(new RegExp(`^${pkg.version.replace(/\./g, '\\.')}\\+`));
  });
});
