import { Account } from '../models/account';
/**
 * 缓存每个 TTS 模型的 input schema（含 properties 与 required）。
 * 不同 TTS 模型的入参完全不同（如 aura-2-en 用 text+speaker+encoding、
 * aura-2-es 同前者但 speaker 枚举不同、aura-1 speaker 枚举更小、
 * melotts 用 prompt+lang 且无 speaker/encoding），因此不能写死请求体，
 * 必须从模型 schema 动态构造。
 * key = `${account_id}::${model}`
 */
export interface ModelInputSchema {
    /** 动态 schema 属性（type/enum/default/minimum/maximum/description 等，字段因模型而异） */
    properties: Record<string, any>;
    required: string[];
}
/**
 * 获取指定模型的 input schema（取自 CF 模型 schema 的 input 部分）。
 * 获取失败或非对象时返回 null。
 */
export declare function getModelInputSchema(account: Account, model: string): Promise<ModelInputSchema | null>;
/**
 * 从模型 schema 中提取 speaker 枚举。非 TTS 模型或 schema 中无 speaker 参数时返回 null。
 */
export declare function getModelSpeakerEnum(account: Account, model: string): Promise<{
    speakers: string[];
    defaultSpeaker?: string;
} | null>;
/**
 * 将请求中的 voice（可能是 OpenAI 音色名，或 CF 原生 speaker 名）解析为
 * 当前模型实际支持的 speaker。若均不匹配，回退到枚举中的第一个/默认值。
 */
export declare function resolveTtsSpeaker(requestedVoice: string | undefined, speakerEnum: {
    speakers: string[];
    defaultSpeaker?: string;
} | null, voiceMap: Record<string, string>): string | undefined;
/**
 * TTS 高级可选参数（用户可选提交，均按模型 schema 白名单过滤后写入）。
 * 不支持的字段/非法值一律忽略，保证请求体对任意模型都合法。
 */
export interface TtsAdvancedOptions {
    encoding?: string;
    container?: string;
    sample_rate?: number;
    bit_rate?: number;
    lang?: string;
}
/**
 * 提取模型 schema 中可供前端"高级设置"展示的可选参数（排除 text/prompt/speaker 主字段）。
 * 返回 { 字段名: { type, enum?, default?, min?, max? } }，供 /models 接口下发。
 */
export declare function extractTtsAdvancedParams(schema: ModelInputSchema | null): Record<string, any> | undefined;
/**
 * 按模型 schema 动态构造 TTS 请求体（只发送 schema 中存在的字段）：
 * - 文本字段：优先 `prompt`（melotts），否则 `text`（aura 系列）
 * - speaker：仅当 schema 含 speaker 属性时解析并设置
 * - encoding：默认 mp3（若模型支持）；用户显式提供合法值时覆盖
 * - 高级参数（container/sample_rate/bit_rate/lang）：仅当 schema 支持且值合法时写入
 * 返回 { body, speaker }，speaker 用于审计日志展示。
 */
export declare function buildTtsCfBody(schema: ModelInputSchema | null, input: string, voice: string | undefined, voiceMap: Record<string, string>, options?: TtsAdvancedOptions): {
    body: Record<string, any>;
    speaker: string | undefined;
};
export declare function getAvailableModels(account: Account, taskFilter?: string): Promise<any[]>;
export interface AiUsage {
    totalNeurons: number;
    models: Array<{
        modelId: string;
        neurons: number;
        requests: number;
    }>;
}
export declare function getAiUsageToday(account: Account): Promise<AiUsage>;
//# sourceMappingURL=aiService.d.ts.map