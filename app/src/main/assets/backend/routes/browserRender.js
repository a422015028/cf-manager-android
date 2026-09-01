"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const browserRenderHandler_1 = require("../services/browserRenderHandler");
const router = (0, express_1.Router)();
router.post('/', async (req, res, next) => {
    try {
        const { url, mode, browser, accountId } = req.body;
        const { status, body } = await (0, browserRenderHandler_1.handleBrowserRender)({ url, mode, browser, accountId });
        res.status(status).json(body.result || body);
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=browserRender.js.map