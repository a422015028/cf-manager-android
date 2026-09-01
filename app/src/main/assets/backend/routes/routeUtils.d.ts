import { Request, Response, NextFunction } from 'express';
import { Account } from '../models/account';
export declare function getAccountOr404(req: Request, res: Response): Account | null;
export declare function isDemoAccountId(id: number): boolean;
/**
 * 演示账户「毁灭性操作」保护中间件。
 * 拦截所有针对演示账户的销毁/删除类操作，返回 403 DEMO_PROTECTED：
 *  - 所有 DELETE 请求（删 KV 命名空间/键、删 D1 库、删 R2 桶/对象、删 Worker/Pages、删 Secret/Domain/Route、删 DNS 记录等）
 *  - 批量删除类 POST 请求（KV/R2 的 bulk-delete）
 * 注：D1 写查询（INSERT/UPDATE/DELETE/DROP/ALTER 等）在 storage 路由的 query handler 内单独拦截。
 */
export declare function demoDestructiveGuard(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=routeUtils.d.ts.map