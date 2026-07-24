/**
 * Tests for issue #280 — dedicated, tighter rate limit on auth endpoints.
 */

import { Request, Response, NextFunction } from 'express';
import { rateLimit } from '../../src/middleware/rateLimit';

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

describe('auth rate limit — tighter limit (5/min default)', () => {
  it('allows requests up to the auth limit', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 5 });
    const ip = '10.0.0.1';
    for (let i = 0; i < 5; i++) {
      const { req, res, next } = makeReqRes(ip);
      mw(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it('returns 429 on the 6th request within the window', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 5 });
    const ip = '10.0.0.2';
    for (let i = 0; i < 5; i++) {
      const { req, res, next } = makeReqRes(ip);
      mw(req, res, next);
    }
    const { req, res, next } = makeReqRes(ip);
    mw(req, res, next);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it('includes Retry-After header when limit is exceeded', () => {
    const mw = rateLimit({ windowMs: 60_000, max: 1 });
    const ip = '10.0.0.3';

    const first = makeReqRes(ip);
    mw(first.req, first.res, first.next);

    const second = makeReqRes(ip);
    mw(second.req, second.res, second.next);

    expect(second.res.status).toHaveBeenCalledWith(429);
    expect(second.res.set).toHaveBeenCalledWith('Retry-After', expect.any(String));
    const retryAfter = (second.res.set as jest.Mock).mock.calls.find(
      ([h]: [string]) => h === 'Retry-After'
    )?.[1];
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });

  it('auth limit is independent from the default limit applied to other routes', () => {
    const defaultMw = rateLimit({ windowMs: 60_000, max: 60 });
    const authMw = rateLimit({ windowMs: 60_000, max: 5 });
    const ip = '10.0.0.4';

    // exhaust the auth limit
    for (let i = 0; i < 5; i++) {
      const { req, res, next } = makeReqRes(ip);
      authMw(req, res, next);
    }
    const blocked = makeReqRes(ip);
    authMw(blocked.req, blocked.res, blocked.next);
    expect(blocked.res.status).toHaveBeenCalledWith(429);

    // same IP on the default middleware is still fine (different instance / counter)
    const defaultReq = makeReqRes(ip);
    defaultMw(defaultReq.req, defaultReq.res, defaultReq.next);
    expect(defaultReq.next).toHaveBeenCalledTimes(1);
  });
});
