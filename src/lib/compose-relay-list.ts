import { parseRelayRwLine, type RelayRwMarker } from '@silberengel/kind-compose-catalog';

export type RelayRow = { url: string; marker: RelayRwMarker };

export function formatRelayRwLine(row: RelayRow): string {
  const url = row.url.trim();
  if (!url) return '';
  if (row.marker === 'both') return url;
  return `${url} ${row.marker}`;
}

export function relayRowsFromRaw(raw: string, withMarkers: boolean): RelayRow[] {
  if (!raw) return [{ url: '', marker: 'both' }];
  const lines = raw.split('\n');
  if (lines.every((line) => !line.trim())) return [{ url: '', marker: 'both' }];
  return lines.map((line) => {
    if (!line.trim()) return { url: '', marker: 'both' as const };
    if (!withMarkers) return { url: line.trim(), marker: 'both' as const };
    const parsed = parseRelayRwLine(line);
    if (parsed) return { url: parsed.url, marker: parsed.marker };
    return { url: line.trim(), marker: 'both' as const };
  });
}

export function formatRelayRows(rows: RelayRow[], withMarkers: boolean): string {
  return rows
    .map((row) => (withMarkers ? formatRelayRwLine(row) : row.url.trim()))
    .join('\n');
}
