import { Request, Response, NextFunction } from 'express';
import { metricsMiddleware, metricsStore, errorCountsStore, getMetrics, getErrorMetrics, isMetricsEnabled } from '../../src/middleware/metrics';

function makeReqRes(path = '/test', method = 'GET', statusCode = 200) {
  const listeners: Record<string, () => void> = {};
  const req = { method, path, route: undefined } as unknown as Request;
  const res = {
    statusCode,
    on: (event: string, cb: () => void) => { listeners[event] = cb; },
    emit: (event: string) => listeners[event]?.(),
  } as unknown as Response;
  const next = jest.fn() as NextFunction;
  return { req, res, next, emit: (e: string) => listeners[e]?.() };
}

beforeEach(() => {
  Object.keys(metricsStore).forEach((k) => delete metricsStore[k]);
  errorCountsStore['4xx'] = 0;
  errorCountsStore['5xx'] = 0;
  delete process.env.METRICS_ENABLED;
});

describe('metricsMiddleware', () => {
  it('increments count after response finish', () => {
    const { req, res, next, emit } = makeReqRes('/api/players');
    metricsMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    emit('finish');
    const metrics = getMetrics();
    const key = Object.keys(metrics)[0];
    expect(metrics[key].count).toBe(1);
  });

  it('accumulates latency across multiple requests', () => {
    for (let i = 0; i < 3; i++) {
      const { req, res, next, emit } = makeReqRes('/api/scouts');
      metricsMiddleware(req, res, next);
      emit('finish');
    }
    const metrics = getMetrics();
    const key = Object.keys(metrics)[0];
    expect(metrics[key].count).toBe(3);
    expect(metrics[key].totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('skips collection when METRICS_ENABLED=false', () => {
    process.env.METRICS_ENABLED = 'false';
    const { req, res, next, emit } = makeReqRes('/api/players');
    metricsMiddleware(req, res, next);
    emit('finish');
    expect(Object.keys(metricsStore)).toHaveLength(0);
    expect(next).toHaveBeenCalled();
  });

  it('tracks different routes separately', () => {
    const a = makeReqRes('/api/players');
    const b = makeReqRes('/api/scouts');
    metricsMiddleware(a.req, a.res, a.next);
    metricsMiddleware(b.req, b.res, b.next);
    a.emit('finish');
    b.emit('finish');
    const metrics = getMetrics();
    expect(Object.keys(metrics)).toHaveLength(2);
  });
});

describe('isMetricsEnabled', () => {
  it('returns true by default', () => {
    expect(isMetricsEnabled()).toBe(true);
  });

  it('returns false when METRICS_ENABLED=false', () => {
    process.env.METRICS_ENABLED = 'false';
    expect(isMetricsEnabled()).toBe(false);
  });
});

describe('http_errors_total counter', () => {
  it('increments 4xx counter on a 404 response', () => {
    const { req, res, next, emit } = makeReqRes('/api/players', 'GET', 404);
    metricsMiddleware(req, res, next);
    emit('finish');
    expect(getErrorMetrics()['4xx']).toBe(1);
    expect(getErrorMetrics()['5xx']).toBe(0);
  });

  it('increments 5xx counter on a 500 response', () => {
    const { req, res, next, emit } = makeReqRes('/api/players', 'GET', 500);
    metricsMiddleware(req, res, next);
    emit('finish');
    expect(getErrorMetrics()['5xx']).toBe(1);
    expect(getErrorMetrics()['4xx']).toBe(0);
  });

  it('does not increment error counters on 2xx responses', () => {
    const { req, res, next, emit } = makeReqRes('/api/players', 'GET', 200);
    metricsMiddleware(req, res, next);
    emit('finish');
    expect(getErrorMetrics()['4xx']).toBe(0);
    expect(getErrorMetrics()['5xx']).toBe(0);
  });

  it('does not increment error counters on 3xx responses', () => {
    const { req, res, next, emit } = makeReqRes('/api/players', 'GET', 301);
    metricsMiddleware(req, res, next);
    emit('finish');
    expect(getErrorMetrics()['4xx']).toBe(0);
    expect(getErrorMetrics()['5xx']).toBe(0);
  });

  it('accumulates error counts across multiple requests', () => {
    makeReqRes('/api/a', 'GET', 400).emit('finish');
    const r1 = makeReqRes('/api/b', 'GET', 400);
    metricsMiddleware(r1.req, r1.res, r1.next);
    r1.emit('finish');
    const r2 = makeReqRes('/api/c', 'GET', 503);
    metricsMiddleware(r2.req, r2.res, r2.next);
    r2.emit('finish');
    expect(getErrorMetrics()['4xx']).toBe(1);
    expect(getErrorMetrics()['5xx']).toBe(1);
  });
});
