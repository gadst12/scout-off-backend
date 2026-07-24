import { Request, Response, NextFunction } from 'express';
import { rateLimit, walletRateLimit } from '../../src/middleware/rateLimit';

// ── Unit tests for rateLimit middleware ──────────────────────────────────────

function makeReqRes(ip = '127.0.0.1') {
  const req = { ip } as unknown as Request;
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next };
}

describe('rateLimit middleware', () => {
  it('allows requests under the limit', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) {
      const { req, res, next } = makeReqRes('1.1.1.1');
      mw(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('returns 429 when limit is exceeded', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 2 });
    const ip = '2.2.2.2';
    for (let i = 0; i < 2; i++) {
      const { req, res, next } = makeReqRes(ip);
      mw(req, res, next);
    }
    const { req, res, next } = makeReqRes(ip);
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('resets the counter after the window expires', async () => {
    const mw = rateLimit({ windowMs: 50, max: 1 });
    const ip = '3.3.3.3';

    const first = makeReqRes(ip);
    mw(first.req, first.res, first.next);
    expect(first.next).toHaveBeenCalledTimes(1);

    const second = makeReqRes(ip);
    mw(second.req, second.res, second.next);
    expect(second.res.status).toHaveBeenCalledWith(429);

    await new Promise((r) => setTimeout(r, 60));

    const third = makeReqRes(ip);
    mw(third.req, third.res, third.next);
    expect(third.next).toHaveBeenCalledTimes(1);
  });

  it('tracks IPs independently', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1 });
    const a = makeReqRes('4.4.4.4');
    mw(a.req, a.res, a.next);
    expect(a.next).toHaveBeenCalledTimes(1);

    const b = makeReqRes('5.5.5.5');
    mw(b.req, b.res, b.next);
    expect(b.next).toHaveBeenCalledTimes(1);
  });
});

// ── Integration: POST /api/validators/milestone throttling ───────────────────
// Confirms the middleware correctly throttles repeated requests from the same IP.
describe('POST /api/validators/milestone rate limiting (middleware integration)', () => {
  it('returns 429 after exceeding the configured limit', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1 });
    const ip = '9.9.9.9';

    const first = makeReqRes(ip);
    mw(first.req, first.res, first.next);
    expect(first.next).toHaveBeenCalledTimes(1);

    const second = makeReqRes(ip);
    mw(second.req, second.res, second.next);
    expect(second.res.status).toHaveBeenCalledWith(429);
    expect(second.next).not.toHaveBeenCalled();
  });
});

// ── Unit tests for walletRateLimit middleware ────────────────────────────────
describe('walletRateLimit middleware', () => {
  function makeReqResWithWallet(wallet?: string, ip = '127.0.0.1') {
    const req = { ip, account: wallet } as unknown as Request;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as unknown as Response;
    const next = jest.fn() as NextFunction;
    return { req, res, next };
  }

  it('allows requests under the limit by wallet', () => {
    const mw = walletRateLimit({ windowMs: 60_000, max: 3 });
    for (let i = 0; i < 3; i++) {
      const { req, res, next } = makeReqResWithWallet('G_WALLET_1');
      mw(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    }
  });

  it('returns 429 when limit is exceeded by wallet', () => {
    const mw = walletRateLimit({ windowMs: 60_000, max: 2 });
    const wallet = 'G_WALLET_2';
    for (let i = 0; i < 2; i++) {
      const { req, res, next } = makeReqResWithWallet(wallet);
      mw(req, res, next);
    }
    const { req, res, next } = makeReqResWithWallet(wallet);
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('ignores requests if req.account is not present', () => {
    const mw = walletRateLimit({ windowMs: 60_000, max: 1 });
    const { req, res, next } = makeReqResWithWallet(undefined);
    mw(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();

    // Call again to verify it is not blocked
    const second = makeReqResWithWallet(undefined);
    mw(second.req, second.res, second.next);
    expect(second.next).toHaveBeenCalledTimes(1);
    expect(second.res.status).not.toHaveBeenCalled();
  });
});

