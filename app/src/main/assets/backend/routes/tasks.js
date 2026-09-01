"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auditLog_1 = require("../models/auditLog");
const taskScheduler_1 = require("../services/taskScheduler");
const router = (0, express_1.Router)();
router.get('/', (_req, res, next) => {
    try {
        res.json((0, taskScheduler_1.getAllTasks)());
    }
    catch (err) {
        next(err);
    }
});
router.post('/', (req, res, next) => {
    try {
        const { name, type, cron, config } = req.body;
        if (!name || !type || !cron) {
            res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'name, type, and cron are required' } });
            return;
        }
        const id = (0, taskScheduler_1.createTask)(name, type, cron, config);
        (0, auditLog_1.createAuditLog)(null, 'task_create', name, `type=${type} cron=${cron}`, 'success');
        res.status(201).json({ id });
    }
    catch (err) {
        next(err);
    }
});
router.put('/:id', (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        (0, taskScheduler_1.updateTask)(id, req.body);
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.delete('/:id', (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        const task = (0, taskScheduler_1.getTaskById)(id);
        (0, taskScheduler_1.deleteTask)(id);
        (0, auditLog_1.createAuditLog)(null, 'task_delete', task?.name || String(id), null, 'success');
        res.json({ success: true });
    }
    catch (err) {
        next(err);
    }
});
router.post('/:id/run', async (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        const result = await (0, taskScheduler_1.runTaskNow)(id);
        const task = (0, taskScheduler_1.getTaskById)(id);
        (0, auditLog_1.createAuditLog)(null, 'task_run', task?.name || String(id), result.status, 'success');
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
router.get('/:id/history', (req, res, next) => {
    try {
        const id = parseInt(req.params.id, 10);
        const limit = req.query.limit ? Number(req.query.limit) : 20;
        res.json((0, taskScheduler_1.getTaskHistory)(id, limit));
    }
    catch (err) {
        next(err);
    }
});
exports.default = router;
//# sourceMappingURL=tasks.js.map