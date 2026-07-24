import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiResponse } from '../types';
import { logger } from '../utils/logger';
import { ErrorCode } from '../utils/errorCodes';

interface HttpError extends Error {
  type?: string;
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const correlationId = req.correlationId;

  logger.error(`[error] ${err.message}${correlationId ? ` correlationId=${correlationId}` : ''}`);

  const httpErr = err as HttpError;

  if (httpErr.type === 'entity.parse.failed') {
    res.status(400).json({
      success: false,
      error: 'Malformed JSON payload',
      code: ErrorCode.MALFORMED_JSON,
      ...(correlationId !== undefined && { correlationId }),
    });
    return;
  }

  if (httpErr.type === 'entity.too.large') {
    res.status(413).json({
      success: false,
      error: 'Payload too large',
      code: ErrorCode.PAYLOAD_TOO_LARGE,
      ...(correlationId !== undefined && { correlationId }),
    });
    return;
  }

  if (err instanceof ZodError) {
    const body: ApiResponse & { code: string; correlationId?: string } = {
      success: false,
      error: err.errors[0]?.message ?? 'Validation error',
      code: ErrorCode.VALIDATION_ERROR,
      ...(correlationId !== undefined && { correlationId }),
    };
    res.status(400).json(body);
    return;
  }

  const body: ApiResponse & { code: string; correlationId?: string } = {
    success: false,
    error: err.message,
    code: ErrorCode.INTERNAL_SERVER_ERROR,
    ...(correlationId !== undefined && { correlationId }),
  };
  res.status(500).json(body);
}
