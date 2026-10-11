import { describe, expect, it } from 'vitest';
import { Budget, Usage, dayKey, daysLeftInMonth, rollOver } from '../src/verify/budget';
import { SearchCandidate, planSearches } from '../src/verify/scheduler';
import { TriageScore } from '../src/verify/triage';

const budget: Budget = { dailyLlmCalls: 150, monthlySearches: 600, maxChecksPerPage: 2 };
const usage = (searchesToday = 0, searchesThisMonth = 0): Usage =>
    ({ day: '2026-10-12', llmCallsToday: 0, searchesToday, month: '2026-10', searchesThisMonth });
const claim = (id: string, pFalse: number, basis: TriageScore['basis'] = 'known'): SearchCandidate =>
    ({ id, score: { pFalse, basis, stance: 'asserts', sameClaim: null, timeless: true } });

describe('planSearches', () => {
    it('gives the most suspicious claims their own search, up to the page limit', () => {
        const plan = planSearches([claim('a', 75), claim('b', 99), claim('c', 90), claim('d', 10)], budget, usage(), 20);
        expect(plan.claimIds).toEqual(['b', 'c']);
        expect(plan.coverage).toBe(false); // the page limit is used up
    });

    it('uses the spare search for story coverage when other claims remain', () => {
        expect(planSearches([claim('a', 95), claim('b', 50, 'unsure')], budget, usage(), 20)).toEqual({ claimIds: ['a'], coverage: true });
        expect(planSearches([claim('a', 20), claim('b', 50, 'unsure')], budget, usage(), 20)).toEqual({ claimIds: [], coverage: true });
    });

    it('skips coverage when every claim already has its own search', () => {
        expect(planSearches([claim('a', 95)], budget, usage(), 20).coverage).toBe(false);
    });

    it('spends nothing once the monthly budget is gone or searching is switched off', () => {
        expect(planSearches([claim('a', 99)], budget, usage(0, 600), 20)).toEqual({ claimIds: [], coverage: false });
        expect(planSearches([claim('a', 99)], { ...budget, monthlySearches: 0 }, usage(), 20)).toEqual({ claimIds: [], coverage: false });
        expect(planSearches([claim('a', 99)], { ...budget, maxChecksPerPage: 0 }, usage(), 20)).toEqual({ claimIds: [], coverage: false });
    });

    it('holds coverage back when ahead of the daily pace, but still checks flagged claims', () => {
        // 600 left over 20 days is a pace of 30 a day
        const plan = planSearches([claim('a', 95), claim('b', 50, 'unsure')], budget, usage(30, 0), 20);
        expect(plan).toEqual({ claimIds: ['a'], coverage: false });
    });

    it('stops even flagged claims well beyond the daily pace', () => {
        expect(planSearches([claim('a', 95)], budget, usage(90, 0), 20).claimIds).toEqual([]);
    });

    it('never plans more searches than remain this month', () => {
        const plan = planSearches([claim('a', 95), claim('b', 90)], budget, usage(0, 599), 20);
        expect(plan.claimIds).toHaveLength(1);
        expect(plan.coverage).toBe(false);
    });
});

describe('usage counters', () => {
    it('reset daily and monthly counters when the date rolls over', () => {
        const old: Usage = { day: '2026-09-30', llmCallsToday: 9, searchesToday: 4, month: '2026-09', searchesThisMonth: 40 };
        expect(rollOver(old, new Date(2026, 9, 1))).toEqual({ day: '2026-10-01', llmCallsToday: 0, searchesToday: 0, month: '2026-10', searchesThisMonth: 0 });
        expect(rollOver({ ...old, day: '2026-09-29' }, new Date(2026, 8, 30))).toMatchObject({ searchesToday: 0, searchesThisMonth: 40 });
        expect(rollOver(old, new Date(2026, 8, 30))).toEqual(old);
    });

    it('formats days and counts the days left in a month', () => {
        expect(dayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
        expect(daysLeftInMonth(new Date(2026, 9, 12))).toBe(20);
        expect(daysLeftInMonth(new Date(2026, 1, 28))).toBe(1);
    });
});
