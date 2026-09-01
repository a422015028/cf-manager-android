export interface ScheduledTask {
    id: number;
    name: string;
    type: string;
    cron: string;
    config: string | null;
    enabled: number;
    created_at: string;
}
export interface TaskExecution {
    id: number;
    task_id: number;
    status: 'running' | 'success' | 'error';
    detail: string | null;
    started_at: string;
    finished_at: string | null;
}
export declare function getAllTasks(): ScheduledTask[];
export declare function getTaskById(id: number): ScheduledTask | undefined;
export declare function createTask(name: string, type: string, cronExpr: string, config?: any): number;
export declare function updateTask(id: number, updates: {
    name?: string;
    cron?: string;
    config?: any;
    enabled?: boolean;
}): void;
export declare function deleteTask(id: number): void;
export declare function getTaskHistory(taskId: number, limit?: number): TaskExecution[];
export declare function runTaskNow(id: number): Promise<TaskExecution>;
export declare function initScheduler(): void;
//# sourceMappingURL=taskScheduler.d.ts.map