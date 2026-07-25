import request from 'supertest';
import app from '../../src/app';

describe('405 Method Not Allowed', () => {
  it('returns 405 for DELETE on /api/players (only GET is allowed)', async () => {
    const res = await request(app).delete('/api/players');
    expect(res.status).toBe(405);
    expect(res.body).toEqual({ success: false, error: 'Method Not Allowed' });
    expect(res.headers['allow']).toBeDefined();
  });

  it('returns 405 with Allow header for /api/players', async () => {
    const res = await request(app).delete('/api/players');
    expect(res.headers['allow']).toMatch(/GET/);
    // Verify the Allow header lists valid methods
    const allowed = (res.headers['allow'] as string).split(', ').filter(Boolean);
    expect(allowed).toContain('GET');
  });

  it('returns 405 for PATCH on /api/players (only GET is allowed)', async () => {
    const res = await request(app).patch('/api/players');
    expect(res.status).toBe(405);
  });

  it('returns 200 for legit GET on /api/players', async () => {
    const res = await request(app).get('/api/players');
    // GET is allowed, so it should not be 405
    expect(res.status).not.toBe(405);
  });

  it('returns 405 for unsupported method on a multi-method path (/api/admin/fees)', async () => {
    // /api/admin/fees supports GET and POST, not DELETE
    const res = await request(app).delete('/api/admin/fees');
    expect(res.status).toBe(405);
    expect(res.body).toEqual({ success: false, error: 'Method Not Allowed' });
    expect(res.headers['allow']).toMatch(/GET/);
    expect(res.headers['allow']).toMatch(/POST/);
  });

  it('returns 405 for PATCH on /api/auth/challenge (only GET is allowed)', async () => {
    const res = await request(app).patch('/auth/challenge');
    expect(res.status).toBe(405);
    expect(res.body).toEqual({ success: false, error: 'Method Not Allowed' });
    expect(res.headers['allow']).toBe('GET');
  });

  it('unknown paths still return 404, not 405', async () => {
    const res = await request(app).delete('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, error: 'Not Found' });
  });

  it('known routes still work normally', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
