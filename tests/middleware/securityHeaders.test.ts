import request from 'supertest';
import app from '../../src/app';
import config from '../../src/config';

describe('securityHeaders middleware', () => {
  it('sets the expected security headers on responses', async () => {
    const res = await request(app).get('/health');
    const h = config.securityHeaders;

    expect(res.headers['strict-transport-security']).toBe(h.hsts);
    expect(res.headers['x-content-type-options']).toBe(h.xContentTypeOptions);
    expect(res.headers['x-frame-options']).toBe(h.xFrameOptions);
    expect(res.headers['referrer-policy']).toBe(h.referrerPolicy);
  });
});
