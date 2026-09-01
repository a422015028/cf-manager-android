export interface AuditLog {
    id: number;
    account_id: number | null;
    action: string;
    target: string | null;
    detail: string | null;
    status: 'success' | 'error';
    created_at: string;
}
export declare function createAuditLog(accountId: number | null, action: string, target: string | null, detail: string | null, status: 'success' | 'error'): void;
export interface AuditLogWithName extends AuditLog {
    account_name: string | null;
}
export declare function getRecentLogs(limit?: number): AuditLogWithName[];
export interface LogFilter {
    action?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
}
export declare function queryLogs(filter?: LogFilter): AuditLogWithName[];
export declare function getDistinctActions(): string[];
//# sourceMappingURL=auditLog.d.ts.map