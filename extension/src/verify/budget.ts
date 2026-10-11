/**
 * Budgets cap what automatic checking may spend. Manual "check this claim"
 * clicks are counted but never blocked, since the user asked for them.
 */

export interface Budget {
    /** Language model calls allowed per day for automatic checking. */
    dailyLlmCalls: number;
    /** Evidence searches allowed per calendar month for automatic checking. */
    monthlySearches: number;
    /** Most claims searched automatically on a single page. */
    maxChecksPerPage: number;
}

export type BudgetPreset = 'local' | 'free' | 'balanced' | 'custom';

export const BUDGET_PRESETS: Record<Exclude<BudgetPreset, 'custom'>, { label: string; description: string; budget: Budget }> = {
    local: {
        label: 'Local only',
        description: 'Fact-check database only. No API calls are made automatically.',
        budget: { dailyLlmCalls: 0, monthlySearches: 0, maxChecksPerPage: 0 },
    },
    free: {
        label: 'Free tier',
        description: 'Adds one model call per article to confirm fact-check matches. No automatic searches.',
        budget: { dailyLlmCalls: 100, monthlySearches: 0, maxChecksPerPage: 0 },
    },
    balanced: {
        label: 'Balanced',
        description: 'Also searches for evidence on the claims most likely to be wrong, up to two per article.',
        budget: { dailyLlmCalls: 150, monthlySearches: 600, maxChecksPerPage: 2 },
    },
};

export interface Usage {
    /** Local date (YYYY-MM-DD) the daily counters belong to. */
    day: string;
    llmCallsToday: number;
    searchesToday: number;
    /** Local month (YYYY-MM) the monthly counter belongs to. */
    month: string;
    searchesThisMonth: number;
}

const USAGE_KEY = 'usage';

export function dayKey(now = new Date()): string {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function daysLeftInMonth(now = new Date()): number {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return lastDay - now.getDate() + 1;
}

/** Resets any counter whose day or month has rolled over. */
export function rollOver(usage: Usage | undefined, now = new Date()): Usage {
    const day = dayKey(now);
    const month = day.slice(0, 7);
    return {
        day,
        llmCallsToday: usage?.day === day ? usage.llmCallsToday : 0,
        searchesToday: usage?.day === day ? usage.searchesToday : 0,
        month,
        searchesThisMonth: usage?.month === month ? usage.searchesThisMonth : 0,
    };
}

export async function loadUsage(): Promise<Usage> {
    const stored = (await chrome.storage.local.get([USAGE_KEY]))[USAGE_KEY] as Usage | undefined;
    return rollOver(stored);
}

export async function recordUsage(spent: { llmCalls?: number; searches?: number }): Promise<void> {
    const usage = await loadUsage();
    usage.llmCallsToday += spent.llmCalls ?? 0;
    usage.searchesToday += spent.searches ?? 0;
    usage.searchesThisMonth += spent.searches ?? 0;
    await chrome.storage.local.set({ [USAGE_KEY]: usage });
}
