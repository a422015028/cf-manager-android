"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizePath = normalizePath;
exports.canonicalizeMiddleware = canonicalizeMiddleware;
/**
 * 路径规范化（P1-4）：
 * 1. 折叠连续斜杠（/api//ai -> /api/ai，所有路径）
 * 2. 仅对 /api 与 /v1 前缀：小写化（/API/AI -> /api/ai）+ 去除尾部斜杠（根路径 / 保留）
 *
 * 目的：消除 Docker(Express) 与 Worker(Hono) 两端对变形路径（双斜杠、尾部斜杠、大小写）
 * 的路由匹配结果不一致，避免路径绕过或 404/500 差异。
 * 非 API 路径（如 /admin 静态资源、SPA 路由）仅折叠双斜杠、保持原样——
 * 例如 /admin/ 不可改为 /admin，否则会与 /admin 的 302 重定向形成死循环。
 */
function normalizePath(pathname) {
    let p = pathname.replace(/\/+/g, '/');
    const isApi = p.toLowerCase().startsWith('/api') || p.toLowerCase().startsWith('/v1');
    if (isApi) {
        p = p.toLowerCase();
    }
    if (isApi && p.length > 1 && p.endsWith('/')) {
        p = p.slice(0, -1);
    }
    return p;
}
function canonicalizeMiddleware(req, _res, next) {
    const [pathname, search] = req.url.split('?');
    const normalized = normalizePath(pathname || '/');
    const newUrl = normalized + (search !== undefined ? `?${search}` : '');
    req.url = newUrl;
    req.originalUrl = newUrl;
    next();
}
//# sourceMappingURL=canonicalize.js.map