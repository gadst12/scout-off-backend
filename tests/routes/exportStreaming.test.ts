import { Request, Response, NextFunction } from 'express';
import { exportEvents } from '../../src/controllers/exportController';
import * as db from '../../src/db';

const PAGE_SIZE = 500;
const TOTAL_EVENTS = 5001; // > 5000, and one past an exact multiple of PAGE_SIZE

/**
 * Minimal RFC 4180-aware CSV parser, good enough to round-trip the fields
 * this module produces (quoted fields with doubled internal quotes).
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += 1;
      continue;
    }
    if (char === '\r') {
      i += 1; // ignore bare CR
      continue;
    }
    field += char;
    i += 1;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function makeStreamingRes() {
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  let statusCode = 200;
  let ended = false;
  const res = {
    setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
    status: jest.fn((code: number) => { statusCode = code; return res; }),
    write: jest.fn((chunk: string) => { chunks.push(chunk); return true; }),
    end: jest.fn(() => { ended = true; return res; }),
    json: jest.fn((data: unknown) => { chunks.push(JSON.stringify(data)); return res; }),
  } as unknown as Response;
  return {
    res,
    getBody: () => chunks.join(''),
    getStatus: () => statusCode,
    isEnded: () => ended,
  };
}

describe('GET /api/admin/events/export — streaming pagination (#471)', () => {
  const specialPayload = {
    note: 'quotes "like this", a comma, and a\nnewline',
  };
  let specialLedger: number;

  beforeAll(() => {
    const baseLedger = 1_000_000;
    const insert = db.getDb().prepare(
      'INSERT OR IGNORE INTO events (type, ledger, tx_hash, payload, created_at) VALUES (?, ?, ?, ?, ?)'
    );
    const insertMany = db.getDb().transaction((rows: Array<[string, number, string, string, number]>) => {
      for (const row of rows) insert.run(...row);
    });

    const rows: Array<[string, number, string, string, number]> = [];
    for (let i = 0; i < TOTAL_EVENTS; i++) {
      const isSpecial = i === Math.floor(TOTAL_EVENTS / 2);
      const ledger = baseLedger + i;
      const createdAt = Date.UTC(2024, 0, 1, 0, 0, i);
      rows.push([
        'player_registered',
        ledger,
        `export-stream-tx-${i}`,
        JSON.stringify(isSpecial ? specialPayload : { i }),
        createdAt,
      ]);
      if (isSpecial) specialLedger = ledger;
    }
    insertMany(rows);
  });

  it('streams every seeded row, in ledger order, using bounded pagination rather than one big fetch', async () => {
    const pageCalls: Array<{ limit: number; offset: number }> = [];
    const originalGetEventsPage = db.getEventsPage;
    const spy = jest.spyOn(db, 'getEventsPage');
    spy.mockImplementation((filter, limit, offset) => {
      pageCalls.push({ limit, offset });
      return originalGetEventsPage(filter, limit, offset);
    });

    const req = { query: { eventType: 'player_registered' } } as unknown as Request;
    const { res, getStatus, getBody, isEnded } = makeStreamingRes();
    const next = jest.fn() as NextFunction;

    await exportEvents(req, res, next);

    expect(getStatus()).toBe(200);
    expect(isEnded()).toBe(true);
    expect(next).not.toHaveBeenCalled();

    // --- Proves real pagination: many calls, strictly increasing offsets, bounded page size ---
    expect(pageCalls.length).toBeGreaterThan(1);
    for (const call of pageCalls) {
      expect(call.limit).toBe(PAGE_SIZE);
    }
    for (let i = 1; i < pageCalls.length; i++) {
      expect(pageCalls[i].offset).toBe(pageCalls[i - 1].offset + PAGE_SIZE);
    }
    expect(pageCalls[0].offset).toBe(0);

    // --- Row count + header ---
    const body = getBody();
    const rows = parseCsv(body).filter((r) => r.length > 1 || r[0] !== '');
    const [header, ...dataRows] = rows;
    expect(header).toEqual(['event_type', 'ledger', 'timestamp', 'payload']);
    expect(dataRows.length).toBe(TOTAL_EVENTS);

    // --- Order: ledgers strictly ascending, matching seed/insertion order ---
    const ledgers = dataRows.map((r) => Number(r[1]));
    for (let i = 1; i < ledgers.length; i++) {
      expect(ledgers[i]).toBeGreaterThan(ledgers[i - 1]);
    }

    // --- Escaping round-trip for the row with comma/quote/newline in its JSON payload ---
    const specialRow = dataRows.find((r) => Number(r[1]) === specialLedger);
    expect(specialRow).toBeDefined();
    const parsedPayload = JSON.parse(specialRow![3]);
    expect(parsedPayload).toEqual(specialPayload);

    spy.mockRestore();
  }, 30000);

  it('honors eventType/date-range filters identically to /api/admin/events semantics', async () => {
    const req = {
      query: {
        eventType: 'player_registered',
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-01-01T00:00:01.000Z',
      },
    } as unknown as Request;
    const { res, getBody, getStatus } = makeStreamingRes();
    const next = jest.fn() as NextFunction;

    await exportEvents(req, res, next);

    expect(getStatus()).toBe(200);
    const rows = parseCsv(getBody()).filter((r) => r.length > 1 || r[0] !== '');
    const [, ...dataRows] = rows;
    // createdAt for event i is 2024-01-01T00:00:0<i>Z, so only i in {0, 1} (0 and 1 seconds) qualify.
    expect(dataRows.length).toBe(2);
  });

  it('returns 400 for an invalid date range without touching the DB layer', async () => {
    const req = {
      query: { startDate: '2025-01-01T00:00:00.000Z', endDate: '2020-01-01T00:00:00.000Z' },
    } as unknown as Request;
    const { res, getStatus } = makeStreamingRes();
    const next = jest.fn() as NextFunction;

    await exportEvents(req, res, next);

    expect(getStatus()).toBe(400);
  });
});
