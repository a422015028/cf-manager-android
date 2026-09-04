"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKvNamespace = createKvNamespace;
exports.deleteKvNamespace = deleteKvNamespace;
exports.listKvKeys = listKvKeys;
exports.getKvValue = getKvValue;
exports.putKvValue = putKvValue;
exports.deleteKvKey = deleteKvKey;
exports.bulkDeleteKvKeys = bulkDeleteKvKeys;
exports.listD1Tables = listD1Tables;
exports.getD1TableSchema = getD1TableSchema;
exports.executeD1Query = executeD1Query;
exports.createD1Database = createD1Database;
exports.deleteD1Database = deleteD1Database;
exports.createR2Bucket = createR2Bucket;
exports.deleteR2Bucket = deleteR2Bucket;
exports.listR2Objects = listR2Objects;
exports.getR2Object = getR2Object;
exports.putR2Object = putR2Object;
exports.deleteR2Object = deleteR2Object;
exports.bulkDeleteR2Objects = bulkDeleteR2Objects;
const cfFactory_1 = require("./cfFactory");
const acctId = (a) => a.account_id;
// ============ KV ============
async function createKvNamespace(account, title) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return cf.kv.namespaces.create({ account_id: acctId(account), title });
}
async function deleteKvNamespace(account, namespaceId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.kv.namespaces.delete(namespaceId, { account_id: acctId(account) });
}
async function listKvKeys(account, namespaceId, options) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const page = await cf.kv.namespaces.keys.list(namespaceId, {
        account_id: acctId(account),
        prefix: options?.prefix,
        limit: options?.limit,
        cursor: options?.cursor,
    });
    return {
        keys: page.result ?? [],
        cursor: page.result_info?.cursor || undefined,
    };
}
async function getKvValue(account, namespaceId, key) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const [valueResp, metaResult] = await Promise.all([
        cf.kv.namespaces.values.get(namespaceId, key, { account_id: acctId(account) }),
        cf.kv.namespaces.metadata.get(namespaceId, key, { account_id: acctId(account) }).catch(() => null),
    ]);
    const value = await valueResp.text();
    return { value, metadata: metaResult };
}
async function putKvValue(account, namespaceId, key, value, options) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.kv.namespaces.values.update(namespaceId, key, {
        account_id: acctId(account),
        value,
        expiration: options?.expiration,
        expiration_ttl: options?.expiration_ttl,
        metadata: options?.metadata,
    });
}
async function deleteKvKey(account, namespaceId, key) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.kv.namespaces.values.delete(namespaceId, key, { account_id: acctId(account) });
}
async function bulkDeleteKvKeys(account, namespaceId, keys) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.kv.namespaces.bulkDelete(namespaceId, { account_id: acctId(account), body: keys });
}
// ============ D1 ============
async function d1Query(account, databaseId, sql) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const page = await cf.d1.database.query(databaseId, { account_id: acctId(account), sql });
    const items = page.getPaginatedItems();
    return items[0] ?? { results: [], meta: {} };
}
async function listD1Tables(account, databaseId) {
    const qr = await d1Query(account, databaseId, "SELECT name, type FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name");
    return qr.results ?? [];
}
async function getD1TableSchema(account, databaseId, tableName) {
    const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '');
    const qr = await d1Query(account, databaseId, `PRAGMA table_info(${safeName})`);
    return qr.results ?? [];
}
async function executeD1Query(account, databaseId, sql) {
    return d1Query(account, databaseId, sql);
}
async function createD1Database(account, name) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return cf.d1.database.create({ account_id: acctId(account), name });
}
async function deleteD1Database(account, databaseId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.d1.database.delete(databaseId, { account_id: acctId(account) });
}
// ============ R2 ============
async function createR2Bucket(account, name) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return cf.r2.buckets.create({ account_id: acctId(account), name });
}
async function deleteR2Bucket(account, name) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.r2.buckets.delete(name, { account_id: acctId(account) });
}
async function listR2Objects(account, bucketName, options) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const page = await cf.r2.buckets.objects.list(bucketName, {
        account_id: acctId(account),
        prefix: options?.prefix,
        delimiter: options?.delimiter,
        cursor: options?.cursor,
        per_page: options?.limit,
    });
    const info = page.result_info;
    return {
        objects: page.result ?? [],
        delimited_prefixes: info?.delimited ?? [],
        cursor: info?.cursor || undefined,
    };
}
async function getR2Object(account, bucketName, key) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    return cf.r2.buckets.objects.get(bucketName, key, { account_id: acctId(account) });
}
async function putR2Object(account, bucketName, key, body, _contentType) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.r2.buckets.objects.upload(bucketName, key, body, { account_id: acctId(account) });
}
async function deleteR2Object(account, bucketName, key) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    await cf.r2.buckets.objects.delete(bucketName, key, { account_id: acctId(account) });
}
async function bulkDeleteR2Objects(account, bucketName, keys) {
    const BATCH_SIZE = 10;
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const batch = keys.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(key => deleteR2Object(account, bucketName, key)));
    }
}
//# sourceMappingURL=storageService.js.map