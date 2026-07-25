// moduleNameMapper intercepts 'better-sqlite3' even for jest.requireActual,
// so we load the real module via its resolved path to bypass the mock.
import path from 'path';
const Database: typeof import('better-sqlite3') = jest.requireActual(
  path.resolve(__dirname, '../../node_modules/better-sqlite3/lib/index.js'),
);

function setupDb(): import('better-sqlite3').Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      type      TEXT NOT NULL,
      ledger    INTEGER NOT NULL,
      tx_hash   TEXT NOT NULL UNIQUE,
      payload   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_type_ledger ON events (type, ledger);
  `);
  return db;
}

describe('idx_events_type_ledger composite index', () => {
  it('exists in sqlite_master', () => {
    const db = setupDb();
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_events_type_ledger'`)
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('idx_events_type_ledger');
  });

  it('is used by EXPLAIN QUERY PLAN for type + ledger query', () => {
    const db = setupDb();
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN SELECT * FROM events WHERE type = ? ORDER BY ledger ASC`)
      .all('player_registered') as { detail: string }[];
    const usesIndex = plan.some((row) =>
      row.detail.toLowerCase().includes('idx_events_type_ledger'),
    );
    expect(usesIndex).toBe(true);
  });
});
