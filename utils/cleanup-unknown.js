const fs = require('fs');
const path = require('path');

const CSV_PATH = path.resolve('./data/issues.csv');
const LOGS_DIR = path.resolve('./data/logs');

const content = fs.readFileSync(CSV_PATH, 'utf-8');
const lines = content.split('\n').filter(l => l.trim());
const header = lines[0];
const rows = lines.slice(1);

// Parse close_type column index
const headers = header.split(',');
const closeTypeIdx = headers.indexOf('close_type');
const logFilenameIdx = headers.indexOf('log_filename');

const toDelete = [];
const toKeep = [];

for (const row of rows) {
  // Simple CSV split (handles quoted fields)
  const cols = row.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) ?? row.split(',');
  const closeType = cols[closeTypeIdx]?.replace(/"/g, '').trim();
  if (closeType === 'unknown') {
    toDelete.push({ row, cols });
  } else {
    toKeep.push(row);
  }
}

// Delete log files
let deletedLogs = 0;
for (const { cols } of toDelete) {
  const logFilename = cols[logFilenameIdx]?.replace(/"/g, '').trim();
  if (logFilename) {
    const logPath = path.join(LOGS_DIR, logFilename);
    if (fs.existsSync(logPath)) {
      fs.unlinkSync(logPath);
      deletedLogs++;
      console.log(`🗑️  Deleted log: ${logFilename}`);
    }
  }
}

// Write back
fs.writeFileSync(CSV_PATH, [header, ...toKeep].join('\n') + '\n');

console.log(`\n✅ Done`);
console.log(`   Records before: ${rows.length}`);
console.log(`   Records removed: ${toDelete.length}`);
console.log(`   Records kept: ${toKeep.length}`);
console.log(`   Log files deleted: ${deletedLogs}`);