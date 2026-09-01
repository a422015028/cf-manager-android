"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const config_1 = require("../config");
const accountRouter_1 = require("../services/accountRouter");
const cfFactory_1 = require("../services/cfFactory");
const proxyService_1 = require("../services/proxyService");
const version_1 = require("../version");
const router = (0, express_1.Router)();
router.get('/', (_req, res) => {
    const resin = (0, proxyService_1.getResinConfig)();
    res.json({
        encryption_key_configured: !!config_1.config.encryptionKey,
        api_secret_configured: !!config_1.config.apiSecret,
        demo_account_ids: config_1.config.demoAccountIds || '',
        db_path: config_1.config.dbPath,
        proxy_url: (0, proxyService_1.getProxyUrl)(),
        proxy_enabled: (0, proxyService_1.isProxyEnabled)(),
        resin_enabled: resin.enabled,
        resin_url: resin.url,
        resin_token: resin.token ? '***' : '',
        resin_platform: resin.platform,
        platform: 'node-backend',
        version: version_1.VERSION,
        git_commit: version_1.GIT_COMMIT,
    });
});
router.post('/cache/clear', (_req, res) => {
    (0, accountRouter_1.clearCache)();
    (0, cfFactory_1.clearClientCache)();
    res.json({ success: true, message: 'All caches cleared (zones, quota, SDK clients)' });
});
router.put('/proxy', (req, res) => {
    const { proxy_url, proxy_enabled } = req.body;
    if (proxy_url !== undefined) {
        if (typeof proxy_url !== 'string') {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'proxy_url must be a string' } });
            return;
        }
        (0, proxyService_1.setProxyUrl)(proxy_url);
    }
    if (proxy_enabled !== undefined) {
        (0, proxyService_1.setProxyEnabled)(!!proxy_enabled);
    }
    (0, cfFactory_1.clearClientCache)();
    res.json({ success: true, proxy_url: (0, proxyService_1.getProxyUrl)(), proxy_enabled: (0, proxyService_1.isProxyEnabled)() });
});
router.post('/proxy/test', async (req, res) => {
    const { proxy_url } = req.body;
    const url = typeof proxy_url === 'string' ? proxy_url : (0, proxyService_1.getProxyUrl)();
    if (!url) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No proxy URL to test' } });
        return;
    }
    try {
        const result = await (0, proxyService_1.testProxyConnection)(url);
        res.json({ success: true, ...result });
    }
    catch (err) {
        res.status(502).json({ error: { code: 'PROXY_TEST_FAILED', message: err.message || 'Proxy test failed' } });
    }
});
// ---- Resin 代理池 ----
router.put('/resin', (req, res) => {
    const { enabled, url, token, platform } = req.body;
    const cfg = {};
    if (enabled !== undefined)
        cfg.enabled = !!enabled;
    if (url !== undefined)
        cfg.url = typeof url === 'string' ? url : '';
    if (token !== undefined)
        cfg.token = typeof token === 'string' ? token : '';
    if (platform !== undefined)
        cfg.platform = typeof platform === 'string' ? platform : 'Default';
    (0, proxyService_1.setResinConfig)(cfg);
    (0, cfFactory_1.clearClientCache)();
    const updated = (0, proxyService_1.getResinConfig)();
    res.json({ success: true, ...updated, token: updated.token ? '***' : '' });
});
router.post('/resin/test', async (_req, res) => {
    try {
        const result = await (0, proxyService_1.testResinConnection)();
        res.json({ success: true, ...result });
    }
    catch (err) {
        res.status(502).json({ error: { code: 'RESIN_TEST_FAILED', message: err.message || 'Resin test failed' } });
    }
});
exports.default = router;
//# sourceMappingURL=settings.js.map