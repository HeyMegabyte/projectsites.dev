/**
 * @module services/google_sheets
 * @description Google Sheets integration for ProjectSites.
 *
 * Allows sites to use Google Sheets as a data source for dynamic content
 * (blog posts, menus, team members, events, etc.).
 *
 * Uses the Google Sheets API v4 to fetch data from public or API-key-accessible
 * spreadsheets. The first row of each sheet is treated as headers, and subsequent
 * rows are returned as key-value records.
 *
 * @packageDocumentation
 */

/**
 * Response shape from Google Sheets API v4 `spreadsheets.values.get`.
 *
 * @remarks
 * Only the fields we actually use are typed here. The full API response
 * includes additional metadata (range, majorDimension) that we ignore.
 */
interface SheetsValuesResponse {
  values?: string[][];
}

/**
 * Response shape from Google Sheets API v4 `spreadsheets.get` (metadata only).
 */
interface SheetsMetadataResponse {
  sheets?: Array<{
    properties: {
      title: string;
      gridProperties: {
        rowCount: number;
        columnCount: number;
      };
    };
  }>;
}

/**
 * Metadata about a single sheet tab within a spreadsheet.
 *
 * @example
 * ```ts
 * const meta = await fetchSheetMeta('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms', apiKey);
 * // [{ name: 'Menu Items', rows: 50, columns: 6 }, ...]
 * ```
 */
export interface SheetTabMeta {
  /** Display name of the sheet tab. */
  name: string;
  /** Total number of rows (including header). */
  rows: number;
  /** Total number of columns. */
  columns: number;
}

/**
 * Fetch data from a public Google Sheet, returning rows as key-value records.
 *
 * The first row is treated as column headers. Each subsequent row becomes a
 * `Record<string, string>` keyed by header name.
 *
 * @param sheetId - The Google Sheets spreadsheet ID (from the URL).
 * @param tabName - Optional tab/sheet name. Defaults to the first sheet.
 * @param apiKey  - Google API key with Sheets API enabled. Falls back to empty string.
 * @returns Array of row records. Empty array if the sheet has fewer than 2 rows.
 *
 * @throws Error if the Sheets API returns a non-OK status.
 *
 * @example
 * ```ts
 * const rows = await fetchSheetData(
 *   '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
 *   'Menu Items',
 *   env.GOOGLE_SHEETS_API_KEY,
 * );
 * // [{ Name: 'Margherita', Price: '$12', Category: 'Pizza' }, ...]
 * ```
 *
 * @see https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets.values/get
 */
export async function fetchSheetData(
  sheetId: string,
  tabName?: string,
  apiKey?: string,
): Promise<Record<string, string>[]> {
  const range = tabName ? `'${tabName}'!A:ZZ` : 'A:ZZ';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${encodeURIComponent(range)}?key=${apiKey || ''}&valueRenderOption=FORMATTED_VALUE`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Sheets API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as SheetsValuesResponse;
  if (!data.values || data.values.length < 2) return [];

  // First row is headers, rest are data rows
  const headers = data.values[0];
  return data.values.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = row[i] || '';
    });
    return record;
  });
}

/**
 * Fetch spreadsheet metadata: tab names, row counts, and column counts.
 *
 * Useful for discovering which tabs are available before fetching data.
 *
 * @param sheetId - The Google Sheets spreadsheet ID.
 * @param apiKey  - Google API key with Sheets API enabled.
 * @returns Array of tab metadata objects.
 *
 * @throws Error if the Sheets API returns a non-OK status.
 *
 * @example
 * ```ts
 * const tabs = await fetchSheetMeta('1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms', apiKey);
 * // [{ name: 'Sheet1', rows: 100, columns: 10 }]
 * ```
 *
 * @see https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/get
 */
export async function fetchSheetMeta(
  sheetId: string,
  apiKey?: string,
): Promise<SheetTabMeta[]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?key=${apiKey || ''}&fields=sheets.properties`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Sheets API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as SheetsMetadataResponse;
  return (data.sheets || []).map((s) => ({
    name: s.properties.title,
    rows: s.properties.gridProperties.rowCount,
    columns: s.properties.gridProperties.columnCount,
  }));
}
