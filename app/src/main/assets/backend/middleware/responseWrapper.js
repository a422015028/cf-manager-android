"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.responseWrapper = responseWrapper;
/**
 * Auto-wraps res.json() calls into { success, data } or { success, error }.
 * Only applied to /api/* routes; /v1/* external APIs are excluded.
 */
function responseWrapper(_req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function (body) {
        // Skip wrapping for all OpenAI-compatible paths (/v1/*, /api/v1/*), keep original format.
        // Use originalUrl to be safe across Express versions (path may or may not include mount prefix).
        const fullUrl = _req.originalUrl || '';
        if (fullUrl.startsWith('/v1') || fullUrl.startsWith('/api/v1')) {
            return originalJson(body);
        }
        // Skip wrapping for OpenAI format responses (returned by /api/v1/* routes)
        if (body && typeof body === 'object' && (body.object === 'list' || body.object === 'chat.completion' || (typeof body.id === 'string' && body.id.startsWith('chatcmpl-')))) {
            return originalJson(body);
        }
        if (body && typeof body === 'object' && body.success !== undefined) {
            if (body.data !== undefined || body.error !== undefined) {
                return originalJson(body);
            }
            const { success, ...rest } = body;
            if (success) {
                return originalJson({
                    success: true,
                    data: Object.keys(rest).length > 0 ? rest : undefined,
                });
            }
            return originalJson({
                success: false,
                error: Object.keys(rest).length > 0 ? rest : undefined,
            });
        }
        const code = res.statusCode;
        if (code >= 400) {
            if (body && typeof body === 'object' && body.error) {
                return originalJson({ success: false, error: body.error });
            }
            return originalJson({ success: false, error: body });
        }
        return originalJson({ success: true, data: body });
    };
    next();
}
//# sourceMappingURL=responseWrapper.js.map