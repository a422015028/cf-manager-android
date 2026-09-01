"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQuotaByAccount = getQuotaByAccount;
exports.incrementQuota = incrementQuota;
exports.setQuota = setQuota;
exports.getAllQuotaToday = getAllQuotaToday;
exports.setExhausted = setExhausted;
exports.clearExhausted = clearExhausted;
exports.getQuotaTodayByResource = getQuotaTodayByResource;
const db_1 = require("../db");
function getQuotaByAccount(accountId, resource, date) {
    return (0, db_1.getDb)()
        .prepare('SELECT * FROM quota_usage WHERE account_id = ? AND resource = ? AND date = ?')
        .get(accountId, resource, date);
}
function incrementQuota(accountId, resource, amount) {
    const today = new Date().toISOString().split('T')[0];
    (0, db_1.getDb)()
        .prepare(`INSERT INTO quota_usage (account_id, resource, date, count) VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, resource, date) DO UPDATE SET count = count + ?`)
        .run(accountId, resource, today, amount, amount);
}
function setQuota(accountId, resource, count) {
    const today = new Date().toISOString().split('T')[0];
    (0, db_1.getDb)()
        .prepare(`INSERT INTO quota_usage (account_id, resource, date, count) VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, resource, date) DO UPDATE SET count = ?`)
        .run(accountId, resource, today, count, count);
}
function getAllQuotaToday() {
    const today = new Date().toISOString().split('T')[0];
    return (0, db_1.getDb)().prepare('SELECT * FROM quota_usage WHERE date = ?').all(today);
}
function setExhausted(accountId, resource) {
    const today = new Date().toISOString().split('T')[0];
    (0, db_1.getDb)()
        .prepare(`INSERT INTO quota_usage (account_id, resource, date, count, exhausted) VALUES (?, ?, ?, 0, 1)
              ON CONFLICT(account_id, resource, date) DO UPDATE SET exhausted = 1`)
        .run(accountId, resource, today);
}
function clearExhausted(accountId, resource) {
    const today = new Date().toISOString().split('T')[0];
    (0, db_1.getDb)()
        .prepare(`UPDATE quota_usage SET exhausted = 0 WHERE account_id = ? AND resource = ? AND date = ?`)
        .run(accountId, resource, today);
}
function getQuotaTodayByResource(resource) {
    const today = new Date().toISOString().split('T')[0];
    return (0, db_1.getDb)()
        .prepare('SELECT * FROM quota_usage WHERE resource = ? AND date = ?')
        .all(resource, today);
}
//# sourceMappingURL=quotaUsage.js.map