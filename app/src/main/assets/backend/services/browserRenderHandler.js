"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBrowserRender = handleBrowserRender;
const account_1 = require("../models/account");
const browserRenderService_1 = require("./browserRenderService");
const browserRateLimiter_1 = require("./browserRateLimiter");
const auditLog_1 = require("../models/auditLog");
const VALID_MODES = ['screenshot', 'content', 'markdown', 'pdf', 'links'];
const VALID_BROWSERS = ['chrome', 'kitesurf'];
const DAILY_LIMIT_RETRY_AFTER_THRESHOLD = 60;
function isDailyLimitError(msg, retryAfter) {
    if (msg.includes('Browser time limit exceeded') || msg.includes('browser limit')) {
        return true;
    }
    if (retryAfter > DAILY_LIMIT_RETRY_AFTER_THRESHOLD) {
        return true;
    }
    return false;
}
async function handleBrowserRender(req) {
    const { url, mode = 'screenshot', browser = 'chrome', accountId } = req;
    if (!url || typeof url !== 'string') {
        return { status: 400, body: { success: false, error: { message: 'url is required', code: 'INVALID_REQUEST' } } };
    }
    if (!VALID_MODES.includes(mode)) {
        return { status: 400, body: { success: false, error: { message: `Invalid mode: ${mode}. Supported: ${VALID_MODES.join(', ')}`, code: 'INVALID_MODE' } } };
    }
    if (browser && !VALID_BROWSERS.includes(browser)) {
        return { status: 400, body: { success: false, error: { message: `Invalid browser: ${browser}. Supported: ${VALID_BROWSERS.join(', ')}`, code: 'INVALID_BROWSER' } } };
    }
    let account;
    if (accountId) {
        const found = (0, account_1.getAccountById)(accountId);
        if (!found) {
            return { status: 404, body: { success: false, error: { message: `Account ${accountId} not found`, code: 'ACCOUNT_NOT_FOUND' } } };
        }
        account = found;
    }
    else {
        const token = (0, browserRateLimiter_1.acquireToken)();
        if (token.type === 'all_exhausted') {
            return { status: 429, body: { success: false, error: { message: '所有账户今日浏览器渲染配额已耗尽', code: 'ALL_ACCOUNTS_EXHAUSTED' } } };
        }
        if (token.type === 'rate_limited') {
            return { status: 429, body: { success: false, error: { message: `请求过于频繁，请等待 ${Math.ceil(token.waitMs / 1000)} 秒后重试`, code: 'RATE_LIMITED', waitMs: token.waitMs } } };
        }
        account = token.account;
    }
    try {
        const result = await (0, browserRenderService_1.renderPage)(account, url, mode, browser);
        (0, auditLog_1.createAuditLog)(account.id, 'browser_render', url, `mode=${mode} browser=${browser} ${result.browserMsUsed || 0}ms`, 'success');
        return { status: 200, body: { success: true, result } };
    }
    catch (err) {
        const msg = err?.message || '';
        const statusCode = err?.statusCode || 500;
        const retryAfter = err?.retryAfter || 0;
        if (isDailyLimitError(msg, retryAfter)) {
            (0, browserRateLimiter_1.markAccountExhausted)(account.id);
            (0, auditLog_1.createAuditLog)(account.id, 'browser_render', url, 'daily limit exceeded', 'error');
            if (!accountId) {
                const retry = (0, browserRateLimiter_1.acquireToken)();
                if (retry.type === 'ok') {
                    try {
                        const result = await (0, browserRenderService_1.renderPage)(retry.account, url, mode, browser);
                        (0, auditLog_1.createAuditLog)(retry.account.id, 'browser_render', url, `mode=${mode} browser=${browser} retry ${result.browserMsUsed || 0}ms`, 'success');
                        return { status: 200, body: { success: true, result } };
                    }
                    catch (retryErr) {
                        return { status: retryErr?.statusCode || 500, body: { success: false, error: { message: retryErr.message, code: 'RENDER_FAILED' } } };
                    }
                }
                if (retry.type === 'rate_limited') {
                    return { status: 429, body: { success: false, error: { message: `当前账户已耗尽，备用账户冷却中，请等待 ${Math.ceil(retry.waitMs / 1000)} 秒`, code: 'RATE_LIMITED', waitMs: retry.waitMs } } };
                }
                return { status: 429, body: { success: false, error: { message: '所有账户今日浏览器渲染配额已耗尽', code: 'ALL_ACCOUNTS_EXHAUSTED' } } };
            }
        }
        if (statusCode === 429) {
            const waitMs = retryAfter > 0 ? retryAfter * 1000 : 10_000;
            return { status: 429, body: { success: false, error: { message: msg, code: 'RATE_LIMITED', waitMs } } };
        }
        return { status: statusCode, body: { success: false, error: { message: msg, code: 'RENDER_FAILED' } } };
    }
}
//# sourceMappingURL=browserRenderHandler.js.map