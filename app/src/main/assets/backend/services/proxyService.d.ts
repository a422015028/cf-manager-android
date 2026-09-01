import type { Agent } from 'http';
import type { Account } from '../models/account';
export interface FetchResponse {
    ok: boolean;
    status: number;
    statusText: string;
    headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
    json(): Promise<any>;
    arrayBuffer(): Promise<ArrayBuffer>;
    body: any;
}
export interface ResinConfig {
    enabled: boolean;
    url: string;
    token: string;
    platform: string;
}
export declare function getResinConfig(): ResinConfig;
export declare function setResinConfig(cfg: Partial<ResinConfig>): void;
export declare function isResinEnabled(): boolean;
/**
 * 为指定账户构建 Resin sticky 代理 URL
 * 格式: http://Platform.AccountId:Token@host:port
 */
export declare function buildResinProxyUrl(accountId: number): string;
export declare function isProxyEnabled(): boolean;
export declare function setProxyEnabled(enabled: boolean): void;
export declare function getProxyUrl(): string;
export declare function setProxyUrl(url: string): void;
/**
 * 获取指定账户的代理 URL
 * 优先级：账户专属代理(已启用) > Resin(已启用) > 全局代理(设置页) > 环境变量 PROXY_URL
 * 返回空字符串表示不使用代理
 */
export declare function getAccountProxyUrl(account?: Account | null): string;
export declare function getHttpAgent(): Agent | undefined;
/**
 * 获取指定账户的 HTTP Agent（支持账户专属代理 + Resin 代理池）
 * 优先级：账户专属代理(已启用) > Resin(已启用) > 全局代理(已启用)
 */
export declare function getHttpAgentForAccount(account?: Account | null): Agent | undefined;
export declare function proxyFetch(input: string | URL, init?: any, timeoutMs?: number, accountProxyUrl?: string, account?: Account | null): Promise<FetchResponse>;
export declare function buildCurlCommand(url: string, init?: any): string;
export declare function testProxyConnection(proxyUrl: string): Promise<{
    latency_ms: number;
    status: number;
}>;
/**
 * 测试 Resin 代理池连接
 * 使用 Resin 代理访问 Cloudflare API，验证连通性和延迟
 */
export declare function testResinConnection(accountId?: number): Promise<{
    latency_ms: number;
    status: number;
    exit_ip?: string;
}>;
//# sourceMappingURL=proxyService.d.ts.map