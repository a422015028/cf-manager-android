import { Account } from '../models/account';
/**
 * 探测账户可用的付费功能（首期仅 R2）。
 * 返回逗号分隔字符串：r2=支持，-r2=不支持，空串=未探测。
 */
export declare function probeAvailableFeatures(account: Account): Promise<string>;
//# sourceMappingURL=accountProbe.d.ts.map