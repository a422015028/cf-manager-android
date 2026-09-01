import { Account } from '../models/account';
/**
 * 获取 Zone 设置（修复版）。
 * 一次性调用 GET /zones/:zoneId/settings 获取全部设置，再过滤出需要的字段。
 */
export declare function getZoneSettings(account: Account, zoneId: string): Promise<Record<string, any>>;
/** 创建 Zone */
export declare function createZone(account: Account, name: string, type: 'full' | 'partial'): Promise<{
    zone_id: string;
    name_servers: string[];
}>;
/** 删除 Zone */
export declare function deleteZone(account: Account, zoneId: string): Promise<void>;
/** 更新 Zone 设置（批量，best-effort） */
export declare function updateZoneSettings(account: Account, zoneId: string, settings: Record<string, any>): Promise<{
    updated: string[];
    failed: string[];
}>;
/** 清除 Zone 缓存 */
export declare function purgeZoneCache(account: Account, zoneId: string, options: {
    purge_everything?: boolean;
    files?: string[];
}): Promise<{
    id: string;
}>;
/** 暂停/激活 Zone */
export declare function setZoneStatus(account: Account, zoneId: string, paused: boolean): Promise<void>;
/** 清除 zones 缓存（创建/删除后调用） */
export declare function invalidateZonesCache(): void;
/** 更新 DNS 记录代理状态（保留现有功能） */
export declare function updateProxyStatus(account: Account, zoneId: string, recordId: string, proxied: boolean): Promise<void>;
//# sourceMappingURL=zoneService.d.ts.map