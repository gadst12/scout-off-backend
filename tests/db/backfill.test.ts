/**
 * Tests for the core backfill logic used by scripts/backfill.js
 * and the INDEXER_BACKFILL_FROM_LEDGER guard in src/index.ts.
 *
 * Exercises initDb → getLastLedger → setLastLedger round-trip,
 * normal backfill-to-earlier-ledger, and the already-past-target
 * edge case where the reset should be a no-op.
 */

import { getLastLedger, setLastLedger, getDb } from '../../src/db';

describe('backfill core logic (scripts/backfill.js)', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM indexer_state').run();
  });

  it('getLastLedger returns 0 when no state exists', () => {
    expect(getLastLedger()).toBe(0);
  });

  it('setLastLedger / getLastLedger round-trips correctly', () => {
    setLastLedger(5_000_000);
    expect(getLastLedger()).toBe(5_000_000);
  });

  it('resets last_ledger to an earlier value (normal backfill)', () => {
    setLastLedger(10_000_000);
    expect(getLastLedger()).toBe(10_000_000);

    setLastLedger(8_000_000);
    expect(getLastLedger()).toBe(8_000_000);
  });

  it('overwrites last_ledger with a higher value (unconditional set)', () => {
    setLastLedger(1_000_000);
    expect(getLastLedger()).toBe(1_000_000);

    setLastLedger(9_000_000);
    expect(getLastLedger()).toBe(9_000_000);
  });

  it('is idempotent — setting the same ledger twice is safe', () => {
    setLastLedger(3_000_000);
    setLastLedger(3_000_000);
    expect(getLastLedger()).toBe(3_000_000);
  });
});

describe('INDEXER_BACKFILL_FROM_LEDGER guard (src/index.ts)', () => {
  beforeEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM indexer_state').run();
  });

  /**
   * Mirrors the guard logic from src/index.ts:
   *
   *   if (config.backfillFromLedger !== null) {
   *     const stored = getLastLedger();
   *     if (config.backfillFromLedger < stored) {
   *       setLastLedger(config.backfillFromLedger);
   *     }
   *   }
   *
   * The guard only resets when the target is strictly less than the stored value.
   */

  function applyBackfillGuard(backfillFromLedger: number): boolean {
    const stored = getLastLedger();
    if (backfillFromLedger < stored) {
      setLastLedger(backfillFromLedger);
      return true; // reset happened
    }
    return false; // no-op
  }

  it('resets last_ledger when target is earlier than stored', () => {
    setLastLedger(10_000_000);

    const didReset = applyBackfillGuard(7_000_000);

    expect(didReset).toBe(true);
    expect(getLastLedger()).toBe(7_000_000);
  });

  it('is a no-op when target equals the stored value', () => {
    setLastLedger(5_000_000);

    const didReset = applyBackfillGuard(5_000_000);

    expect(didReset).toBe(false);
    expect(getLastLedger()).toBe(5_000_000);
  });

  it('is a no-op when target is already past the current indexed point', () => {
    setLastLedger(3_000_000);

    const didReset = applyBackfillGuard(9_000_000);

    expect(didReset).toBe(false);
    expect(getLastLedger()).toBe(3_000_000);
  });

  it('is a no-op when no prior state exists and target is positive', () => {
    // getLastLedger() returns 0 when indexer_state is empty
    const didReset = applyBackfillGuard(1_000_000);

    expect(didReset).toBe(false);
    expect(getLastLedger()).toBe(0);
  });

  it('resets when stored is 0 and target is also 0 (equal — no-op)', () => {
    const didReset = applyBackfillGuard(0);

    expect(didReset).toBe(false);
    expect(getLastLedger()).toBe(0);
  });
});
