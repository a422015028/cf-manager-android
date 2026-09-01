"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.v1RequestLogger = v1RequestLogger;
const logger_1 = require("../services/logger");
function v1RequestLogger(req, res, next) {
    const start = Date.now();
    const { method, originalUrl } = req;
    // 打印完整请求体（增加到2000字符）
    const fullBody = req.body ? JSON.stringify(req.body, null, 2) : '';
    // 打印请求头（排除敏感信息）
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (key === 'authorization') {
            headers[key] = typeof value === 'string' ? value.slice(0, 20) + '***' : '***';
        }
        else {
            headers[key] = typeof value === 'string' ? value : JSON.stringify(value);
        }
    }
    let logged = false;
    function log(suffix) {
        if (logged)
            return;
        logged = true;
        const duration = Date.now() - start;
        const tag = suffix ? ` [${suffix}]` : '';
        const rid = req.requestId || '-';
        const streamFlag = req.body?.stream === true ? 'STREAM' : 'NON-STREAM';
        const bodySize = req.headers['content-length'] || '?';
        logger_1.v1Logger.info(`[${rid}] ${method} ${originalUrl} ${res.statusCode} ${duration}ms${tag} [${streamFlag}] [body=${bodySize}B]`);
        logger_1.v1Logger.info(`[${rid}] Headers: ${JSON.stringify(headers)}`);
        if (fullBody) {
            logger_1.v1Logger.info(`[${rid}] Request body: ${fullBody.slice(0, 2000)}${fullBody.length > 2000 ? '... (truncated)' : ''}`);
        }
    }
    // Only use res events for disconnect detection.
    // Do NOT use req.on('close') — in Node.js 18+ it fires when the request
    // body has been fully read (which is BEFORE we send the response),
    // causing false-positive disconnect logs.
    res.on('finish', () => log());
    res.on('close', () => {
        if (!res.writableFinished)
            log('client_disconnected');
    });
    next();
}
//# sourceMappingURL=v1Logger.js.map