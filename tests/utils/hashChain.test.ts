import { canonicalJSON, computeChainHash, auditChainContent, GENESIS_HASH } from '../../src/utils/hashChain';

describe('canonicalJSON', () => {
  it('produces the same string regardless of key insertion order', () => {
    const a = { b: 1, a: 2, c: { z: 1, y: 2 } };
    const b = { a: 2, c: { y: 2, z: 1 }, b: 1 };
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });

  it('sorts keys recursively inside arrays too', () => {
    const a = { list: [{ b: 1, a: 2 }, { d: 1, c: 2 }] };
    const b = { list: [{ a: 2, b: 1 }, { c: 2, d: 1 }] };
    expect(canonicalJSON(a)).toBe(canonicalJSON(b));
  });

  it('differs when content actually differs', () => {
    expect(canonicalJSON({ a: 1 })).not.toBe(canonicalJSON({ a: 2 }));
  });
});

describe('computeChainHash', () => {
  it('is deterministic for the same content and prevHash', () => {
    const content = { action: 'x', admin_wallet: 'G1' };
    expect(computeChainHash(content, GENESIS_HASH)).toBe(computeChainHash(content, GENESIS_HASH));
  });

  it('changes when prevHash changes (chaining)', () => {
    const content = { action: 'x', admin_wallet: 'G1' };
    const h1 = computeChainHash(content, GENESIS_HASH);
    const h2 = computeChainHash(content, 'a'.repeat(64));
    expect(h1).not.toBe(h2);
  });

  it('changes when content changes', () => {
    const h1 = computeChainHash({ action: 'x' }, GENESIS_HASH);
    const h2 = computeChainHash({ action: 'y' }, GENESIS_HASH);
    expect(h1).not.toBe(h2);
  });

  it('produces a 64-character hex digest', () => {
    const hash = computeChainHash({ action: 'x' }, GENESIS_HASH);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('auditChainContent', () => {
  it('maps camelCase fields onto the audit_log column names', () => {
    const content = auditChainContent({
      action: 'contract_state_change',
      adminWallet: 'GADMIN',
      queryParams: '{}',
      createdAt: '2025-01-01T00:00:00.000Z',
      eventSource: 'admin_action',
    });
    expect(content).toEqual({
      action: 'contract_state_change',
      admin_wallet: 'GADMIN',
      query_params: '{}',
      created_at: '2025-01-01T00:00:00.000Z',
      event_source: 'admin_action',
    });
  });
});
