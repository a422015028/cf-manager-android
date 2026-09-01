"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const compression_1 = __importDefault(require("compression"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const config_1 = require("./config");
const db_1 = require("./db");
const auth_1 = require("./middleware/auth");
const errorHandler_1 = require("./middleware/errorHandler");
const v1ErrorHandler_1 = require("./middleware/v1ErrorHandler");
const responseWrapper_1 = require("./middleware/responseWrapper");
const accounts_1 = __importDefault(require("./routes/accounts"));
const dns_1 = __importDefault(require("./routes/dns"));
const workers_1 = __importDefault(require("./routes/workers"));
const browserRender_1 = __importDefault(require("./routes/browserRender"));
const settings_1 = __importDefault(require("./routes/settings"));
const storage_1 = __importDefault(require("./routes/storage"));
const tasks_1 = __importDefault(require("./routes/tasks"));
const openai_1 = __importDefault(require("./routes/openai"));
const externalBrowserRender_1 = __importDefault(require("./routes/externalBrowserRender"));
const ai_1 = __importDefault(require("./routes/ai"));
const store_1 = __importDefault(require("./routes/store"));
const tunnels_1 = __importDefault(require("./routes/tunnels"));
const quotaTracker_1 = require("./services/quotaTracker");
const accountRouter_1 = require("./services/accountRouter");
const auditLog_1 = require("./models/auditLog");
const taskScheduler_1 = require("./services/taskScheduler");
const browserRateLimiter_1 = require("./services/browserRateLimiter");
const v1Logger_1 = require("./middleware/v1Logger");
const apiLogger_1 = require("./middleware/apiLogger");
const requestId_1 = require("./middleware/requestId");
const logger_1 = require("./services/logger");
const node_cron_1 = __importDefault(require("node-cron"));
const catalogSource_1 = require("./models/catalogSource");
const store_2 = require("./routes/store");
const app = (0, express_1.default)();
app.use((0, cors_1.default)({
    origin: true, // Allow all origins (or specify your frontend URL)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Account-ID'],
    credentials: false,
}));
app.use(express_1.default.json({ limit: '100mb' }));
// Health check — before auth so Docker healthcheck works without API_SECRET
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});
// ---- Static frontend serving (Docker all-in-one mode) ----
// Must be BEFORE authMiddleware so the login page loads without credentials.
// API routes (/api/*, /v1/*) are registered after authMiddleware and remain protected.
const frontendDir = path_1.default.join(__dirname, 'public');
if (fs_1.default.existsSync(frontendDir)) {
    app.use((0, compression_1.default)());
    app.use(express_1.default.static(frontendDir, {
        maxAge: '30d',
        immutable: true,
        setHeaders: (res, filePath) => {
            // index.html should never be cached
            if (filePath.endsWith('index.html')) {
                res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            }
        },
    }));
    logger_1.appLogger.info(`Serving frontend from ${frontendDir}`);
}
// SPA fallback: all non-API, non-v1 GET routes serve index.html.
// Must be BEFORE authMiddleware so the browser can load frontend pages
// (e.g. /ai, /dashboard) on a full page reload without an Authorization header.
// The regex excludes /api/ and /v1/ paths, so protected API routes are unaffected.
if (fs_1.default.existsSync(path_1.default.join(__dirname, 'public'))) {
    app.get(/^(?!\/api\/|\/v1\/).*/, (_req, res) => {
        res.sendFile(path_1.default.join(path_1.default.join(__dirname, 'public'), 'index.html'));
    });
}
app.use(auth_1.authMiddleware);
// External APIs — no responseWrapper, keep original format
// Mount BEFORE /api middleware to avoid responseWrapper
app.use('/v1', requestId_1.requestIdMiddleware);
app.use('/v1', v1Logger_1.v1RequestLogger);
app.use('/v1', openai_1.default);
app.use('/v1', v1ErrorHandler_1.v1ErrorHandler); // OpenAI-format error handler (before global errorHandler)
app.use('/v1/browser', externalBrowserRender_1.default);
// Internal APIs — with responseWrapper
app.use('/api', apiLogger_1.apiRequestLogger);
app.use('/api', responseWrapper_1.responseWrapper);
app.use('/api/accounts', accounts_1.default);
app.use('/api/dns', dns_1.default);
app.use('/api/workers', workers_1.default);
app.use('/api/browser-render', browserRender_1.default);
app.use('/api/settings', settings_1.default);
app.use('/api/storage', storage_1.default);
app.use('/api/tasks', tasks_1.default);
app.use('/api/ai', ai_1.default);
app.use('/api/store', store_1.default);
app.use('/api/tunnels', tunnels_1.default);
app.use('/api/v1', requestId_1.requestIdMiddleware);
app.use('/api/v1', v1Logger_1.v1RequestLogger);
app.use('/api/v1', openai_1.default);
app.use('/api/v1', v1ErrorHandler_1.v1ErrorHandler); // OpenAI-format error handler (before global errorHandler)
app.get('/api/quota', async (_req, res, next) => {
    try {
        await (0, quotaTracker_1.syncUsageFromCloudflare)();
        (0, accountRouter_1.invalidateAiCache)();
        res.json((0, quotaTracker_1.getQuotaSummary)());
    }
    catch (err) {
        next(err);
    }
});
app.get('/api/audit-log', (req, res, next) => {
    try {
        const { action, startDate, endDate } = req.query;
        if (action || startDate || endDate) {
            res.json((0, auditLog_1.queryLogs)({ action, startDate, endDate, limit: 500 }));
        }
        else {
            res.json((0, auditLog_1.getRecentLogs)(100));
        }
    }
    catch (err) {
        next(err);
    }
});
app.get('/api/audit-log/actions', (_req, res, next) => {
    try {
        res.json((0, auditLog_1.getDistinctActions)());
    }
    catch (err) {
        next(err);
    }
});
app.use(errorHandler_1.errorHandler);
async function start() {
    if (typeof db_1.initDbAsync === "function") {
        await db_1.initDbAsync();
    }
        (0, db_1.initDb)();
    (0, taskScheduler_1.initScheduler)();
    (0, browserRateLimiter_1.initBrowserRateLimiter)();
    // Catalog refresh cron (every 6 hours)
    node_cron_1.default.schedule('0 */6 * * *', async () => {
        const sources = (0, catalogSource_1.getEnabledCatalogSources)();
        for (const s of sources) {
            try {
                await (0, store_2.refreshCatalogSource)(s);
            }
            catch (e) {
                logger_1.appLogger.error(`[Cron] catalog refresh ${s.id}: ${e}`);
            }
        }
    });
    app.listen(config_1.config.port, () => {
        logger_1.appLogger.info(`Server running on port ${config_1.config.port}`);
    });
}
process.on('uncaughtException', (err) => {
    logger_1.appLogger.error(`[UNCAUGHT] ${err}`);
});
process.on('unhandledRejection', (err) => {
    logger_1.appLogger.error(`[UNHANDLED_REJECTION] ${err}`);
});
start().catch((err) => logger_1.appLogger.error(`[STARTUP] ${err}`));
//# sourceMappingURL=index.js.map