import * as fs from 'fs';
import * as path from 'path';
import { readCsv, writeCsv } from './csv';

const CSV_PATH = path.resolve('./data/issues.csv');
const LOGS_DIR = path.resolve('./data/logs');

const records = readCsv(CSV_PATH);
const before = records.length;

const toDelete = records.filter(r => r.close_type === 'unknown');
const toKeep   = records.filter(r => r.close_type !== 'unknown');

// Delete associated log files
let deletedLogs = 0;
for (const record of toDelete) {
  if (record.log_filename) {
    const logPath = path.join(LOGS_DIR, record.log_filename);
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
      deletedLogs++;
      console.log(`🗑️  Deleted log: ${record.log_filename}`);
    }
  }
}

writeCsv(CSV_PATH, toKeep);

console.log(`\n✅ Done`);
console.log(`   Records before: ${before}`);
console.log(`   Records removed: ${toDelete.length}`);
console.log(`   Records kept: ${toKeep.length}`);
console.log(`   Log files deleted: ${deletedLogs}`);