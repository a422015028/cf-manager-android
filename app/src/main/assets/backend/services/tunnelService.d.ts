import { Account } from '../models/account';
export interface TunnelAccountItem {
    id: number;
    name: string;
    account_id: string;
}
export declare function listTunnelAccounts(): TunnelAccountItem[];
export declare function getTunnelAccount(id: number): Account;
export declare function listTunnels(account: Account): Promise<any[]>;
export declare function createTunnel(account: Account, name: string): Promise<any>;
export declare function deleteTunnel(account: Account, tunnelId: string): Promise<any>;
export declare function getTunnelToken(account: Account, tunnelId: string): Promise<string>;
export declare function getTunnelConnections(account: Account, tunnelId: string): Promise<any>;
export declare function getTunnelConfig(account: Account, tunnelId: string): Promise<any[]>;
export declare function updateTunnelConfig(account: Account, tunnelId: string, ingress: Array<{
    hostname?: string;
    service: string;
}>): Promise<any>;
export declare function listZonesForAccount(account: Account): Promise<Array<{
    id: string;
    name: string;
}>>;
/**
 * 获取隧道绑定的域名列表：扫描账户下所有 zone 的 CNAME 记录，
 * 找到 content 为 {tunnelId}.cfargotunnel.com 的记录，返回其 name（hostname）。
 */
export declare function listTunnelHostnames(account: Account, tunnelId: string): Promise<string[]>;
//# sourceMappingURL=tunnelService.d.ts.map