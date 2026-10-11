import { VerificationResult } from '../api/types';
import { withFallback } from '../llm/fallback';
import { LlmError } from '../llm/provider';
import { SearchError, searchEvidence } from '../search/tavily';
import { Settings, isConfigured, providerChain } from '../settings';
import { recordUsage } from './budget';
import { cacheOutcomes, getCachedVerdict } from './cache';
import { judgeClaims, toVerifiedClaim } from './judge';

/**
 * Verifies one claim on request: one evidence search, then one judge call.
 * Manual checks are counted against usage but are not limited by the budget.
 */
export async function verifyClaim(settings: Settings, claim: string): Promise<VerificationResult> {
    if (!isConfigured(settings)) {
        return { status: 'setup', claim, message: 'Add your API keys in the extension options to check claims.' };
    }

    const cached = await getCachedVerdict(claim);
    if (cached) return cached;

    try {
        const evidence = await searchEvidence(settings.tavilyApiKey.trim(), claim);
        await recordUsage({ searches: 1 });
        if (evidence.length === 0) {
            return { status: 'ok', claim, verdict: 'UNCLEAR', quote: null, source: null };
        }

        const { judgements } = await withFallback(providerChain(settings), llm => judgeClaims(llm, [{ claim, evidence }]));
        await recordUsage({ llmCalls: 1 });
        const result = toVerifiedClaim(claim, judgements[0]);
        await cacheOutcomes([{ claim, outcome: { kind: 'verified', result } }]);
        return result;
    } catch (err) {
        console.error('MisInfo Guard: verification failed', err);
        return { status: 'error', claim, message: describeError(err) };
    }
}

/**
 * Turns a provider failure into a message a user can act on.
 */
function describeError(err: unknown): string {
    if (err instanceof SearchError) {
        if (err.status === 401 || err.status === 403) return 'Tavily rejected the API key. Check it in the extension options.';
        if (err.status === 429 || err.status === 432) return 'Your Tavily search credits are used up for now.';
        return 'The evidence search failed. Try again in a moment.';
    }
    if (err instanceof LlmError) {
        if (err.isQuota) return 'Your language model quota is used up for now.';
        if (err.status === 400 || err.status === 401 || err.status === 403) {
            return 'The language model rejected the API key. Check it in the extension options.';
        }
        return 'The language model did not respond. Try again in a moment.';
    }
    return 'Could not reach the network.';
}
