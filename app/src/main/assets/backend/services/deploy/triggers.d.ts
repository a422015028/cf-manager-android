import { Account } from '../../models/account';
/**
 * 部署触发器 — Cron Schedules + Custom Routes。
 * 所有操作均为软失败（失败仅记录 warning，不中断部署）。
 */
export declare function deployTriggers(account: Account, scriptName: string, crons: string[], routes: string[]): Promise<{
    warnings: string[];
}>;
//# sourceMappingURL=triggers.d.ts.map