import { describe, expect, it } from 'vitest';
import { buildTriagePrompt, parseTriage } from '../src/verify/triage';

describe('parseTriage', () => {
    it('reads scores, stance and the fact-check confirmation', () => {
        const scores = parseTriage(JSON.stringify({ claims: [
            { id: 1, p_false: 95, basis: 'known', stance: 'asserts', same_claim: true, timeless: true },
            { id: 2, p_false: 10, basis: 'known', stance: 'denies', same_claim: null },
        ] }), 2);
        expect(scores[0]).toEqual({ pFalse: 95, basis: 'known', stance: 'asserts', sameClaim: true, timeless: true });
        expect(scores[1]).toMatchObject({ stance: 'denies', sameClaim: null, timeless: false });
    });

    it('treats claims the model skipped as unsure', () => {
        const scores = parseTriage('{"claims": [{"id": 2, "p_false": 80, "basis": "known"}]}', 3);
        expect(scores[0]).toEqual({ pFalse: 50, basis: 'unsure', stance: 'asserts', sameClaim: null, timeless: false });
        expect(scores[1].pFalse).toBe(80);
        expect(scores[2].basis).toBe('unsure');
    });

    it('clamps scores and ignores out-of-range ids', () => {
        const scores = parseTriage('{"claims": [{"id": 1, "p_false": 250}, {"id": 7, "p_false": 90}, {"id": 0, "p_false": 90}]}', 1);
        expect(scores).toHaveLength(1);
        expect(scores[0].pFalse).toBe(100);
    });
});

describe('buildTriagePrompt', () => {
    it('tells the model when the article was published, if known', () => {
        expect(buildTriagePrompt([{ text: 'A sentence.' }], '2026-10-09T19:32:50Z')).toContain('The article was published on 2026-10-09.');
        expect(buildTriagePrompt([{ text: 'A sentence.' }])).not.toContain('published on');
    });

    it('attaches a candidate fact-check under its sentence', () => {
        const prompt = buildTriagePrompt([{ text: 'First sentence.' }, { text: 'Second sentence.', factCheckedClaim: 'A checked claim' }]);
        expect(prompt).toContain('1. First sentence.\n2. Second sentence.\n   FACT-CHECKED CLAIM: "A checked claim"');
    });
});
