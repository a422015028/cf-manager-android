"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestIdMiddleware = requestIdMiddleware;
const utils_1 = require("../utils");
/**
 * Generates (or propagates) a request ID for tracing.
 * Sets `req.requestId` and the `X-Request-ID` response header so that
 * logs, audit entries, and client responses can be correlated.
 */
function requestIdMiddleware(req, res, next) {
    const id = req.headers['x-request-id'] || (0, utils_1.safeRandomUUID)();
    req.requestId = id;
    res.setHeader('X-Request-ID', id);
    next();
}
//# sourceMappingURL=requestId.js.map