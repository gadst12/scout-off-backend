import { Request, Response, NextFunction } from 'express';
import config from '../config';

interface RateLimitOptions {
  windowMs?: number; // time window in ms (default: config.rateLimit.windowMs)
  max?: number;      // max requests per window per IP (default: config.rateLimit.max)
}

/**
 * Simple in-process IP-based rate limiter.
 * Configurable via windowMs and max; excess requests return HTTP 429.
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? config.rateLimit.windowMs;
  const max = options.max ?? config.rateLimit.max;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.rateLimit.enabled) {
      next();
      return;
    }
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = hits.get(ip);

    if (!entry || now >= entry.resetAt) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      res.status(429).json({ success: false, error: 'Too many requests, please try again later' });
      return;
    }
    next();
  };
}

/**
 * Simple in-process wallet-based rate limiter.
 * Configurable via windowMs and max; excess requests return HTTP 429.
 * If req.account is not present, it calls next().
 */
export function walletRateLimit(options: RateLimitOptions = {}) {
  const windowMs = options.windowMs ?? config.rateLimit.windowMs;
  const max = options.max ?? config.rateLimit.max;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!config.rateLimit.enabled) {
      next();
      return;
    }
    const wallet = req.account;
    if (!wallet) {
      next();
      return;
    }
    const now = Date.now();
    const entry = hits.get(wallet);

    if (!entry || now >= entry.resetAt) {
      hits.set(wallet, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count += 1;
    if (entry.count > max) {
      res.status(429).json({ success: false, error: 'Too many requests, please try again later' });
      return;
    }
    next();
  };
}
