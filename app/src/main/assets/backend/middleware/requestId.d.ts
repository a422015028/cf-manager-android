import { Request, Response, NextFunction } from 'express';
declare module 'express-serve-static-core' {
    interface Request {
        requestId: string;
    }
}
/**
 * Generates (or propagates) a request ID for tracing.
 * Sets `req.requestId` and the `X-Request-ID` response header so that
 * logs, audit entries, and client responses can be correlated.
 */
export declare function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=requestId.d.ts.map