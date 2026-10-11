import { LlmConfig, LlmError } from './provider';

/**
 * Runs a call against each provider in turn until one succeeds.
 * Any provider failure (quota, outage, bad key) moves on to the next;
 * the last error is thrown if every provider fails.
 */
export async function withFallback<T>(chain: LlmConfig[], call: (llm: LlmConfig) => Promise<T>): Promise<T> {
    let lastError: unknown = new LlmError('No LLM provider is configured', 0);

    for (const llm of chain) {
        try {
            return await call(llm);
        } catch (err) {
            console.warn(`MisInfo Guard: ${llm.model} failed, trying next provider`, err);
            lastError = err;
        }
    }
    throw lastError;
}
