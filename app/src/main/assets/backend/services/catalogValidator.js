"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCatalog = validateCatalog;
exports.validateTemplate = validateTemplate;
// 校验器由 scripts/gen-catalog-validator.js 在构建期用 ajv standalone 预编译生成
// （catalogValidate.generated.ts），运行时不再调用 new Function，以兼容 Cloudflare
// Workers / Pages（其运行时禁止动态代码生成）。请勿在此处直接 ajv.compile。
const catalogValidate_generated_1 = __importDefault(require("./catalogValidate.generated"));
function label(e) {
    if (e.keyword === 'required') {
        const missing = e.params.missingProperty;
        return `${e.instancePath}/${missing}`;
    }
    return e.instancePath || '/';
}
function humanize(e) {
    // 跳过 ajv 在 if/then 不满足时附加的笼统包装错误（如 `must match "then" schema`），
    // 具体原因已由 ajv-errors 的 errorMessage 提供。注意：pattern 失败信息也是
    // "must match pattern ..."，不能误删，所以只过滤 then/if schema 包装。
    if (typeof e.message === 'string' && /^must match "(then|if)" schema$/.test(e.message)) {
        return '';
    }
    const at = label(e);
    switch (e.keyword) {
        case 'required':
            return `${at}: 缺少必填字段`;
        case 'enum':
            return `${at}: 值必须是 ${e.params.allowedValues?.join(', ')} 之一`;
        case 'pattern':
            return `${at}: 格式不正确`;
        case 'format':
            return `${at}: 必须是合法的 ${e.params.format}`;
        case 'type':
            return `${at}: 类型应为 ${e.params.type}`;
        case 'additionalProperties':
            return `${at}: 包含未知字段 "${e.params.additionalProperty}"`;
        case 'errorMessage':
            return `${at}: ${e.message}`;
        default:
            return `${at}: ${e.message}`;
    }
}
function validateCatalog(raw) {
    const errors = [];
    const ok = (0, catalogValidate_generated_1.default)(raw);
    if (!ok) {
        for (const e of catalogValidate_generated_1.default.errors || []) {
            const msg = humanize(e);
            if (msg)
                errors.push(msg);
        }
    }
    // 跨字段检查：JSON Schema 不易表达的唯一性 / 冲突规则
    if (raw && typeof raw === 'object' && Array.isArray(raw.templates)) {
        const ids = new Set();
        const templates = raw.templates;
        for (let i = 0; i < templates.length; i++) {
            const t = templates[i];
            if (!t || typeof t !== 'object')
                continue;
            if (Array.isArray(t.bindings)) {
                const names = new Set();
                for (let j = 0; j < t.bindings.length; j++) {
                    const b = t.bindings[j];
                    if (b && b.name) {
                        if (names.has(b.name)) {
                            errors.push(`Template[${i}].bindings[${j}]: duplicate binding name "${b.name}"`);
                        }
                        names.add(b.name);
                    }
                }
                if (t.env && typeof t.env === 'object') {
                    for (const key of Object.keys(t.env)) {
                        if (names.has(key)) {
                            errors.push(`Template[${i}]: env key "${key}" conflicts with binding name`);
                        }
                    }
                }
            }
            if (t.id) {
                if (ids.has(t.id)) {
                    errors.push(`Template[${i}]: duplicate id "${t.id}"`);
                }
                ids.add(t.id);
            }
        }
    }
    return { valid: errors.length === 0, errors };
}
function validateTemplate(raw) {
    const res = validateCatalog({ version: '0.0.0', templates: [raw] });
    const errors = res.errors.map(e => e.replace(/^\/templates\/0/, '') || e);
    return { valid: res.valid, errors };
}
//# sourceMappingURL=catalogValidator.js.map