import { Request, Response, NextFunction } from 'express';
/**
 * Error handler for OpenAI-compatible routes (/v1, /api/v1).
 * Returns errors in OpenAI format: { error: { message, type, code } }
 * instead of the internal { success: false, error: { code, message } } format.
 *
 * Note: Express may pass arbitrary errors (SyntaxError, non-Error throws),
 * so we accept `any` and type-narrow to AppError.
 */
export declare function v1ErrorHandler(err: any, req: Request, res: Response, _next: NextFunction): void;
//# sourceMappingURL=v1ErrorHandler.d.ts.map