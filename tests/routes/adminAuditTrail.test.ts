import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import * as auditService from '../../src/services/audit';

// pauseContract/unpauseContract invoke the real Soroban pause()/unpause()
// calls unless mocked; the platform keypair isn't configured in tests, so
// stub both out here.
jest.mock('../../src/services/stellar', () => ({
  ...jest.requireActual('../../src/services/stellar'),
  pauseContractOnChain: jest.fn().mockResolvedValue({ transactionId: 'mock-pause-txid' }),
  unpauseContractOnChain: jest.fn().mockResolvedValue({ transactionId: 'mock-unpause-txid' }),
}));

const SECRET = process.env.JWT_SECRET ?? 'test-secret';
// pauseContract/unpauseContract additionally require the caller's wallet to be
// in config.adminWallets (defence-in-depth beyond the admin role claim) — this
// must match the ADMIN_WALLET default set in tests/setup.ts.
const ADMIN_WALLET = 'GADMINAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4';

async function getAdminToken(): Promise<string> {
  return jwt.sign({ sub: ADMIN_WALLET, role: 'admin' }, SECRET, { expiresIn: '1h' });
}

describe('Admin contract audit trail (#101)', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(auditService, 'logAuditEvent');
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it('logs audit event with contractAction=pause_contract on POST /api/admin/contract/pause', async () => {
    const token = await getAdminToken();
    await request(app)
      .post('/api/admin/contract/pause')
      .set('Authorization', `Bearer ${token}`)
      .expect(202);

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contract_state_change',
        contractAction: 'pause_contract',
      })
    );
  });

  it('logs audit event with contractAction=unpause_contract on POST /api/admin/contract/unpause', async () => {
    const token = await getAdminToken();
    await request(app)
      .post('/api/admin/contract/unpause')
      .set('Authorization', `Bearer ${token}`)
      .expect(202);

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contract_state_change',
        contractAction: 'unpause_contract',
      })
    );
  });

  it('audit entry includes adminWallet and timestamp', async () => {
    const token = await getAdminToken();
    await request(app)
      .post('/api/admin/contract/pause')
      .set('Authorization', `Bearer ${token}`)
      .expect(202);

    const call = logSpy.mock.calls[0][0];
    expect(typeof call.adminWallet).toBe('string');
    expect(typeof call.timestamp).toBe('string');
  });
});
