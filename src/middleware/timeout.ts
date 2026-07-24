import { Request, Response, NextFunction } from 'express';
import config from '../config';

export function requestTimeout(req: Request, res: Response, next: NextFunction): void {
  const ms = config.requestTimeoutMs;
  const timer = setTimeout(() => {
    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        error: 'Request timed out',
        code: 'REQUEST_TIMEOUT',
      });
    }
  }, ms);

  res.on('finish', () => clearTimeout(timer));
  res.on('close', () => clearTimeout(timer));

  next();
}
