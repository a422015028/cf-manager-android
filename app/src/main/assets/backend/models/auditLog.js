"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAuditLog = createAuditLog;
exports.getRecentLogs = getRecentLogs;
exports.queryLogs = queryLogs;
exports.getDistinctActions = getDistinctActions;
const db_1 = require("../db");
function createAuditLog(accountId, action, target, detail, status) {
    (0, db_1.getDb)()
        .prepare('INSERT INTO audit_log (account_id, action, target, detail, status) VALUES (?, ?, ?, ?, ?)')
        .run(accountId, action, target, detail, status);
}
function getRecentLogs(limit = 20) {
    return (0, db_1.getDb)()
        .prepare(`SELECT a.*, acc.name AS account_name
       FROM audit_log a
       LEFT JOIN accounts acc ON a.account_id = acc.id
       ORDER BY a.created_at DESC LIMIT ?`)
        .all(limit);
}
function queryLogs(filter = {}) {
    const conditions = [];
    const params = [];
    if (filter.action) {
        conditions.push('a.action = ?');
        params.push(filter.action);
    }
    if (filter.startDate) {
        conditions.push('date(a.created_at) >= ?');
        params.push(filter.startDate);
    }
    if (filter.endDate) {
        conditions.push('date(a.created_at) <= ?');
        params.push(filter.endDate);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 100;
    return (0, db_1.getDb)()
        .prepare(`SELECT a.*, acc.name AS account_name
       FROM audit_log a
       LEFT JOIN accounts acc ON a.account_id = acc.id
       ${where}
       ORDER BY a.created_at DESC LIMIT ?`)
        .all(...params, limit);
}
function getDistinctActions() {
    return (0, db_1.getDb)()
        .prepare('SELECT DISTINCT action FROM audit_log ORDER BY action')
        .all()
        .map((r) => r.action);
}
//# sourceMappingURL=auditLog.js.map