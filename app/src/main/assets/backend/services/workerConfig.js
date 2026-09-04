"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getWorkerConfig = getWorkerConfig;
exports.getPagesConfig = getPagesConfig;
exports.applyWorkerConfigDiff = applyWorkerConfigDiff;
const cfFactory_1 = require("./cfFactory");
const proxyService_1 = require("./proxyService");
const workerService_1 = require("./workerService");
const CF_BASE = 'https://api.cloudflare.com/client/v4';
async function getWorkerConfig(account, name) {
    const authHeaders = (0, cfFactory_1.getAuthHeaders)(account);
    const resp = await (0, proxyService_1.proxyFetch)(`${CF_BASE}/accounts/${account.account_id}/workers/scripts/${name}`, { headers: authHeaders }, 30000, undefined, account);
    const buf = Buffer.from(await resp.arrayBuffer());
    const contentType = (resp.headers.get('content-type') || '');
    const vars = [];
    const bindings = [];
    const mapBinding = (b) => {
        if (b.type === 'plain_text')
            vars.push({ name: b.name, value: b.text ?? '', secret: false });
        else if (b.type === 'secret_text')
            vars.push({ name: b.name, value: null, secret: true });
        else {
            // 归一化为前端意图类型，并保留高级绑定的参数字段供重部署预填回填
            const intentType = b.type === 'durable_object_namespace' ? 'durable_object' :
                b.type === 'kv_namespace' ? 'kv' :
                    b.type === 'r2_bucket' ? 'r2' : b.type;
            bindings.push({
                type: intentType, name: b.name, mode: 'existing',
                resourceName: b.namespace_id || b.id || b.bucket_name || undefined,
                ...(intentType === 'durable_object' ? { className: b.class_name, scriptName: b.script_name } : {}),
                ...(intentType === 'service' ? { service: b.service, environment: b.environment } : {}),
                ...(intentType === 'queue' ? { queueName: b.queue_name } : {}),
            });
        }
    };
    // 1) multipart metadata part（非版本化 worker 的 GET /scripts/:name 返回 bindings）
    if (/multipart\/form-data/i.test(contentType)) {
        const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
        const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
        if (boundary) {
            const delim = Buffer.from(`--${boundary}`);
            const findIndex = (hay, needle, from = 0) => {
                outer: for (let i = from; i <= hay.length - needle.length; i++) {
                    for (let j = 0; j < needle.length; j++)
                        if (hay[i + j] !== needle[j])
                            continue outer;
                    return i;
                }
                return -1;
            };
            let pos = findIndex(buf, delim);
            while (pos >= 0 && pos < buf.length) {
                const next = findIndex(buf, delim, pos + delim.length);
                const seg = next < 0 ? buf.subarray(pos + delim.length) : buf.subarray(pos + delim.length, next);
                if (seg.length > 0) {
                    const headerEnd = findIndex(seg, Buffer.from('\r\n\r\n'));
                    if (headerEnd >= 0 && /name="metadata"/i.test(seg.subarray(0, headerEnd).toString())) {
                        let body = seg.subarray(headerEnd + 4);
                        if (body.length >= 2 && body[body.length - 2] === 0x0d && body[body.length - 1] === 0x0a)
                            body = body.subarray(0, body.length - 2);
                        try {
                            const meta = JSON.parse(body.toString());
                            for (const b of (meta.bindings || []))
                                mapBinding(b);
                        }
                        catch { /* metadata 解析失败忽略，走版本化 fallback */ }
                    }
                }
                if (next < 0)
                    break;
                pos = next;
            }
        }
    }
    // 2) 版本化 fallback：版本化 worker 的 GET /scripts/:name 不返回 bindings，
    //    必须查 Versions API（当前部署版本的 resources.bindings）
    if (vars.length === 0 && bindings.length === 0) {
        try {
            const cf = (0, cfFactory_1.getCfClient)(account);
            const deps = await cf.workers.scripts.deployments.list(name, { account_id: account.account_id });
            const latest = (deps?.deployments || deps?.result?.deployments || [])[0];
            const vid = latest?.versions?.[0]?.version_id;
            if (vid) {
                const v = await cf.workers.scripts.versions.get(name, vid, { account_id: account.account_id });
                const raw = (v?.resources?.bindings || v?.result?.resources?.bindings || []);
                for (const b of raw)
                    mapBinding(b);
            }
        }
        catch { /* 读回失败静默，前端有降级提示 */ }
    }
    return { vars, bindings };
}
async function getPagesConfig(account, name) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const project = await cf.pages.projects.get(name, { account_id: account.account_id });
    const cfg = project?.deployment_configs?.production || {};
    const vars = [];
    const bindings = [];
    for (const [k, v] of Object.entries(cfg.env_vars || {})) {
        const isSecret = v?.type === 'secret_text';
        vars.push({ name: k, value: isSecret ? null : (v?.value ?? ''), secret: isSecret });
    }
    for (const [name, v] of Object.entries(cfg.kv_namespaces || {}))
        bindings.push({ type: 'kv', name, resourceName: v?.namespace_id, mode: 'existing' });
    for (const [name, v] of Object.entries(cfg.d1_databases || {}))
        bindings.push({ type: 'd1', name, resourceName: v?.id, mode: 'existing' });
    for (const [name, v] of Object.entries(cfg.r2_buckets || {}))
        bindings.push({ type: 'r2', name, resourceName: v?.name, mode: 'existing' });
    if (cfg.ai?.binding)
        bindings.push({ type: 'ai', name: cfg.ai.binding, mode: 'existing' });
    return { vars, bindings };
}
// 全量覆盖 + diff：
// - plain/资源绑定有变化 → 用 scriptContent（或拉取现有代码）重传 deployWorker
// - 仅 secrets 变化 → 只调 updateSecret/deleteSecret，不重传代码
async function applyWorkerConfigDiff(account, name, opts) {
    const current = await getWorkerConfig(account, name);
    const currentPlain = new Map(current.vars.filter(v => !v.secret).map(v => [v.name, v.value || '']));
    const currentSecretNames = new Set(current.vars.filter(v => v.secret).map(v => v.name));
    const targetPlain = new Map((opts.vars || []).filter(v => !v.secret && !v.keep).map(v => [v.name, v.value || '']));
    const targetSecretNames = new Set((opts.vars || []).filter(v => v.secret).map(v => v.name));
    const plainChanged = targetPlain.size !== currentPlain.size
        || [...targetPlain.entries()].some(([k, val]) => currentPlain.get(k) !== val);
    // 指纹只比较（类型:名称）集合——current.bindings 不含资源 id，opts.bindings 含 id，比较语义集合即可
    // secret 由 secrets API 独立管理：剔除 secret_text，避免新增/修改 secret 误触发代码重传
    // 写入侧为 CF 原始类型（kv_namespace 等），比较前统一归一化为前端意图类型（与读取侧 getWorkerConfig 一致）
    const toIntentType = (type) => type === 'durable_object_namespace' ? 'durable_object' :
        type === 'kv_namespace' ? 'kv' :
            type === 'r2_bucket' ? 'r2' : type;
    const bindingFingerprint = (arr) => JSON.stringify((arr || []).filter((b) => b.type !== 'secret_text').map((b) => `${toIntentType(b.type)}:${b.name}`).sort());
    const bindingsChanged = bindingFingerprint(opts.bindings) !== bindingFingerprint(current.bindings);
    console.log(`[DBG] applyWorkerConfigDiff name=${name} vars=${JSON.stringify((opts.vars || []).map((v) => `${v.name}:${v.secret ? 'S' : 'P'}${v.keep ? '(keep)' : ''}`))} plainChanged=${plainChanged} bindingsChanged=${bindingsChanged}`);
    // 删除：现有 secret 不在目标集合
    for (const s of currentSecretNames) {
        if (!targetSecretNames.has(s)) {
            try {
                await (0, workerService_1.deleteSecret)(account, name, s);
            }
            catch { /* 删除失败不阻塞 */ }
        }
    }
    if (plainChanged || bindingsChanged) {
        let content;
        if (opts.scriptContent !== undefined && opts.scriptContent !== null)
            content = opts.scriptContent;
        else if (opts.packageZip)
            content = '';
        else
            content = await (0, workerService_1.getScriptContent)(account, name); // 复用现有代码
        console.log(`[DBG] redeploy content type=${typeof content} length=${Buffer.isBuffer(content) ? content.length : content.length}`);
        await (0, workerService_1.deployWorker)(account, name, content, {
            bindings: opts.bindings,
            // 版本化 worker 下 PUT 只创建版本不部署，必须显式创建 deployment 才会上线（否则重部署的 vars/bindings 不生效）
            createDeployment: true,
            ...(opts.packageZip ? { packageZip: opts.packageZip, mainModule: opts.mainModule } : {}),
        });
        const after = await getWorkerConfig(account, name);
        console.log(`[DBG] redeploy after vars=${JSON.stringify(after.vars)} bindings=${JSON.stringify(after.bindings)}`);
    }
    // 新增/更新 secrets（keep=true 或值为空则跳过）
    for (const v of opts.vars || []) {
        if (!v.secret || !v.name || v.keep)
            continue;
        if (v.value)
            await (0, workerService_1.updateSecret)(account, name, v.name, 'secret_text', v.value);
    }
}
//# sourceMappingURL=workerConfig.js.map