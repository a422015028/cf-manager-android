"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const browserRenderHandler_1 = require("../services/browserRenderHandler");
const browserRateLimiter_1 = require("../services/browserRateLimiter");
const router = (0, express_1.Router)();
router.post('/render', async (req, res, next) => {
    try {
        const { url, mode, browser, accountId } = req.body;
        const { status, body } = await (0, browserRenderHandler_1.handleBrowserRender)({ url, mode, browser, accountId });
        res.status(status).json(body);
    }
    catch (err) {
        next(err);
    }
});
router.get('/status', (_req, res) => {
    res.json((0, browserRateLimiter_1.getBrowserRenderStatus)());
});
exports.default = router;
//# sourceMappingURL=externalBrowserRender.js.map