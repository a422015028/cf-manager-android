"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const config_1 = require("../config");
function authMiddleware(req, res, next) {
    if (!config_1.config.apiSecret) {
        next();
        return;
    }
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization header' } });
        return;
    }
    const token = authHeader.substring(7);
    if (token !== config_1.config.apiSecret) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Invalid API secret' } });
        return;
    }
    next();
}
//# sourceMappingURL=auth.js.map