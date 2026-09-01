import { Account } from '../models/account';
export interface GenericRuleInput {
    description?: string;
    expression: string;
    action: string;
    action_parameters: any;
    enabled?: boolean;
}
/** 列出指定 phase 的所有规则 */
export declare function listRules(account: Account, zoneId: string, phase: string): Promise<any[]>;
/** 创建规则 */
export declare function createRule(account: Account, zoneId: string, phase: string, input: GenericRuleInput): Promise<any>;
/** 更新规则 */
export declare function updateRule(account: Account, zoneId: string, phase: string, ruleId: string, input: GenericRuleInput): Promise<any>;
/** 删除规则 */
export declare function deleteRule(account: Account, zoneId: string, phase: string, ruleId: string): Promise<any>;
//# sourceMappingURL=rulesetService.d.ts.map