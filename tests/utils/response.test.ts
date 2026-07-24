import { ok, paginated, fail, toIso, normalizeTimestamps } from '../../src/utils/response';

describe('response utils', () => {
  describe('ok', () => {
    it('wraps data in a success envelope', () => {
      const result = ok({ id: 1, name: 'Player One' });
      expect(result).toEqual({
        success: true,
        data: { id: 1, name: 'Player One' },
      });
    });

    it('merges optional meta fields alongside success/data', () => {
      const result = ok({ id: 1 }, { requestId: 'abc-123' });
      expect(result).toEqual({
        success: true,
        data: { id: 1 },
        requestId: 'abc-123',
      });
    });

    it('supports primitive and array data types', () => {
      expect(ok('hello')).toEqual({ success: true, data: 'hello' });
      expect(ok([1, 2, 3])).toEqual({ success: true, data: [1, 2, 3] });
    });

    it('omits meta spread entirely when meta is not provided', () => {
      const result = ok({ id: 1 });
      expect(Object.keys(result)).toEqual(['success', 'data']);
    });
  });

  describe('paginated', () => {
    it('wraps a list with pagination metadata', () => {
      const items = [{ id: 1 }, { id: 2 }];
      const result = paginated(items, 42, 1, 20);
      expect(result).toEqual({
        success: true,
        data: items,
        total: 42,
        page: 1,
        pageSize: 20,
      });
    });

    it('handles an empty page', () => {
      const result = paginated([], 0, 1, 20);
      expect(result).toEqual({
        success: true,
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
    });

    it('handles a later page number', () => {
      const items = [{ id: 21 }];
      const result = paginated(items, 21, 3, 10);
      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(10);
      expect(result.total).toBe(21);
    });
  });

  describe('fail', () => {
    it('wraps an error message in a failure envelope', () => {
      const result = fail('Player not found');
      expect(result).toEqual({
        success: false,
        error: 'Player not found',
      });
    });

    it('preserves the exact error string passed in', () => {
      const result = fail('Validation failed: wallet address is required');
      expect(result.error).toBe('Validation failed: wallet address is required');
    });
  });

  describe('toIso', () => {
    it('converts a Unix-second timestamp to an ISO 8601 UTC string', () => {
      // 2024-01-01T00:00:00.000Z in Unix seconds
      expect(toIso(1704067200)).toBe('2024-01-01T00:00:00.000Z');
    });

    it('converts Unix epoch (0) correctly', () => {
      expect(toIso(0)).toBe('1970-01-01T00:00:00.000Z');
    });

    it('produces a string ending in Z (UTC) regardless of local timezone', () => {
      const result = toIso(1700000000);
      expect(result.endsWith('Z')).toBe(true);
    });
  });

  describe('normalizeTimestamps', () => {
    it('converts specified numeric fields to ISO strings', () => {
      const payload = { id: 1, createdAt: 1704067200, name: 'test' };
      const result = normalizeTimestamps(payload, ['createdAt']);
      expect(result).toEqual({
        id: 1,
        createdAt: '2024-01-01T00:00:00.000Z',
        name: 'test',
      });
    });

    it('converts multiple fields when present', () => {
      const payload = { createdAt: 1704067200, updatedAt: 1704153600 };
      const result = normalizeTimestamps(payload, ['createdAt', 'updatedAt']);
      expect(result.createdAt).toBe('2024-01-01T00:00:00.000Z');
      expect(result.updatedAt).toBe('2024-01-02T00:00:00.000Z');
    });

    it('leaves non-numeric fields untouched', () => {
      const payload = { createdAt: 'already-a-string', id: 5 };
      const result = normalizeTimestamps(payload, ['createdAt']);
      expect(result.createdAt).toBe('already-a-string');
    });

    it('ignores fields not present in the payload', () => {
      const payload = { id: 1 };
      const result = normalizeTimestamps(payload, ['missingField']);
      expect(result).toEqual({ id: 1 });
    });

    it('does not mutate the original payload object', () => {
      const payload = { createdAt: 1704067200 };
      const result = normalizeTimestamps(payload, ['createdAt']);
      expect(payload.createdAt).toBe(1704067200);
      expect(result).not.toBe(payload);
    });

    it('returns an unchanged shallow copy when fields list is empty', () => {
      const payload = { id: 1, createdAt: 1704067200 };
      const result = normalizeTimestamps(payload, []);
      expect(result).toEqual(payload);
      expect(result).not.toBe(payload);
    });
  });
});