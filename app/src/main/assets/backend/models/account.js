"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_FEATURES = void 0;
exports.hasFeature = hasFeature;
exports.getActiveAccountsByFeature = getActiveAccountsByFeature;
exports.getAllAccounts = getAllAccounts;
exports.listAccountsPaged = listAccountsPaged;
exports.getActiveAccounts = getActiveAccounts;
exports.getAccountById = getAccountById;
exports.createAccount = createAccount;
exports.updateAccount = updateAccount;
exports.updateAccountFeatures = updateAccountFeatures;
exports.deleteAccount = deleteAccount;
exports.updateAccountStatus = updateAccountStatus;
exports.updateAccountId = updateAccountId;
exports.getAccountByEmail = getAccountByEmail;
exports.nameFromEmail = nameFromEmail;
const db_1 = require("../db");
exports.ALL_FEATURES = ['ai', 'workers', 'browser_render', 'dns', 'storage'];
function hasFeature(account, feature) {
    const features = (account.enabled_features || exports.ALL_FEATURES.join(',')).split(',');
    return features.includes(feature);
}
function getActiveAccountsByFeature(feature) {
    return getActiveAccounts().filter(a => hasFeature(a, feature));
}
function getAllAccounts() {
    return (0, db_1.getDb)().prepare('SELECT * FROM accounts ORDER BY created_at DESC').all();
}
/**
 * 分页查询账户，支持按 active/unverified 筛选 + 按名称/邮箱模糊搜索
 */
function listAccountsPaged(opts) {
    const page = Math.max(1, opts.page || 1);
    const pageSize = Math.max(1, Math.min(500, opts.pageSize || 20));
    const filter = opts.filter || 'all';
    const search = (opts.search || '').trim();
    const where = [];
    const params = [];
    if (filter === 'active') {
        where.push('is_active = 1');
    }
    else if (filter === 'unverified') {
        where.push('is_active = 0');
    }
    if (search) {
        where.push('(name LIKE ? OR email LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
    }
    const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
    const total = (0, db_1.getDb)().prepare(`SELECT COUNT(*) as c FROM accounts ${whereSql}`).get(...params).c;
    const offset = (page - 1) * pageSize;
    const accounts = (0, db_1.getDb)()
        .prepare(`SELECT * FROM accounts ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
        .all(...params, pageSize, offset);
    // 三种状态的计数（不受 filter/search 影响，用于 tab 显示）
    const counts = {
        all: (0, db_1.getDb)().prepare('SELECT COUNT(*) as c FROM accounts').get().c,
        active: (0, db_1.getDb)().prepare('SELECT COUNT(*) as c FROM accounts WHERE is_active = 1').get().c,
        unverified: (0, db_1.getDb)().prepare('SELECT COUNT(*) as c FROM accounts WHERE is_active = 0').get().c,
    };
    return { accounts, total, counts };
}
function getActiveAccounts() {
    return (0, db_1.getDb)().prepare('SELECT * FROM accounts WHERE is_active = 1 ORDER BY created_at DESC').all();
}
function getAccountById(id) {
    return (0, db_1.getDb)().prepare('SELECT * FROM accounts WHERE id = ?').get(id);
}
function createAccount(input) {
    const features = input.enabled_features || exports.ALL_FEATURES.join(',');
    const stmt = (0, db_1.getDb)().prepare('INSERT INTO accounts (name, auth_type, api_token, api_key, email, account_id, enabled_features, password, proxy_url, proxy_enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const result = stmt.run(input.name, input.auth_type, input.api_token || null, input.api_key || null, input.email || null, input.account_id || null, features, input.password || null, input.proxy_url || '', input.proxy_enabled ?? 0);
    return result.lastInsertRowid;
}
function updateAccount(id, input) {
    const sets = [];
    const vals = [];
    const fieldMap = {
        name: 'name',
        auth_type: 'auth_type',
        api_token: 'api_token',
        api_key: 'api_key',
        email: 'email',
        account_id: 'account_id',
        available_features: 'available_features',
        proxy_url: 'proxy_url',
        proxy_enabled: 'proxy_enabled',
    };
    for (const [key, val] of Object.entries(input)) {
        if (val !== undefined && fieldMap[key]) {
            sets.push(`${fieldMap[key]} = ?`);
            vals.push(val);
        }
    }
    if (sets.length === 0)
        return;
    sets.push('updated_at = CURRENT_TIMESTAMP');
    vals.push(id);
    (0, db_1.getDb)().prepare(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}
function updateAccountFeatures(id, features) {
    (0, db_1.getDb)().prepare('UPDATE accounts SET enabled_features = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(features, id);
}
function deleteAccount(id) {
    (0, db_1.getDb)().prepare('DELETE FROM accounts WHERE id = ?').run(id);
}
function updateAccountStatus(id, isActive) {
    (0, db_1.getDb)().prepare('UPDATE accounts SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(isActive ? 1 : 0, id);
}
function updateAccountId(id, accountId) {
    (0, db_1.getDb)().prepare('UPDATE accounts SET account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(accountId, id);
}
function getAccountByEmail(email) {
    return (0, db_1.getDb)().prepare('SELECT * FROM accounts WHERE email = ?').get(email);
}
/**
 * 从邮箱中提取账户名：
 * - lauren.bailey2701@maildrop.cc -> bailey2701
 * - laurenbailey2701@maildrop.cc -> laurenbailey2701
 * - lauren.b.bailey2701@maildrop.cc -> bailey2701 (取最后一段)
 */
function nameFromEmail(email) {
    const localPart = (email.split('@')[0] || '').trim().toLowerCase();
    if (!localPart)
        return '';
    const parts = localPart.split('.');
    if (parts.length <= 1) {
        // 没有点：直接用完整本地部分
        return localPart;
    }
    // 有点：取最后一段（去掉中间名缩写等）
    return parts[parts.length - 1];
}
//# sourceMappingURL=account.js.map