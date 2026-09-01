import { RenderMode, RenderResult, BrowserEngine } from './browserRenderService';
export interface BrowserRenderRequest {
    url: string;
    mode?: RenderMode;
    browser?: BrowserEngine;
    accountId?: number;
}
export interface BrowserRenderResponse {
    success: boolean;
    result?: RenderResult;
    error?: {
        message: string;
        code: string;
        waitMs?: number;
    };
}
export declare function handleBrowserRender(req: BrowserRenderRequest): Promise<{
    status: number;
    body: BrowserRenderResponse;
}>;
//# sourceMappingURL=browserRenderHandler.d.ts.map