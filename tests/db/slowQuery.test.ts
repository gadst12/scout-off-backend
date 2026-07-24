import { timedQuery } from '../../src/db';
import { logger } from '../../src/utils/logger';

describe('timedQuery slow query logging', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => false);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.SLOW_QUERY_THRESHOLD_MS;
  });

  it('logs a warning when the query exceeds the threshold', () => {
    process.env.SLOW_QUERY_THRESHOLD_MS = '0';
    const sql = 'SELECT 1';
    timedQuery(sql, () => 42);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(sql));
  });

  it('includes the duration in the warning message', () => {
    process.env.SLOW_QUERY_THRESHOLD_MS = '0';
    timedQuery('SELECT slow', () => null);
    const msg: string = warnSpy.mock.calls[0][0];
    expect(msg).toMatch(/\d+ms/);
  });

  it('does not log when the query is faster than the threshold', () => {
    process.env.SLOW_QUERY_THRESHOLD_MS = '999999';
    timedQuery('SELECT fast', () => 'ok');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('returns the query result unchanged', () => {
    process.env.SLOW_QUERY_THRESHOLD_MS = '999999';
    const result = timedQuery('SELECT 1', () => [{ id: 1 }]);
    expect(result).toEqual([{ id: 1 }]);
  });
});
