import * as fs from 'fs';
import * as path from 'path';

export interface IssueRecord {
  // Unique composite key: ID + Date (different sessions = different rows)
  session_key: string;

  // Data tab
  identification_link: string;    // ID link
  user_id: string;                // uuid
  close_type: string;             // CloseType enum [approve, reject, close]
  app_version: string;
  os_version: string;             // Cleaned: "iOS 16.1" not "iosiOS 16.1"
  model: string;                  // iPhone
  date: string;                   // ISO-ish date string from crashlytics

  // Keys tab
  source: string;
  status: string;
  configuration: string;
  nserrorCode: string;
  nserrorDomain: string;

  // Log file
  log_filename: string;           // Renamed log file path relative to logs dir
  reason: string;                 // e.g. incomplete-hologram-video

  // Derived / visualisation helpers
  os_major_version: string;       // e.g. "16" from "iOS 16.1"
  issue_type: string;             // e.g. "FaceKom handleFlow(0)"
  collected_at: string;           // ISO timestamp when this row was collected
  notes: string;                  // notes
}

const DEFAULT_HEADERS: (keyof IssueRecord)[] = [
  'session_key',
  'identification_link',
  'user_id',
  'close_type',
  'app_version',
  'os_version',
  'os_major_version',
  'model',
  'date',
  'source',
  'status',
  'configuration',
  'nserrorCode',
  'nserrorDomain',
  'log_filename',
  'reason',
  'issue_type',
  'collected_at',
  'notes',
];

export function ensureDirExists(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Read existing CSV records. Returns empty array if file doesn't exist. */
export function readCsv(csvPath: string): IssueRecord[] {
  if (!fs.existsSync(csvPath)) return [];

  const content = fs.readFileSync(csvPath, 'utf-8').trim();
  if (!content) return [];

  const lines = content.split('\n');
  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim()) as (keyof IssueRecord)[];

  return lines.slice(1).map(line => {
    const values = parseCsvLine(line);
    const record: Partial<IssueRecord> = {};
    headers.forEach((h, i) => {
      (record as any)[h] = values[i] ?? '';
    });
    return record as IssueRecord;
  });
}

/** Check if a session already exists in the CSV */
export function sessionExists(records: IssueRecord[], sessionKey: string): boolean {
  return records.some(r => r.session_key === sessionKey);
}

/** Append a new record to the CSV */
export function appendCsv(csvPath: string, record: IssueRecord) {
  ensureDirExists(csvPath);

  const fileExists = fs.existsSync(csvPath);
  const isNonEmpty = fileExists && fs.readFileSync(csvPath, 'utf-8').trim().length > 0;

  const row = DEFAULT_HEADERS.map(h => escapeCsv(String((record as any)[h] ?? '')));

  if (!isNonEmpty) {
    // Write header + first row
    const header = DEFAULT_HEADERS.map(h => escapeCsv(h)).join(',');
    fs.writeFileSync(csvPath, header + '\n' + row.join(',') + '\n', 'utf-8');
  } else {
    fs.appendFileSync(csvPath, row.join(',') + '\n', 'utf-8');
  }
}

function escapeCsv(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Clean OS version strings like "iosiOS 16.1" → "iOS 16.1" */
export function cleanOsVersion(raw: string): string {
  // Remove leading "ios" prefix (case-insensitive) before "iOS"
  return raw.replace(/^ios(?=iOS)/i, '').trim();
}

/** Extract major version number from cleaned OS string e.g. "iOS 16.1.2" → "16" */
export function extractOsMajorVersion(cleaned: string): string {
  const match = cleaned.match(/(\d+)/);
  return match ? match[1] : '';
}

/** Build a unique session key from id + date */
export function buildSessionKey(identification: string, date: string): string {
  // Use a simple hash-like combo; both fields together identify a unique session
  return `${identification}__${date}`;
}

export function writeCsv(filePath: string, records: IssueRecord[]): void {
  if (records.length === 0) return;
  const header = DEFAULT_HEADERS.join(',');
  const rows = records.map(r =>
    DEFAULT_HEADERS.map(h => {
      const val = String(r[h] ?? '');
      return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
    }).join(',')
  );
  fs.writeFileSync(filePath, [header, ...rows].join('\n') + '\n');
}