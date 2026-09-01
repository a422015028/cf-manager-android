"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidBindingName = isValidBindingName;
exports.varsToBindings = varsToBindings;
exports.resolveManualBindings = resolveManualBindings;
exports.buildPagesConfigsFromInput = buildPagesConfigsFromInput;
const cfFactory_1 = require("./cfFactory");
// 校验绑定名：CF binding name 必须以字母开头，仅含 A-Z0-9_，全大写惯例
function isValidBindingName(name) {
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(name);
}
function varsToBindings(vars) {
    const out = [];
    for (const v of vars || []) {
        if (!v.name || !isValidBindingName(v.name))
            continue;
        // keep 的 secret：值不可读（CF 不回显），留空保持原值——不生成 binding，
        // 由 applyWorkerConfigDiff 的 secrets API 保持，避免空值覆盖现有 secret
        if (v.secret && v.keep)
            continue;
        out.push(v.secret
            ? { type: 'secret_text', name: v.name, text: v.value }
            : { type: 'plain_text', name: v.name, text: v.value });
    }
    return out;
}
// 复用 deploy/index.ts 的按名解析模式：查重 → 复用 / 创建（不依赖模板）。
// account 已含 cf account_id 与 API 凭据（getCfClient 内部处理）。
async function resolveManualBindings(account, inputs) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const accountId = account.account_id;
    const out = [];
    for (const b of inputs || []) {
        if (!b.name || !isValidBindingName(b.name))
            throw new Error(`非法绑定名: ${b.name || '(空)'}`);
        switch (b.type) {
            case 'kv': {
                if (b.mode === 'existing') {
                    if (!b.existingId)
                        throw new Error(`KV 绑定 ${b.name} 缺少 existingId`);
                    out.push({ type: 'kv_namespace', name: b.name, namespace_id: b.existingId });
                    break;
                }
                if (!b.resourceName)
                    throw new Error(`KV 绑定 ${b.name} 缺少资源名`);
                const kvItems = [];
                for await (const ns of cf.kv.namespaces.list({ account_id: accountId }))
                    kvItems.push(ns);
                const found = kvItems.find((n) => n.title === b.resourceName);
                const ns = found || (await cf.kv.namespaces.create({ account_id: accountId, title: b.resourceName }));
                out.push({ type: 'kv_namespace', name: b.name, namespace_id: ns.id });
                break;
            }
            case 'd1': {
                if (b.mode === 'existing') {
                    if (!b.existingId)
                        throw new Error(`D1 绑定 ${b.name} 缺少 existingId`);
                    out.push({ type: 'd1', name: b.name, id: b.existingId });
                    break;
                }
                if (!b.resourceName)
                    throw new Error(`D1 绑定 ${b.name} 缺少资源名`);
                const d1Items = [];
                for await (const db of cf.d1.database.list({ account_id: accountId }))
                    d1Items.push(db);
                const found = d1Items.find((d) => d.name === b.resourceName);
                const db = found || (await cf.d1.database.create({ account_id: accountId, name: b.resourceName }));
                out.push({ type: 'd1', name: b.name, id: db.uuid });
                break;
            }
            case 'r2': {
                if (b.mode === 'existing') {
                    if (!b.existingId)
                        throw new Error(`R2 绑定 ${b.name} 缺少 existingId`);
                    out.push({ type: 'r2_bucket', name: b.name, bucket_name: b.existingId });
                    break;
                }
                if (!b.resourceName)
                    throw new Error(`R2 绑定 ${b.name} 缺少资源名`);
                const r2Resp = await cf.r2.buckets.list({ account_id: accountId });
                const found = (r2Resp?.buckets || []).find((bk) => bk.name === b.resourceName);
                const bucket = found || (await cf.r2.buckets.create({ account_id: accountId, name: b.resourceName }));
                out.push({ type: 'r2_bucket', name: b.name, bucket_name: bucket.name });
                break;
            }
            case 'ai':
                out.push({ type: 'ai', name: b.name });
                break;
            case 'durable_object':
                if (!b.className)
                    throw new Error(`DO 绑定 ${b.name} 缺少类名`);
                out.push({ type: 'durable_object_namespace', name: b.name, class_name: b.className, script_name: b.scriptName || undefined });
                break;
            case 'service':
                if (!b.service)
                    throw new Error(`Service 绑定 ${b.name} 缺少目标服务名`);
                out.push({ type: 'service', name: b.name, service: b.service, environment: b.environment || 'production' });
                break;
            case 'queue':
                if (!b.queueName)
                    throw new Error(`Queue 绑定 ${b.name} 缺少队列名`);
                out.push({ type: 'queue', name: b.name, queue_name: b.queueName });
                break;
        }
    }
    return out;
}
// 对齐 deploy/index.ts buildPagesDeploymentConfigs 的字段格式（wrangler 源码确认）：
// kv_namespaces/d1_databases/r2_buckets 是对象 map，不是数组。
function buildPagesConfigsFromInput(vars, resolved) {
    const prod = { compatibility_date: '2024-11-01' };
    const prev = { compatibility_date: '2024-11-01' };
    for (const v of vars || []) {
        if (!v.name || !isValidBindingName(v.name))
            continue;
        // keep 的 secret：值不可读（CF 不回显），留空保持原值——不写入 env_vars
        if (v.secret && v.keep)
            continue;
        if (!prod.env_vars) {
            prod.env_vars = {};
            prev.env_vars = {};
        }
        prod.env_vars[v.name] = { value: v.value, type: v.secret ? 'secret_text' : 'plain_text' };
        prev.env_vars[v.name] = { value: v.value, type: v.secret ? 'secret_text' : 'plain_text' };
    }
    for (const b of resolved) {
        switch (b.type) {
            case 'kv_namespace': {
                if (!prod.kv_namespaces) {
                    prod.kv_namespaces = {};
                    prev.kv_namespaces = {};
                }
                prod.kv_namespaces[b.name] = { namespace_id: b.namespace_id };
                prev.kv_namespaces[b.name] = { namespace_id: b.namespace_id };
                break;
            }
            case 'd1': {
                if (!prod.d1_databases) {
                    prod.d1_databases = {};
                    prev.d1_databases = {};
                }
                prod.d1_databases[b.name] = { id: b.id };
                prev.d1_databases[b.name] = { id: b.id };
                break;
            }
            case 'r2_bucket': {
                if (!prod.r2_buckets) {
                    prod.r2_buckets = {};
                    prev.r2_buckets = {};
                }
                prod.r2_buckets[b.name] = { name: b.bucket_name };
                prev.r2_buckets[b.name] = { name: b.bucket_name };
                break;
            }
            case 'ai': {
                prod.ai = { binding: b.name };
                prev.ai = { binding: b.name };
                break;
            }
        }
    }
    const hasConfigs = Object.keys(prod).length > 1; // 排除仅 compatibility_date
    return hasConfigs ? { production: prod, preview: prev } : undefined;
}
//# sourceMappingURL=bindings.js.map