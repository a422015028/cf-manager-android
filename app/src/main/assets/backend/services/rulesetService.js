"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listRules = listRules;
exports.createRule = createRule;
exports.updateRule = updateRule;
exports.deleteRule = deleteRule;
const cfFactory_1 = require("./cfFactory");
// Account 级 Phase（使用 /accounts/{account_id}/rulesets，kind: 'root'）
// 其余 Phase 为 Zone 级（使用 /zones/{zone_id}/rulesets，kind: 'zone'）
const ACCOUNT_LEVEL_PHASES = new Set([
    'http_request_redirect',
    'http_request_dynamic_redirect',
]);
function isAccountLevelPhase(phase) {
    return ACCOUNT_LEVEL_PHASES.has(phase);
}
/** 获取指定 phase 的 ruleset ID，不存在则创建 */
async function getRulesetId(account, zoneId, phase, name) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const accountLevel = isAccountLevelPhase(phase);
    if (accountLevel && !account.account_id) {
        throw new Error('该规则类型为账户级，但当前账户未设置 Cloudflare Account ID');
    }
    const scope = accountLevel ? { account_id: account.account_id } : { zone_id: zoneId };
    const list = [];
    for await (const r of cf.rulesets.list(scope)) {
        list.push(r);
    }
    const existing = list.find((r) => r.phase === phase);
    if (existing)
        return existing.id;
    const created = await cf.rulesets.create({
        ...scope,
        kind: accountLevel ? 'root' : 'zone',
        phase,
        name,
        rules: [],
    });
    return created.id;
}
/** 列出指定 phase 的所有规则 */
async function listRules(account, zoneId, phase) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const accountLevel = isAccountLevelPhase(phase);
    const scope = accountLevel ? { account_id: account.account_id } : { zone_id: zoneId };
    const rsId = await getRulesetId(account, zoneId, phase, `${phase} rules`);
    const rs = await cf.rulesets.get(rsId, scope);
    return rs.rules ?? [];
}
/** 创建规则 */
async function createRule(account, zoneId, phase, input) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const accountLevel = isAccountLevelPhase(phase);
    const scope = accountLevel ? { account_id: account.account_id } : { zone_id: zoneId };
    const rsId = await getRulesetId(account, zoneId, phase, `${phase} rules`);
    return await cf.rulesets.rules.create(rsId, {
        ...scope,
        description: input.description,
        expression: input.expression,
        action: input.action,
        action_parameters: input.action_parameters,
        enabled: input.enabled ?? true,
    });
}
/** 更新规则 */
async function updateRule(account, zoneId, phase, ruleId, input) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const accountLevel = isAccountLevelPhase(phase);
    const scope = accountLevel ? { account_id: account.account_id } : { zone_id: zoneId };
    const rsId = await getRulesetId(account, zoneId, phase, `${phase} rules`);
    return await cf.rulesets.rules.edit(rsId, ruleId, {
        ...scope,
        description: input.description,
        expression: input.expression,
        action: input.action,
        action_parameters: input.action_parameters,
        enabled: input.enabled ?? true,
    });
}
/** 删除规则 */
async function deleteRule(account, zoneId, phase, ruleId) {
    const cf = (0, cfFactory_1.getCfClient)(account);
    const accountLevel = isAccountLevelPhase(phase);
    const scope = accountLevel ? { account_id: account.account_id } : { zone_id: zoneId };
    const rsId = await getRulesetId(account, zoneId, phase, `${phase} rules`);
    return await cf.rulesets.rules.delete(rsId, ruleId, scope);
}
//# sourceMappingURL=rulesetService.js.map