import { describe, expect, it } from 'vitest';
import { JudgeInput, buildJudgePrompt, locateQuote, parseJudgements, toVerifiedClaim } from '../src/verify/judge';

const SOURCE = 'BYD sold 3.02 million vehicles in 2023. Tesla reported 485,000 deliveries for the fourth quarter, bringing its 2023 total to 1.8 million. Shares rose.';
const input: JudgeInput = {
    claim: 'Tesla delivered about 4.5 million vehicles worldwide in 2023.',
    evidence: [{ url: 'https://www.reuters.com/a', title: 'Tesla posts record year', text: SOURCE }],
};
const reply = (verdict: string, quote: string | null, evidence: number | null = 1) =>
    JSON.stringify({ claims: [{ id: 1, verdict, evidence, quote }] });

describe('locateQuote', () => {
    it('accepts an exact quote, ignoring case, spacing and quote marks', () => {
        expect(locateQuote(SOURCE, '  bringing its 2023 total  to 1.8 MILLION ')).toBe('bringing its 2023 total  to 1.8 MILLION');
        expect(locateQuote(SOURCE, 'total to 1.8 million')).toBeNull(); // too few words to be evidence
        expect(locateQuote('He said “no evidence” exists for it at all.', 'he said "no evidence" exists for it')).not.toBeNull();
    });

    it('swaps a lightly reworded quote for the real source sentence', () => {
        expect(locateQuote(SOURCE, 'Tesla reported 485,000 deliveries in Q4, bringing 2023 total to 1.8 million'))
            .toBe('Tesla reported 485,000 deliveries for the fourth quarter, bringing its 2023 total to 1.8 million.');
    });

    it('rejects a quote whose figures are not in the source', () => {
        expect(locateQuote(SOURCE, 'Tesla reported 485,000 deliveries in Q4, bringing 2023 total to 2.8 million')).toBeNull();
    });

    it('rejects invented and very short quotes', () => {
        expect(locateQuote(SOURCE, 'Tesla is the largest carmaker in the world by deliveries')).toBeNull();
        expect(locateQuote(SOURCE, 'Shares rose')).toBeNull();
    });
});

describe('parseJudgements', () => {
    it('keeps a verdict backed by a real quote', () => {
        const [judgement] = parseJudgements(reply('CONTRADICTED', 'bringing its 2023 total to 1.8 million'), [input]);
        expect(judgement.verdict).toBe('CONTRADICTED');
        expect(judgement.evidence?.url).toBe('https://www.reuters.com/a');
    });

    it('downgrades a verdict whose quote is not in the source', () => {
        const [judgement] = parseJudgements(reply('CONTRADICTED', 'Tesla only delivered 900,000 vehicles that year'), [input]);
        expect(judgement).toMatchObject({ verdict: 'UNCLEAR', rawVerdict: 'CONTRADICTED', quote: null, evidence: null });
    });

    it('does not count a restatement of the claim as support', () => {
        const hoax: JudgeInput = {
            claim: 'Monzo has launched a new casino app called Monzo Slots.',
            evidence: [{ url: 'https://fullfact.org/x', title: 'Fact check', text: 'Monzo has launched a new casino app called Monzo slots. Monzo has confirmed that this is not genuine.' }],
        };
        const [judgement] = parseJudgements(reply('SUPPORTED', 'Monzo has launched a new casino app called Monzo slots.'), [hoax]);
        expect(judgement.verdict).toBe('UNCLEAR');
    });

    it('survives malformed replies', () => {
        expect(parseJudgements('```json\n' + reply('SUPPORTED', null) + '\n```', [input])[0].verdict).toBe('UNCLEAR');
        expect(parseJudgements('{"claims": [{"id": 9, "verdict": "CONTRADICTED"}]}', [input])[0].verdict).toBe('UNCLEAR');
        expect(parseJudgements('{"claims": [{"id": 1, "verdict": "NONSENSE", "evidence": 1, "quote": "bringing its 2023 total to 1.8 million"}]}', [input])[0].verdict).toBe('UNCLEAR');
        expect(() => parseJudgements('no json here', [input])).toThrow();
    });
});

describe('toVerifiedClaim', () => {
    it('attaches differing figures to a contradiction', () => {
        const [judgement] = parseJudgements(reply('CONTRADICTED', 'bringing its 2023 total to 1.8 million'), [input]);
        expect(toVerifiedClaim(input.claim, judgement)).toMatchObject({
            verdict: 'CONTRADICTED',
            figures: { article: '4.5 million', source: '1.8 million' },
            source: { url: 'https://www.reuters.com/a' },
        });
    });
});

describe('buildJudgePrompt', () => {
    it('lists each claim with its numbered snippets, host and headline', () => {
        const prompt = buildJudgePrompt([input]);
        expect(prompt).toContain('CLAIM 1: Tesla delivered about 4.5 million');
        expect(prompt).toContain('[1] (reuters.com, from "Tesla posts record year")');
    });

    it('shows the article date and each dated snippet\'s date', () => {
        const dated: JudgeInput = { claim: input.claim, evidence: [{ ...input.evidence[0], publishedAt: '2026-10-02' }] };
        const prompt = buildJudgePrompt([dated], '2026-10-03T08:00:00Z');
        expect(prompt).toContain('The article making these claims was published on 2026-10-03.');
        expect(prompt).toContain('[1] (reuters.com, 2026-10-02, from "Tesla posts record year")');
    });
});
