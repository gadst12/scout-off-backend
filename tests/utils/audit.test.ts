import { recordAudit, queryAudit } from '../../src/utils/audit';
import { getDb, insertAuditLog } from '../../src/db';

// recordAudit/queryAudit now persist to the audit_log table instead of an
// in-memory array (#464), so isolate tests by clearing that table rather
// than resetting an array.
beforeEach(() => {
  getDb().prepare('DELETE FROM audit_log').run();
});

describe('recordAudit', () => {
  it('stores a milestone_submitted entry with correct fields', () => {
    const entry = recordAudit('GVALIDATOR', 'milestone_submitted', { playerId: 'P1', milestoneType: 'identity' });
    expect(entry.actorWallet).toBe('GVALIDATOR');
    expect(entry.eventType).toBe('milestone_submitted');
    expect(typeof entry.payloadHash).toBe('string');
    expect(entry.payloadHash).toHaveLength(64);
    expect(typeof entry.timestamp).toBe('number');
    expect(entry.notes).toBeUndefined();
    expect(queryAudit()).toHaveLength(1);
  });

  it('stores a milestone_approved entry with notes field', () => {
    const entry = recordAudit('GVALIDATOR', 'milestone_approved', { milestoneId: 'M42' }, 'approved via admin panel');
    expect(entry.eventType).toBe('milestone_approved');
    expect(entry.notes).toBe('approved via admin panel');
    expect(queryAudit()).toHaveLength(1);
  });

  it('stores a player_search entry linked to a scout wallet', () => {
    const entry = recordAudit('GSCOUT123', 'player_search', { region: 'europe', position: 'striker', resultCount: 5 });
    expect(entry.eventType).toBe('player_search');
    expect(entry.actorWallet).toBe('GSCOUT123');
    expect(typeof entry.payloadHash).toBe('string');
    expect(queryAudit()).toHaveLength(1);
  });

  it('stores a player_search entry with anonymous wallet when unauthenticated', () => {
    const entry = recordAudit('anonymous', 'player_search', { region: null, position: null, resultCount: 10 });
    expect(entry.actorWallet).toBe('anonymous');
    expect(entry.eventType).toBe('player_search');
  });

  it('produces deterministic hash for the same payload', () => {
    const payload = { playerId: 'P1', milestoneType: 'performance' };
    const a = recordAudit('G1', 'milestone_submitted', payload);
    const b = recordAudit('G1', 'milestone_submitted', payload);
    expect(a.payloadHash).toBe(b.payloadHash);
  });

  it('persists across a fresh read from the DB (survives "restart")', () => {
    recordAudit('GVALIDATOR', 'milestone_submitted', { playerId: 'P1' });
    // Simulate a fresh read path unrelated to the in-process call above —
    // queryAudit re-reads from the DB rather than an in-memory reference.
    const rows = queryAudit({ eventType: 'milestone_submitted' });
    expect(rows).toHaveLength(1);
    expect(rows[0].actorWallet).toBe('GVALIDATOR');
  });
});

describe('queryAudit', () => {
  beforeEach(() => {
    recordAudit('G1', 'milestone_submitted', { id: '1' });
    recordAudit('G2', 'milestone_approved', { id: '2' });
    recordAudit('G1', 'milestone_approved', { id: '3' });
  });

  it('returns all entries when no filter given', () => {
    expect(queryAudit()).toHaveLength(3);
  });

  it('filters by eventType', () => {
    const results = queryAudit({ eventType: 'milestone_approved' });
    expect(results).toHaveLength(2);
    results.forEach((e) => expect(e.eventType).toBe('milestone_approved'));
  });

  it('filters by actorWallet', () => {
    const results = queryAudit({ actorWallet: 'G1' });
    expect(results).toHaveLength(2);
    results.forEach((e) => expect(e.actorWallet).toBe('G1'));
  });

  it('filters by both eventType and actorWallet', () => {
    const results = queryAudit({ eventType: 'milestone_approved', actorWallet: 'G1' });
    expect(results).toHaveLength(1);
    expect(results[0].actorWallet).toBe('G1');
  });

  it('does not surface admin-action rows written via insertAuditLog directly', () => {
    insertAuditLog({ action: 'contract_state_change', adminWallet: 'GADMIN', queryParams: {}, createdAt: new Date().toISOString() });
    expect(queryAudit()).toHaveLength(3);
  });
});
