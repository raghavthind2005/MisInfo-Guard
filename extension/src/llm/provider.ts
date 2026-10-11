/**
 * Minimal client for OpenAI-style chat completion endpoints.
 * Gemini, Sarvam, Groq, OpenRouter and Ollama all accept this request shape,
 * so one adapter plus a base URL covers every provider we support.
 */

export interface LlmConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** Ask the endpoint for strict JSON mode. Off for providers whose JSON mode misbehaves. */
    jsonMode?: boolean;
    /** Provider-specific request fields, merged into the body as-is. */
    extraBody?: Record<string, unknown>;
}

export interface ChatResult {
    text: string;
    inputTokens: number;
    outputTokens: number;
}

export class LlmError extends Error {
    constructor(message: string, public status: number) {
        super(message);
        this.name = 'LlmError';
    }

    /** True when the provider rejected the call because a quota or rate limit was hit. */
    get isQuota(): boolean {
        return this.status === 429;
    }
}

export const PROVIDER_PRESETS = {
    gemini: {
        label: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: 'gemini-3.5-flash-lite',
        jsonMode: true,
        extraBody: {},
    },
    sarvam: {
        label: 'Sarvam AI',
        baseUrl: 'https://api.sarvam.ai/v1',
        model: 'sarvam-105b',
        // Sarvam's JSON mode leaks its reasoning into the object, so we parse plain text instead.
        // Reasoning is billed as output and can exhaust the token limit, so it is switched off.
        jsonMode: false,
        extraBody: { reasoning_effort: null, max_tokens: 4000 },
    },
} as const;

export type ProviderId = keyof typeof PROVIDER_PRESETS;

/**
 * Sends a single user prompt and asks for a JSON object back.
 */
export async function chatJson(config: LlmConfig, prompt: string, signal?: AbortSignal): Promise<ChatResult> {
    const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
            model: config.model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            ...(config.jsonMode === false ? {} : { response_format: { type: 'json_object' } }),
            ...config.extraBody,
        }),
        signal,
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new LlmError(`${config.model} returned ${response.status}: ${body.slice(0, 200)}`, response.status);
    }

    const data = await response.json() as any;
    const text = data.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || text.length === 0) {
        const reason = data.choices?.[0]?.finish_reason ?? 'unknown';
        throw new LlmError(`${config.model} returned an empty message (finish reason: ${reason})`, 502);
    }

    return {
        text,
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: (data.usage?.total_tokens ?? 0) - (data.usage?.prompt_tokens ?? 0),
    };
}

/**
 * Pulls the JSON object out of a model reply, tolerating code fences and stray prose.
 */
export function extractJson(text: string): any {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) {
        throw new Error('No JSON object in model reply');
    }
    return JSON.parse(text.slice(start, end + 1));
}

/**
 * Sends a prompt and parses the reply, asking once more if the reply cannot
 * be parsed. Small models occasionally emit malformed JSON; a second attempt
 * nearly always succeeds and is far cheaper than abandoning the page.
 */
export async function chatParsed<T>(config: LlmConfig, prompt: string, parse: (text: string) => T): Promise<{ value: T; usage: ChatResult }> {
    const first = await chatJson(config, prompt);
    try {
        return { value: parse(first.text), usage: first };
    } catch {
        const second = await chatJson(config, prompt);
        return { value: parse(second.text), usage: second };
    }
}
