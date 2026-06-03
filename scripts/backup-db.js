require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const projectRoot = path.resolve(__dirname, '..');
const BACKUP_PREFIX = 'fullfilforge-backup-';
const BACKUP_SUFFIX = '.sqlite3';
const KEEP_BACKUP_COUNT = 14;

function resolveFromProject(configuredPath, fallback) {
  const value = configuredPath || fallback;
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function getDbPath() {
  return resolveFromProject(process.env.SQLITE_DATABASE_PATH, './data/manuflow.sqlite3');
}

function getBackupDir() {
  return resolveFromProject(process.env.BACKUP_DIR, './backups');
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

function isBackupFile(name) {
  return name.startsWith(BACKUP_PREFIX) && name.endsWith(BACKUP_SUFFIX);
}

function runWalCheckpoint(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    db.exec('PRAGMA wal_checkpoint(FULL)');
  } finally {
    db.close();
  }
}

function cleanupOldBackups(backupDir) {
  const backups = fs.readdirSync(backupDir)
    .filter(isBackupFile)
    .map((name) => {
      const filePath = path.join(backupDir, name);
      return { name, path: filePath, mtime: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  const toRemove = backups.slice(KEEP_BACKUP_COUNT);
  for (const backup of toRemove) {
    fs.unlinkSync(backup.path);
    console.log(`Removed old backup: ${backup.path}`);
  }
}

function runBackup() {
  const dbPath = getDbPath();

  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found: ${dbPath}`);
    console.error('No backup was created.');
    process.exit(1);
  }

  const backupDir = getBackupDir();
  fs.mkdirSync(backupDir, { recursive: true });

  const backupPath = path.join(backupDir, `${BACKUP_PREFIX}${formatTimestamp()}${BACKUP_SUFFIX}`);

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

  try {
    cleanupOldBackups(backupDir);
  } catch (err) {
    console.error(`Backup cleanup failed: ${err.message}`);
    process.exit(1);
  }
}

runBackup();
