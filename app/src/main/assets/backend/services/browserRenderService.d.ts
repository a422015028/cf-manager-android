import { Account } from '../models/account';
export type RenderMode = 'screenshot' | 'content' | 'markdown' | 'pdf' | 'links';
export type BrowserEngine = 'chrome' | 'kitesurf';
export interface RenderResult {
    mode: RenderMode;
    screenshot?: string;
    html?: string;
    markdown?: string;
    pdf?: string;
    links?: string[];
    duration: number;
    browserMsUsed?: number;
}
export declare function renderPage(account: Account, url: string, mode?: RenderMode, browser?: BrowserEngine): Promise<RenderResult>;
//# sourceMappingURL=browserRenderService.d.ts.map