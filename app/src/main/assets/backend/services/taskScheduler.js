"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAllTasks = getAllTasks;
exports.getTaskById = getTaskById;
exports.createTask = createTask;
exports.updateTask = updateTask;
exports.deleteTask = deleteTask;
exports.getTaskHistory = getTaskHistory;
exports.runTaskNow = runTaskNow;
exports.initScheduler = initScheduler;
const cron = __importStar(require("node-cron"));
const db_1 = require("../db");
const logger_1 = require("./logger");
const activeJobs = new Map();
function getAllTasks() {
    return (0, db_1.getDb)().prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all();
}
function getTaskById(id) {
    return (0, db_1.getDb)().prepare('SELECT * FROM scheduled_tasks WHERE id = ?').get(id);
}
function createTask(name, type, cronExpr, config) {
    if (!cron.validate(cronExpr)) {
        throw Object.assign(new Error(`Invalid cron expression: ${cronExpr}`), { statusCode: 400 });
    }
    const result = (0, db_1.getDb)()
        .prepare('INSERT INTO scheduled_tasks (name, type, cron, config) VALUES (?, ?, ?, ?)')
        .run(name, type, cronExpr, config ? JSON.stringify(config) : null);
    const id = result.lastInsertRowid;
    scheduleTask(id);
    return id;
}
function updateTask(id, updates) {
    const task = getTaskById(id);
    if (!task)
        throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    if (updates.cron && !cron.validate(updates.cron)) {
        throw Object.assign(new Error(`Invalid cron expression: ${updates.cron}`), { statusCode: 400 });
    }
    const sets = [];
    const vals = [];
    if (updates.name !== undefined) {
        sets.push('name = ?');
        vals.push(updates.name);
    }
    if (updates.cron !== undefined) {
        sets.push('cron = ?');
        vals.push(updates.cron);
    }
    if (updates.config !== undefined) {
        sets.push('config = ?');
        vals.push(JSON.stringify(updates.config));
    }
    if (updates.enabled !== undefined) {
        sets.push('enabled = ?');
        vals.push(updates.enabled ? 1 : 0);
    }
    if (sets.length > 0) {
        vals.push(id);
        (0, db_1.getDb)().prepare(`UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    unscheduleTask(id);
    const updated = getTaskById(id);
    if (updated?.enabled)
        scheduleTask(id);
}
function deleteTask(id) {
    unscheduleTask(id);
    (0, db_1.getDb)().prepare('DELETE FROM scheduled_tasks WHERE id = ?').run(id);
}
function getTaskHistory(taskId, limit = 20) {
    return (0, db_1.getDb)()
        .prepare('SELECT * FROM task_executions WHERE task_id = ? ORDER BY started_at DESC LIMIT ?')
        .all(taskId, limit);
}
async function runTaskNow(id) {
    const task = getTaskById(id);
    if (!task)
        throw Object.assign(new Error('Task not found'), { statusCode: 404 });
    return executeTask(task);
}
async function executeTask(task) {
    const execResult = (0, db_1.getDb)()
        .prepare('INSERT INTO task_executions (task_id, status) VALUES (?, ?)')
        .run(task.id, 'running');
    const execId = execResult.lastInsertRowid;
    try {
        const config = task.config ? JSON.parse(task.config) : {};
        let detail = '';
        switch (task.type) {
            case 'quota_report':
                detail = 'Quota report generated';
                break;
            case 'kv_cleanup':
                detail = `KV cleanup: namespace=${config.namespaceId || 'N/A'}`;
                break;
            case 'd1_backup':
                detail = `D1 backup: database=${config.databaseId || 'N/A'}`;
                break;
            case 'r2_cleanup':
                detail = `R2 cleanup: bucket=${config.bucket || 'N/A'}, maxAgeDays=${config.maxAgeDays || 30}`;
                break;
            default:
                detail = `Custom task: ${task.type}`;
        }
        (0, db_1.getDb)().prepare('UPDATE task_executions SET status = ?, detail = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run('success', detail, execId);
        return (0, db_1.getDb)().prepare('SELECT * FROM task_executions WHERE id = ?').get(execId);
    }
    catch (err) {
        (0, db_1.getDb)().prepare('UPDATE task_executions SET status = ?, detail = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run('error', err.message, execId);
        return (0, db_1.getDb)().prepare('SELECT * FROM task_executions WHERE id = ?').get(execId);
    }
}
function scheduleTask(id) {
    const task = getTaskById(id);
    if (!task || !task.enabled)
        return;
    const job = cron.schedule(task.cron, () => {
        executeTask(task).catch(err => logger_1.appLogger.error(`[Task ${task.id}] Execution failed: ${err}`));
    });
    activeJobs.set(id, job);
}
function unscheduleTask(id) {
    const job = activeJobs.get(id);
    if (job) {
        job.stop();
        activeJobs.delete(id);
    }
}
function initScheduler() {
    const tasks = getAllTasks();
    for (const task of tasks) {
        if (task.enabled) {
            scheduleTask(task.id);
        }
    }
    logger_1.appLogger.info(`[Scheduler] Initialized ${tasks.filter(t => t.enabled).length} active tasks`);
}
//# sourceMappingURL=taskScheduler.js.map