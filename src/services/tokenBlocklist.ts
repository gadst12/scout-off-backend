/**
 * Token Revocation / Blocklist Service
 *
 * Maintains a SQLite table of revoked JWTs identified by their `jti` claim.
 * Expired tokens are pruned automatically at startup and on demand.
 *
 * Table schema:
 *   revoked_tokens (jti TEXT PRIMARY KEY, revoked_at INTEGER, expires_at INTEGER)
 */

import Database from 'better-sqlite3';
import config from '../config';

const db = new Database(config.dbPath);

// Create table if it does not already exist (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS revoked_tokens (
    jti        TEXT    PRIMARY KEY,
    revoked_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens (expires_at);
`);

// ─── Statements ──────────────────────────────────────────────────────────────

const stmtInsert = db.prepare(`
  INSERT OR IGNORE INTO revoked_tokens (jti, revoked_at, expires_at)
  VALUES (?, ?, ?)
`);

const stmtIsRevoked = db.prepare(`
  SELECT 1 FROM revoked_tokens WHERE jti = ? LIMIT 1
`);

const stmtPrune = db.prepare(`
  DELETE FROM revoked_tokens WHERE expires_at <= ?
`);

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Add a jti to the revocation blocklist.
 * @param jti       JWT ID claim
 * @param expiresAt Token expiry as a Unix timestamp (seconds). Used to prune stale rows.
 */
export function revokeToken(jti: string, expiresAt: number): void {
  const now = Math.floor(Date.now() / 1000);
  stmtInsert.run(jti, now, expiresAt);
}

/**
 * Returns true if the given jti has been revoked (and the row has not yet been pruned).
 */
export function isTokenRevoked(jti: string): boolean {
  return !!stmtIsRevoked.get(jti);
}

/**
 * Delete all rows whose token has already expired.
 * Safe to call at any time — used at startup and can be called periodically.
 */
export function pruneExpiredTokens(): void {
  const now = Math.floor(Date.now() / 1000);
  stmtPrune.run(now);
}

// Prune expired rows at startup so the table stays lean.
// Called after all statement constants are initialized.
pruneExpiredTokens();
