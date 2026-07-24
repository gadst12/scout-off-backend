/**
 * Attaches the current OpenTelemetry trace-id as an `X-Trace-Id` response
 * header so clients can correlate requests with distributed traces (#344).
 *
 * When tracing is disabled (no OTLP endpoint / Noop exporter) the
 * active span is an invalid span whose trace-id is all-zeros; in that case
 * the header is omitted to avoid noise.
 */

import { Request, Response, NextFunction } from 'express';
import { trace, isSpanContextValid } from '@opentelemetry/api';

export function traceId(req: Request, res: Response, next: NextFunction): void {
  const span = trace.getActiveSpan();
  if (span) {
    const ctx = span.spanContext();
    if (isSpanContextValid(ctx)) {
      res.setHeader('X-Trace-Id', ctx.traceId);
    }
  }
  next();
}
