"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCatalogSources = getCatalogSources;
exports.getEnabledCatalogSources = getEnabledCatalogSources;
exports.getCatalogSourceById = getCatalogSourceById;
exports.getDefaultCatalogSource = getDefaultCatalogSource;
exports.createCatalogSource = createCatalogSource;
exports.updateCatalogSource = updateCatalogSource;
exports.deleteCatalogSource = deleteCatalogSource;
exports.ensureDefaultCatalogSource = ensureDefaultCatalogSource;
const db_1 = require("../db");
function getCatalogSources() {
    return (0, db_1.getDb)().prepare('SELECT * FROM catalog_sources ORDER BY is_default DESC, id ASC').all();
}
function getEnabledCatalogSources() {
    return (0, db_1.getDb)().prepare('SELECT * FROM catalog_sources WHERE enabled = 1 ORDER BY is_default DESC, id ASC').all();
}
function getCatalogSourceById(id) {
    return (0, db_1.getDb)().prepare('SELECT * FROM catalog_sources WHERE id = ?').get(id);
}
function getDefaultCatalogSource() {
    return (0, db_1.getDb)().prepare('SELECT * FROM catalog_sources WHERE is_default = 1').get();
}
function createCatalogSource(data) {
    const result = (0, db_1.getDb)().prepare('INSERT INTO catalog_sources (url, name, is_default) VALUES (?, ?, ?)').run(data.url, data.name, data.is_default || 0);
    return Number(result.lastInsertRowid);
}
function updateCatalogSource(id, data) {
    const sets = [];
    const vals = [];
    for (const [key, val] of Object.entries(data)) {
        if (val !== undefined && key !== 'id' && key !== 'created_at') {
            sets.push(`${key} = ?`);
            vals.push(val);
        }
    }
    if (sets.length === 0)
        return;
    vals.push(id);
    (0, db_1.getDb)().prepare(`UPDATE catalog_sources SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}
function deleteCatalogSource(id) {
    (0, db_1.getDb)().prepare('DELETE FROM catalog_sources WHERE id = ? AND is_default = 0').run(id);
}
function ensureDefaultCatalogSource(url, name) {
    const existing = getDefaultCatalogSource();
    if (!existing) {
        (0, db_1.getDb)().prepare('INSERT INTO catalog_sources (url, name, is_default) VALUES (?, ?, 1)').run(url, name);
    }
    else if (existing.url !== url || existing.name !== name) {
        // 代码常量已变更（如迁移到新仓库），同步修正已存在的默认源地址
        updateCatalogSource(existing.id, { url, name });
    }
}
//# sourceMappingURL=catalogSource.js.map