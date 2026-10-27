import { describe, expect, it } from 'vitest';
import {
  normalizeDirectoryBrowserPrefs,
  resolvedDirectoryColumnWidth,
  DEFAULT_DIRECTORY_COLUMN_WIDTHS
} from './directory-browser-prefs';

describe('normalizeDirectoryBrowserPrefs', () => {
  it('defaults sort and empty widths', () => {
    expect(normalizeDirectoryBrowserPrefs(null)).toEqual({
      sortCol: 'name',
      sortDir: 'asc',
      widths: {}
    });
  });

  it('keeps valid sort and widths', () => {
    expect(
      normalizeDirectoryBrowserPrefs({
        sortCol: 'created',
        sortDir: 'desc',
        widths: { name: 320, created: 90, junk: 10 }
      })
    ).toEqual({
      sortCol: 'created',
      sortDir: 'desc',
      widths: { name: 320, created: 90 }
    });
  });

  it('drops widths below the minimum', () => {
    expect(
      normalizeDirectoryBrowserPrefs({ widths: { name: 12, objects: 48 } }).widths
    ).toEqual({ objects: 48 });
  });

  it('resolves default widths when unset', () => {
    const prefs = normalizeDirectoryBrowserPrefs(null);
    expect(resolvedDirectoryColumnWidth(prefs, 'name')).toBe(
      DEFAULT_DIRECTORY_COLUMN_WIDTHS.name
    );
  });
});
