import { Request, Response } from 'express';

export function methodNotAllowed(allowedMethods: string[]) {
  return (req: Request, res: Response) => {
    res.set('Allow', allowedMethods.join(', '));
    res.status(405).json({ success: false, error: 'Method Not Allowed' });
  };
}
