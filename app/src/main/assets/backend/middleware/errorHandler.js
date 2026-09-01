"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const logger_1 = require("../services/logger");
function errorHandler(err, req, res, _next) {
    const statusCode = err.statusCode || 500;
    const code = err.code || 'INTERNAL_ERROR';
    logger_1.appLogger.error(`[${code}] ${req.method} ${req.originalUrl} - ${err.message}`);
    if (res.headersSent) {
        return;
    }
    res.status(statusCode).json({
        success: false,
        error: {
            code,
            message: err.message,
        },
    });
}
//# sourceMappingURL=errorHandler.js.map