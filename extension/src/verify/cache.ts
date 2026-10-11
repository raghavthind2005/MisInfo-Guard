import { VerifiedClaim } from '../api/types';

/**
 * Remembers what automatic checking concluded about a sentence, across pages
 * and sessions, so a claim that appears again is not paid for twice.
 */

/** What was decided about a claim. Only 'verified' carries a result. */
export type CachedOutcome =
    | { kind: 'verified'; result: VerifiedClaim }
    | { kind: 'factcheck' }
    | { kind: 'dismissed' }
    | { kind: 'unchecked' };

const CACHE_KEY = 'verdicts';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 600;

/** Triaged-but-not-searched claims expire sooner, so they get another chance when budget frees up. */
const TTL_MS: Record<CachedOutcome['kind'], number> = {
    verified: 7 * DAY_MS,
    factcheck: 7 * DAY_MS,
    dismissed: 7 * DAY_MS,
    unchecked: DAY_MS,
};

type Entry = CachedOutcome & { at: number };
type Cache = Record<string, Entry>;

/** Ignores case, punctuation and spacing so trivially different copies of a sentence share an entry. */
export function cacheKey(claim: string): string {
    return claim.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export async function getCachedOutcomes(claims: string[]): Promise<(CachedOutcome | null)[]> {
    const cache = await load();
    const now = Date.now();
    return claims.map(claim => {
        const entry = cache[cacheKey(claim)];
        return entry && now - entry.at < TTL_MS[entry.kind] ? entry : null;
    });
}

export async function getCachedVerdict(claim: string): Promise<VerifiedClaim | null> {
    const [outcome] = await getCachedOutcomes([claim]);
    return outcome?.kind === 'verified' ? outcome.result : null;
}

export async function cacheOutcomes(outcomes: { claim: string; outcome: CachedOutcome }[]): Promise<void> {
    if (outcomes.length === 0) return;
    const cache = await load();
    const now = Date.now();
    for (const { claim, outcome } of outcomes) {
        cache[cacheKey(claim)] = { ...outcome, at: now };
    }

    // Drop expired entries, then the oldest ones beyond the size limit
    const kept = Object.entries(cache)
        .filter(([, entry]) => now - entry.at < TTL_MS[entry.kind])
        .sort((a, b) => b[1].at - a[1].at)
        .slice(0, MAX_ENTRIES);
    await chrome.storage.local.set({ [CACHE_KEY]: Object.fromEntries(kept) });
}

async function load(): Promise<Cache> {
    return ((await chrome.storage.local.get([CACHE_KEY]))[CACHE_KEY] as Cache | undefined) ?? {};
}
