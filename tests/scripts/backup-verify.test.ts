import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');
const BACKUP_SCRIPT = path.join(REPO_ROOT, 'scripts/backup-db.sh');
const VERIFY_SCRIPT = path.join(REPO_ROOT, 'scripts/verify-backup.sh');
const SQLITE_CLI = path.join(REPO_ROOT, 'scripts/sqlite-cli.sh');
const INITIAL_SCHEMA = path.join(REPO_ROOT, 'db/001_initial.sql');

function runScript(
  script: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {}
): string {
  return execFileSync('bash', [script, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function runScriptExpectFailure(
  script: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = {}
): string {
  try {
    execFileSync('bash', [script, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    throw new Error(`Expected ${script} to fail`);
  } catch (error: unknown) {
    const execError = error as { status?: number; stderr?: string; stdout?: string };
    if (execError.status === undefined) {
      throw error;
    }
    return `${execError.stderr ?? ''}${execError.stdout ?? ''}`;
  }
}

function runSql(dbPath: string, sql: string): void {
  execFileSync('bash', [SQLITE_CLI, dbPath, sql], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
}

function createTestDatabase(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  runSql(dbPath, fs.readFileSync(INITIAL_SCHEMA, 'utf8'));
  runSql(
    dbPath,
    `
      INSERT INTO players (player_id, wallet, created_at)
      VALUES ('player-1', 'GTESTWALLET123456789012345678901234567890', 1);
      INSERT INTO events (type, ledger, tx_hash, payload)
      VALUES ('register', 100, 'abc123hash', '{}');
      CREATE TABLE migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO migrations (id, applied_at) VALUES ('001_initial.sql', 1);
    `
  );
}

const isWindows = process.platform === 'win32';

(isWindows ? describe.skip : describe)('backup-db restore verification', () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-off-backup-'));
    dbPath = path.join(tmpDir, 'scout-off.db');
    backupDir = path.join(tmpDir, 'backups');
    createTestDatabase(dbPath);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a backup, sidecar counts, and verifies it automatically', () => {
    const output = runScript(BACKUP_SCRIPT, [], {
      DB_PATH: dbPath,
      BACKUP_DEST: backupDir,
    });

    const backups = fs.readdirSync(backupDir).filter((name) => name.endsWith('.db'));
    expect(backups).toHaveLength(1);

    const backupPath = path.join(backupDir, backups[0]);
    const countsPath = `${backupPath}.counts`;

    expect(fs.existsSync(backupPath)).toBe(true);
    expect(fs.existsSync(countsPath)).toBe(true);
    expect(fs.readFileSync(countsPath, 'utf8')).toContain('players=1');
    expect(output).toContain('PRAGMA integrity_check passed');
    expect(output).toContain('Backup verified successfully');
  });

  it('runs standalone verification against an existing local backup', () => {
    runScript(BACKUP_SCRIPT, [], {
      DB_PATH: dbPath,
      BACKUP_DEST: backupDir,
    });

    const backupPath = path.join(backupDir, fs.readdirSync(backupDir).find((n) => n.endsWith('.db'))!);
    const output = runScript(BACKUP_SCRIPT, ['--verify-only', backupPath]);

    expect(output).toContain('Backup verification succeeded');
  });

  it('detects a deliberately corrupted backup during standalone verification', () => {
    runScript(BACKUP_SCRIPT, [], {
      DB_PATH: dbPath,
      BACKUP_DEST: backupDir,
    });

    const backupPath = path.join(backupDir, fs.readdirSync(backupDir).find((n) => n.endsWith('.db'))!);
    const corruptedPath = path.join(tmpDir, 'corrupted.db');
    const backupBytes = fs.readFileSync(backupPath);
    fs.writeFileSync(corruptedPath, backupBytes.subarray(0, 100));

    const output = runScriptExpectFailure(VERIFY_SCRIPT, [corruptedPath]);

    expect(output).toMatch(/integrity_check failed|ERROR/i);
  });

  it('detects row-count drift when expected counts do not match the backup', () => {
    runScript(BACKUP_SCRIPT, [], {
      DB_PATH: dbPath,
      BACKUP_DEST: backupDir,
    });

    const backupPath = path.join(backupDir, fs.readdirSync(backupDir).find((n) => n.endsWith('.db'))!);
    const output = runScriptExpectFailure(VERIFY_SCRIPT, [backupPath], {
      EXPECT_PLAYERS: '999',
      EXPECT_EVENTS: '0',
      EXPECT_MIGRATIONS: '0',
    });

    expect(output).toContain('players row count mismatch');
  });
});
