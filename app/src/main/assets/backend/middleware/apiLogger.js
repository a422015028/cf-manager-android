"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRequestLogger = apiRequestLogger;
const logger_1 = require("../services/logger");
function apiRequestLogger(req, res, next) {
    const start = Date.now();
    const { method, originalUrl } = req;
    let logged = false;
    function log(suffix) {
        if (logged)
            return;
        logged = true;
        const duration = Date.now() - start;
        const tag = suffix ? ` [${suffix}]` : '';
        logger_1.apiLogger.info(`${method} ${originalUrl} ${res.statusCode} ${duration}ms${tag}`);
    }
    res.on('finish', () => log());
    res.on('close', () => {
        if (!res.writableFinished)
            log('client_disconnected');
    });
    next();
}
//# sourceMappingURL=apiLogger.js.map