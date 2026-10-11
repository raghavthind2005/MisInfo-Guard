import { VerifiedClaim } from '../api/types';
import { withFallback } from '../llm/fallback';
import { MemoryMatch } from '../memory/factCheckIndex';
import { searchCoverage, searchEvidence } from '../search/tavily';
import { Settings, effectiveBudget, providerChain } from '../settings';
import { daysLeftInMonth, loadUsage, recordUsage } from './budget';
import { CachedOutcome, cacheOutcomes, getCachedOutcomes } from './cache';
import { coverageWindow, headlineQuery, matchCoverage } from './coverage';
import { JudgeInput, judgeClaims, toVerifiedClaim } from './judge';
import { planSearches } from './scheduler';
import { triageClaims } from './triage';

/**
 * Automatic checking for one page. Each claim goes through the cheapest layer
 * that can settle it: verdict cache, fact-check memory, then (budget allowing)
 * one triage call for the page, a search each for the claims most likely to
 * be wrong, and one search for other outlets' coverage of the same story.
 */

export interface PageClaim {
    id: string;
    text: string;
    /** Closest entry in the local fact-check index, if any came near. */
    factCheck?: MemoryMatch;
}

/** What the content script knows about the page being read. */
export interface PageContext {
    title: string;
    host: string;
    /** When the article was published, if the page says so. Needed for the cross-coverage check. */
    publishedAt: string | null;
}

/** Most claims judged against other outlets' coverage in one call. */
const MAX_COVERAGE_CLAIMS = 6;

export type ClaimOutcome =
    /** Checked against search evidence (or served from the verdict cache). */
    | { id: string; kind: 'verified'; result: VerifiedClaim }
    /** The model confirmed the sentence makes the same claim as a published fact-check. */
    | { id: string; kind: 'factcheck'; match: MemoryMatch }
    /** A fact-check candidate turned out to be about something else. */
    | { id: string; kind: 'dismissed' }
    /** Nothing was spent on this claim. */
    | { id: string; kind: 'unchecked' };

export async function analyzePage(settings: Settings, page: PageContext, claims: PageClaim[]): Promise<ClaimOutcome[]> {
    const outcomes = new Map<string, ClaimOutcome>();

    // Layer 1: conclusions we already paid for
    const cached = await getCachedOutcomes(claims.map(claim => claim.text));
    const open: PageClaim[] = [];
    claims.forEach((claim, i) => {
        const hit = cached[i];
        if (hit?.kind === 'verified') {
            outcomes.set(claim.id, { id: claim.id, kind: 'verified', result: hit.result });
        } else if (hit?.kind === 'factcheck' && claim.factCheck) {
            outcomes.set(claim.id, { id: claim.id, kind: 'factcheck', match: claim.factCheck });
        } else if (hit?.kind === 'dismissed' || hit?.kind === 'unchecked') {
            outcomes.set(claim.id, { id: claim.id, kind: hit.kind });
        } else {
            open.push(claim);
        }
    });

    const budget = effectiveBudget(settings);
    const chain = providerChain(settings);
    const usage = await loadUsage();
    const canTriage = chain.length > 0 && usage.llmCallsToday < budget.dailyLlmCalls;

    if (open.length > 0 && canTriage) {
        try {
            await runPaidLayers(settings, page, open, outcomes);
        } catch (err) {
            // A provider failure must not break the page; unchecked claims simply stay unchecked
            console.error('MisInfo Guard: automatic check failed', err);
        }
    }

    return claims.map(claim => outcomes.get(claim.id) ?? { id: claim.id, kind: 'unchecked' });
}

async function runPaidLayers(settings: Settings, page: PageContext, claims: PageClaim[], outcomes: Map<string, ClaimOutcome>) {
    const chain = providerChain(settings);
    const budget = effectiveBudget(settings);

    // Layer 2: one triage call for the whole page
    const { scores } = await withFallback(chain, llm => triageClaims(llm, claims.map(claim => ({
        text: claim.text,
        factCheckedClaim: claim.factCheck?.factCheck.text,
    })), page.publishedAt));
    await recordUsage({ llmCalls: 1 });

    const searchable: { claim: PageClaim; index: number }[] = [];
    claims.forEach((claim, index) => {
        const score = scores[index];
        if (score.stance === 'denies') {
            // The article is itself rejecting this statement, so there is nothing to flag
            outcomes.set(claim.id, { id: claim.id, kind: 'dismissed' });
        } else if (claim.factCheck && score.sameClaim === true) {
            outcomes.set(claim.id, { id: claim.id, kind: 'factcheck', match: claim.factCheck });
        } else {
            if (claim.factCheck) outcomes.set(claim.id, { id: claim.id, kind: 'dismissed' });
            searchable.push({ claim, index });
        }
    });

    // Remember what triage decided, so revisiting the page does not repeat the call
    await cacheOutcomes(claims.map(claim => ({
        claim: claim.text,
        outcome: { kind: outcomes.get(claim.id)?.kind ?? 'unchecked' } as CachedOutcome,
    })));

    // Layer 3: evidence, for as many claims as the budget allows
    const usage = await loadUsage();
    const tavilyKey = settings.tavilyApiKey.trim();
    if (tavilyKey === '' || usage.llmCallsToday >= budget.dailyLlmCalls) return;

    // Evidence about a developing situation must come from the same days as the article.
    // Without a publication date that cannot be guaranteed, so such claims are left unchecked.
    const window = page.publishedAt ? coverageWindow(page.publishedAt) : null;
    const eligible = searchable.filter(({ index }) => scores[index].timeless || window !== null);

    const plan = planSearches(
        eligible.map(({ claim, index }) => ({ id: claim.id, score: scores[index] })),
        budget, usage, daysLeftInMonth(),
    );
    console.debug('MisInfo Guard: triage', claims.map((claim, i) => `${scores[i].pFalse}/${scores[i].basis}/${scores[i].stance}/${scores[i].timeless ? 'timeless' : 'current'}${claim.factCheck ? `/fc:${scores[i].sameClaim}` : ''} ${claim.text.slice(0, 60)}`));
    console.debug('MisInfo Guard: plan', plan, 'published', page.publishedAt);
    const picked = new Set(plan.claimIds);
    const ownSearch = eligible.filter(({ claim }) => picked.has(claim.id));
    // Cross-coverage needs a headline to search for and a date to anchor it to
    const headline = plan.coverage && window ? headlineQuery(page.title) : null;
    if (ownSearch.length === 0 && !headline) return;

    // The claims most likely to be wrong get a search each; one more search fetches
    // other outlets' coverage of the story, which is checked against everything else.
    const [ownEvidence, coverage] = await Promise.all([
        Promise.all(ownSearch.map(({ claim, index }) => searchEvidence(tavilyKey, claim.text, scores[index].timeless ? null : window))),
        headline && window ? searchCoverage(tavilyKey, headline, page.host, window) : Promise.resolve([]),
    ]);
    await recordUsage({ searches: ownSearch.length + (headline ? 1 : 0) });

    console.debug('MisInfo Guard: coverage articles', coverage.map(a => `${a.publishedAt} ${a.text.length} ${a.url.slice(0, 70)}`));
    const judged: PageClaim[] = ownSearch.map(({ claim }) => claim);
    const inputs: JudgeInput[] = ownSearch.map(({ claim }, i) => ({ claim: claim.text, evidence: ownEvidence[i] }));

    const covered = eligible
        .filter(({ claim }) => !picked.has(claim.id))
        .map(({ claim, index }) => ({ claim, score: scores[index], match: matchCoverage(claim.text, coverage) }))
        .filter(item => item.match !== null)
        // Claims whose figures differ from other coverage first, then the ones triage trusted least
        .sort((a, b) => Number(b.match!.figuresDiffer) - Number(a.match!.figuresDiffer) || b.score.pFalse - a.score.pFalse)
        .slice(0, MAX_COVERAGE_CLAIMS);
    for (const item of covered) {
        judged.push(item.claim);
        inputs.push({ claim: item.claim.text, evidence: item.match!.evidence });
    }
    if (inputs.length === 0) return;

    const { judgements } = await withFallback(chain, llm => judgeClaims(llm, inputs, page.publishedAt));
    await recordUsage({ llmCalls: 1 });

    const results = judged.map((claim, i) => toVerifiedClaim(claim.text, judgements[i]));
    console.debug('MisInfo Guard: judged', results.map(r => `${r.verdict}: ${r.claim.slice(0, 60)}`));
    await cacheOutcomes(results.map(result => ({ claim: result.claim, outcome: { kind: 'verified', result } })));
    judged.forEach((claim, i) => outcomes.set(claim.id, { id: claim.id, kind: 'verified', result: results[i] }));
}
