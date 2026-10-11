import { Budget, Usage } from './budget';
import { TriageScore } from './triage';

/**
 * Decides which claims on a page are worth an evidence search.
 *
 * Claims the model believes are wrong come first, each with its own search.
 * Everything else, including claims the model cannot judge (recent, local or
 * attributed), is covered by a single search for other outlets' reporting of
 * the story. That search only runs while spending is on pace for the month,
 * so a few busy days cannot drain the whole budget.
 */

export interface SearchCandidate {
    id: string;
    score: TriageScore;
}

export interface SearchPlan {
    /** Claims that each get their own evidence search. */
    claimIds: string[];
    /** Whether to spend one more search on other outlets' coverage of the whole story. */
    coverage: boolean;
}

/** Triage score at or above which a claim counts as likely wrong. */
export const FLAG_THRESHOLD = 70;
/** Likely-wrong claims may run ahead of the daily pace by this factor before being held back. */
const PACE_OVERDRAFT = 3;

export function planSearches(
    candidates: SearchCandidate[],
    budget: Budget,
    usage: Usage,
    daysLeft: number,
): SearchPlan {
    const remaining = budget.monthlySearches - usage.searchesThisMonth;
    if (remaining <= 0 || budget.maxChecksPerPage <= 0) return { claimIds: [], coverage: false };

    const dailyPace = Math.ceil(remaining / Math.max(1, daysLeft));
    const perPage = Math.min(budget.maxChecksPerPage, remaining);

    const flagged = candidates
        .filter(c => c.score.pFalse >= FLAG_THRESHOLD)
        .sort((a, b) => b.score.pFalse - a.score.pFalse);

    const claimIds: string[] = [];
    for (const candidate of flagged) {
        if (claimIds.length >= perPage || usage.searchesToday + claimIds.length >= dailyPace * PACE_OVERDRAFT) break;
        claimIds.push(candidate.id);
    }

    // The coverage search checks every remaining claim at once, so it is the best
    // use of a spare search, but only while spending is on pace for the month.
    const othersLeft = candidates.length > claimIds.length;
    const coverage = othersLeft && claimIds.length < perPage && usage.searchesToday + claimIds.length < dailyPace;

    return { claimIds, coverage };
}
