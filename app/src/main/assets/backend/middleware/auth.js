"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const config_1 = require("../config");
function authMiddleware(req, res, next) {
    // 未配置 API_SECRET 时跳过鉴权（开发/演示场景，向后兼容已有部署）。
    // 注意：这会导致所有管理接口处于无鉴权状态，存在安全风险，仅建议本地/内网使用。
    if (!config_1.config.apiSecret) {
        console.warn('[Auth] API_SECRET 未配置，所有管理接口将处于无鉴权状态，存在安全风险。');
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