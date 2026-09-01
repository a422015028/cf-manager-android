"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.v1ErrorHandler = v1ErrorHandler;
const logger_1 = require("../services/logger");
/**
 * Error handler for OpenAI-compatible routes (/v1, /api/v1).
 * Returns errors in OpenAI format: { error: { message, type, code } }
 * instead of the internal { success: false, error: { code, message } } format.
 *
 * Note: Express may pass arbitrary errors (SyntaxError, non-Error throws),
 * so we accept `any` and type-narrow to AppError.
 */
function v1ErrorHandler(err, req, res, _next) {
    const statusCode = (err && typeof err === 'object' && err.statusCode) || 500;
    const code = (err && typeof err === 'object' && err.code) || 'INTERNAL_ERROR';
    const message = (err && typeof err === 'object' && err.message) || String(err);
    logger_1.appLogger.error(`[V1 ${code}] ${req.method} ${req.originalUrl} - ${message}`);
    if (res.headersSent)
        return;
    res.status(statusCode).json({
        error: {
            message,
            type: statusCode >= 500 ? 'server_error' : 'invalid_request_error',
            code,
        },
    });
}
//# sourceMappingURL=v1ErrorHandler.js.map