require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const projectRoot = path.resolve(__dirname, '..');

function resolveFromProject(configuredPath, fallback) {
  const value = configuredPath || fallback;
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function getDbPath() {
  return resolveFromProject(process.env.SQLITE_DATABASE_PATH, './data/manuflow.sqlite3');
}

function getBackupDir() {
  return resolveFromProject(process.env.SQLITE_BACKUP_DIR, './backups');
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join('-');
}

function runWalCheckpoint(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA wal_checkpoint(FULL)');
  } finally {
    db.close();
  }
}

function runBackup() {
  const dbPath = getDbPath();

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    process.exit(1);
  }

  const backupDir = getBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });

  const backupPath = path.join(backupDir, `fulfillforge-backup-${formatTimestamp()}.sqlite3`);

  try {
    runWalCheckpoint(dbPath);
  } catch (err) {
    console.error(`WAL checkpoint failed: ${err.message}`);
    process.exit(1);
  }

  try {
    fs.copyFileSync(dbPath, backupPath);
  } catch (err) {
    console.error(`Backup copy failed: ${err.message}`);
    process.exit(1);
  }

  const { size } = fs.statSync(backupPath);
  console.log(`Backup created: ${backupPath} (${size} bytes)`);
}

runBackup();
