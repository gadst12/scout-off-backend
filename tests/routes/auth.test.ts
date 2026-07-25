import request from 'supertest';
import app from '../../src/app';

jest.mock('../../src/db', () => ({
  getEvents: jest.fn().mockReturnValue([]),
  queryPlayers: jest.fn().mockReturnValue([]),
  getPlayerById: jest.fn().mockReturnValue(null),
  getEventsCount: jest.fn().mockReturnValue(0),
  getLastLedger: jest.fn().mockReturnValue(0),
  setLastLedger: jest.fn(),
  insertPlayerProfileHistory: jest.fn(),
  getPlayerProfileHistory: jest.fn().mockReturnValue([]),
  upsertPlayer: jest.fn(),
}));

jest.mock('../../src/services/ipfs', () => ({
  pinJson: jest.fn().mockResolvedValue('QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'),
  checkHealth: jest.fn().mockResolvedValue(undefined),
  gatewayUrl: jest.fn((cid: string) => `https://gateway.pinata.cloud/ipfs/${cid}`),
}));

jest.mock('../../src/services/indexer', () => ({
  indexEvents: jest.fn(),
  normalizeEventId: jest.fn(),
}));

jest.mock('../../src/services/webhooks', () => ({
  dispatchEventWebhook: jest.fn().mockResolvedValue(undefined),
}));

describe('POST /auth/token — malformed XDR handling', () => {
  it('returns 400 for a plaintext non-XDR transaction string', async () => {
    const res = await request(app)
      .post('/auth/token')
      .send({ transaction: 'this-is-not-valid-xdr' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
  });

  it('returns 400 for a random base64-like string that is not an XDR transaction', async () => {
    const res = await request(app)
      .post('/auth/token')
      .send({ transaction: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    expect([400, 401]).toContain(res.status);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 400 for a JSON-serialised object sent as transaction', async () => {
    const res = await request(app)
      .post('/auth/token')
      .send({ transaction: JSON.stringify({ fake: true }) });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe('string');
  });

  it('returns 400 for empty transaction string (Zod min-length guard)', async () => {
    const res = await request(app)
      .post('/auth/token')
      .send({ transaction: '' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when transaction field is missing entirely', async () => {
    const res = await request(app).post('/auth/token').send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('response body is never a 500 for any string transaction value', async () => {
    const payloads = [
      'not-xdr',
      '!!@@##$$%%',
      ' ',
      'A'.repeat(1000),
      '0'.repeat(48),
    ];
    for (const transaction of payloads) {
      const res = await request(app)
        .post('/auth/token')
        .send({ transaction });
      expect(res.status).not.toBe(500);
      expect(res.body.success).toBe(false);
    }
  });
});
