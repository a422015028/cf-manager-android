"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const auditLog_1 = require("../models/auditLog");
const routeUtils_1 = require("./routeUtils");
const storageService_1 = require("../services/storageService");
const workerService_1 = require("../services/workerService");
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const router = (0, express_1.Router)();
// 演示账户：拦截所有销毁/删除类操作（DELETE、bulk-delete）
router.use(routeUtils_1.demoDestructiveGuard);
function p(req, key) {
    return req.params[key];
}
// ============ KV Namespaces ============
router.get('/:accountId/kv', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.listKvNamespaces)(account);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/:accountId/kv', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { title } = req.body;
        if (!title) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'title is required' } });
            return;
        }
        const result = await (0, storageService_1.createKvNamespace)(account, title);
        (0, auditLog_1.createAuditLog)(account.id, 'kv_create_ns', title, null, 'success');
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:accountId/kv/:nsId', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        await (0, storageService_1.deleteKvNamespace)(account, p(req, 'nsId'));
        (0, auditLog_1.createAuditLog)(account.id, 'kv_delete_ns', p(req, 'nsId'), null, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/kv/:nsId/keys', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { prefix, cursor, limit } = req.query;
        const result = await (0, storageService_1.listKvKeys)(account, p(req, 'nsId'), {
            prefix: prefix,
            cursor: cursor,
            limit: limit ? Number(limit) : undefined,
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/kv/:nsId/values/:key', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, storageService_1.getKvValue)(account, p(req, 'nsId'), p(req, 'key'));
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.put('/:accountId/kv/:nsId/values/:key', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { value, expiration, expiration_ttl, metadata } = req.body;
        await (0, storageService_1.putKvValue)(account, p(req, 'nsId'), p(req, 'key'), value, { expiration, expiration_ttl, metadata });
        (0, auditLog_1.createAuditLog)(account.id, 'kv_write', `${p(req, 'nsId')}/${p(req, 'key')}`, null, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:accountId/kv/:nsId/values/:key', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        await (0, storageService_1.deleteKvKey)(account, p(req, 'nsId'), p(req, 'key'));
        (0, auditLog_1.createAuditLog)(account.id, 'kv_delete', `${p(req, 'nsId')}/${p(req, 'key')}`, null, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.post('/:accountId/kv/:nsId/bulk-delete', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { keys } = req.body;
        if (!Array.isArray(keys)) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'keys must be an array' } });
            return;
        }
        await (0, storageService_1.bulkDeleteKvKeys)(account, p(req, 'nsId'), keys);
        (0, auditLog_1.createAuditLog)(account.id, 'kv_bulk_delete', p(req, 'nsId'), `${keys.length} keys`, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
// ============ D1 ============
router.get('/:accountId/d1', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const result = await (0, workerService_1.listD1Databases)(account);
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.post('/:accountId/d1', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { name } = req.body;
        if (!name) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
            return;
        }
        const result = await (0, storageService_1.createD1Database)(account, name);
        (0, auditLog_1.createAuditLog)(account.id, 'd1_create_db', name, null, 'success');
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:accountId/d1/:dbId', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        await (0, storageService_1.deleteD1Database)(account, p(req, 'dbId'));
        (0, auditLog_1.createAuditLog)(account.id, 'd1_delete_db', p(req, 'dbId'), null, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/d1/:dbId/tables', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const tables = await (0, storageService_1.listD1Tables)(account, p(req, 'dbId'));
        res.json(tables);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/d1/:dbId/tables/:tableName/schema', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const schema = await (0, storageService_1.getD1TableSchema)(account, p(req, 'dbId'), p(req, 'tableName'));
        res.json(schema);
    }
    catch (err) {
        next(err);
    }
});
router.post('/:accountId/d1/:dbId/query', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { sql, allowWrite } = req.body;
        if (!sql) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'sql is required' } });
            return;
        }
        const isWrite = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE)\b/i.test(sql);
        if (isWrite && (0, routeUtils_1.isDemoAccountId)(account.id)) {
            res.status(403).json({ error: { code: 'DEMO_PROTECTED', message: '演示账户的 D1 数据库不可执行写操作（建/删/改）' } });
            return;
        }
        if (isWrite && !allowWrite) {
            res.status(400).json({ error: { code: 'WRITE_NOT_ALLOWED', message: 'Write query requires allowWrite: true' } });
            return;
        }
        const result = await (0, storageService_1.executeD1Query)(account, p(req, 'dbId'), sql);
        if (isWrite) {
            (0, auditLog_1.createAuditLog)(account.id, 'd1_query', p(req, 'dbId'), sql.slice(0, 200), 'success');
        }
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
// ============ R2 ============
router.get('/:accountId/r2', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        // 短路：缓存显示 R2 不可用则直接返回
        const r2Features = (account.available_features || '').split(',');
        if (r2Features.includes('-r2')) {
            res.status(403).json({ success: false, error: { code: 'R2_NOT_ENABLED', message: 'R2 is not enabled for this account' } });
            return;
        }
        const result = await (0, workerService_1.listR2Buckets)(account);
        res.json(result);
    }
    catch (err) {
        const msg = err?.message || '';
        if (msg.includes('10042') || msg.includes('Please enable R2')) {
            res.status(403).json({ success: false, error: { code: 'R2_NOT_ENABLED', message: 'R2 is not enabled for this account' } });
            return;
        }
        next(err);
    }
});
router.post('/:accountId/r2', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { name } = req.body;
        if (!name) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name is required' } });
            return;
        }
        const result = await (0, storageService_1.createR2Bucket)(account, name);
        (0, auditLog_1.createAuditLog)(account.id, 'r2_create_bucket', name, null, 'success');
        res.status(201).json(result);
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:accountId/r2/:bucket', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        await (0, storageService_1.deleteR2Bucket)(account, p(req, 'bucket'));
        (0, auditLog_1.createAuditLog)(account.id, 'r2_delete_bucket', p(req, 'bucket'), null, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/r2/:bucket/objects', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { prefix, delimiter, cursor, limit } = req.query;
        const result = await (0, storageService_1.listR2Objects)(account, p(req, 'bucket'), {
            prefix: prefix,
            delimiter: delimiter || '/',
            cursor: cursor,
            limit: limit ? Number(limit) : undefined,
        });
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:accountId/r2/:bucket/download', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const key = req.query.key;
        if (!key) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'object key is required (query param)' } });
            return;
        }
        const objResp = await (0, storageService_1.getR2Object)(account, p(req, 'bucket'), key);
        const ct = objResp.headers.get('content-type') || 'application/octet-stream';
        res.setHeader('Content-Type', ct);
        const cl = objResp.headers.get('content-length');
        if (cl)
            res.setHeader('Content-Length', cl);
        const inline = req.query.inline === '1' || req.query.inline === 'true';
        res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${key.split('/').pop()}"`);
        const body = objResp.body;
        if (body) {
            if (typeof body.getReader === 'function') {
                const reader = body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    res.write(Buffer.from(value));
                }
            }
            else if (typeof body.pipe === 'function') {
                await new Promise((resolve, reject) => {
                    body.pipe(res, { end: false });
                    body.on('end', resolve);
                    body.on('error', reject);
                });
            }
        }
        res.end();
    }
    catch (err) {
        next(err);
    }
});
router.put('/:accountId/r2/:bucket/upload', upload.single('file'), async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const key = req.body.key;
        if (!key) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'key is required' } });
            return;
        }
        if (!req.file) {
            res.status(400).json({ error: { code: 'NO_FILE', message: 'file is required' } });
            return;
        }
        await (0, storageService_1.putR2Object)(account, p(req, 'bucket'), key, req.file.buffer, req.file.mimetype);
        (0, auditLog_1.createAuditLog)(account.id, 'r2_upload', `${p(req, 'bucket')}/${key}`, `${req.file.size} bytes`, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:accountId/r2/:bucket/objects', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const key = req.query.key;
        if (!key) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'object key is required (query param)' } });
            return;
        }
        await (0, storageService_1.deleteR2Object)(account, p(req, 'bucket'), key);
        (0, auditLog_1.createAuditLog)(account.id, 'r2_delete', `${p(req, 'bucket')}/${key}`, null, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.post('/:accountId/r2/:bucket/bulk-delete', async (req, res, next) => {
    try {
        const account = (0, routeUtils_1.getAccountOr404)(req, res);
        if (!account)
            return;
        const { keys } = req.body;
        if (!Array.isArray(keys)) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'keys must be an array' } });
            return;
        }
        await (0, storageService_1.bulkDeleteR2Objects)(account, p(req, 'bucket'), keys);
        (0, auditLog_1.createAuditLog)(account.id, 'r2_bulk_delete', p(req, 'bucket'), `${keys.length} objects`, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=storage.js.map