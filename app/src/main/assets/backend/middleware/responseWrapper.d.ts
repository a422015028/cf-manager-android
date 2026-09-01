import { Request, Response, NextFunction } from 'express';
/**
 * Auto-wraps res.json() calls into { success, data } or { success, error }.
 * Only applied to /api/* routes; /v1/* external APIs are excluded.
 */
export declare function responseWrapper(_req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=responseWrapper.d.ts.map