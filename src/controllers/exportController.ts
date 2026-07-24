import { Request, Response, NextFunction } from 'express';
import { getEventsPage, EventExportRow } from '../db';
import { adminDateRangeSchema } from './adminController';
import type { ContractEventType } from '../types';

/** Rows are streamed to the client in bounded pages instead of loading the whole table. */
const PAGE_SIZE = 500;

/**
 * Escapes a single CSV field per RFC 4180: any value containing a comma,
 * double quote, or newline (\n or \r) is wrapped in double quotes, with
 * internal double quotes doubled.
 */
export function csvEscapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Formats a single event row as one CSV line (including trailing newline). */
export function formatEventCsvRow(row: EventExportRow): string {
  const timestampSeconds = Math.floor((row.createdAt ?? 0) / 1000);
  const fields = [
    csvEscapeField(row.type),
    String(row.ledger),
    String(timestampSeconds),
    csvEscapeField(JSON.stringify(row.payload)),
  ];
  return fields.join(',') + '\n';
}

/**
 * GET /api/admin/events/export
 *
 * Streams indexed contract events as CSV.
 *
 * Columns:
 *   event_type — Soroban contract event name (e.g. player_registered)
 *   ledger     — ledger sequence number when the event was emitted
 *   timestamp  — Unix epoch seconds
 *   payload    — JSON-encoded event payload
 *
 * Query params (identical semantics to GET /api/admin/events):
 *   startDate  — ISO 8601, inclusive lower bound on the event's indexed time
 *   endDate    — ISO 8601, inclusive upper bound on the event's indexed time
 *   eventType  — filter to a single contract event type
 *
 * Rows are read from the `events` table in bounded LIMIT/OFFSET pages and
 * written to the response as each page arrives, so memory usage stays
 * constant regardless of table size.
 */
export async function exportEvents(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = adminDateRangeSchema.safeParse(req.query ?? {});
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: parsed.error.errors[0]?.message ?? 'Invalid query parameters',
      });
      return;
    }

    const { startDate, endDate, eventType } = parsed.data;
    const eventTypeFilter = eventType as ContractEventType | undefined;

    res.status(200);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="events.csv"');

    res.write('event_type,ledger,timestamp,payload\n');

    let offset = 0;
    for (;;) {
      const page = getEventsPage({ type: eventTypeFilter, startDate, endDate }, PAGE_SIZE, offset);
      if (page.length === 0) break;

      for (const row of page) {
        res.write(formatEventCsvRow(row));
      }

      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    res.end();
  } catch (err) {
    next(err);
  }
}
