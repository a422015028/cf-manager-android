"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderPage = renderPage;
const cfFactory_1 = require("./cfFactory");
const quotaTracker_1 = require("./quotaTracker");
const proxyService_1 = require("./proxyService");
async function renderPage(account, url, mode = 'screenshot', browser = 'chrome') {
    const accountId = account.account_id;
    const headers = (0, cfFactory_1.getAuthHeaders)(account);
    const startTime = Date.now();
    const result = { mode, duration: 0 };
    const body = { url };
    // Kitesurf 引擎通过向 Browser Run Quick Action 端点追加 ?browser=kitesurf 启用
    const query = browser === 'kitesurf' ? '?browser=kitesurf' : '';
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/${mode}${query}`;
    const resp = await (0, proxyService_1.proxyFetch)(endpoint, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    }, 300000, undefined, account);
    if (!resp.ok) {
        const errorBrowserMs = parseInt(resp.headers.get('x-browser-ms-used') || '0', 10);
        if (errorBrowserMs > 0) {
            (0, quotaTracker_1.trackUsage)(account.id, 'browser_render_seconds', Math.ceil(errorBrowserMs / 1000));
        }
        const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
        const text = await resp.text();
        const err = new Error(`${mode} 失败 (${resp.status}): ${text}`);
        err.statusCode = resp.status;
        err.retryAfter = retryAfter;
        throw err;
    }
    const contentType = resp.headers.get('content-type') || '';
    switch (mode) {
        case 'screenshot': {
            const buf = Buffer.from(await resp.arrayBuffer());
            result.screenshot = `data:image/png;base64,${buf.toString('base64')}`;
            break;
        }
        case 'pdf': {
            const buf = Buffer.from(await resp.arrayBuffer());
            result.pdf = `data:application/pdf;base64,${buf.toString('base64')}`;
            break;
        }
        case 'content': {
            if (contentType.includes('application/json')) {
                const json = await resp.json();
                result.html = json.result || JSON.stringify(json);
            }
            else {
                result.html = await resp.text();
            }
            break;
        }
        case 'markdown': {
            if (contentType.includes('application/json')) {
                const json = await resp.json();
                result.markdown = json.result || JSON.stringify(json);
            }
            else {
                result.markdown = await resp.text();
            }
            break;
        }
        case 'links': {
            const json = await resp.json();
            result.links = json.result ?? json;
            break;
        }
    }
    const browserMsUsed = parseInt(resp.headers.get('x-browser-ms-used') || '0', 10);
    const browserSeconds = browserMsUsed > 0 ? browserMsUsed / 1000 : (Date.now() - startTime) / 1000;
    result.duration = browserSeconds;
    result.browserMsUsed = browserMsUsed;
    (0, quotaTracker_1.trackUsage)(account.id, 'browser_render_seconds', Math.ceil(browserSeconds));
    return result;
}
//# sourceMappingURL=browserRenderService.js.map