import { ChatResult, LlmConfig, chatParsed, extractJson } from '../llm/provider';

/**
 * Triage asks the model what it already knows, without any search.
 * The score only decides which claims are worth spending evidence lookups on;
 * it is never shown to the user as a verdict.
 */

export interface TriageScore {
    /** 0-100 estimate that the claim is factually wrong. */
    pFalse: number;
    /** 'unsure' means the model lacks the knowledge to judge (too recent, local or vague). */
    basis: 'known' | 'unsure';
    /** Whether the sentence asserts the statement, reports someone else saying it, or rejects it. */
    stance: 'asserts' | 'reports' | 'denies';
    /** Whether the sentence makes the same claim as its candidate fact-check; null when it has none. */
    sameClaim: boolean | null;
    /**
     * True when the fact cannot change with time (a historical event, a scientific fact, a figure
     * for a finished period). False for a current or developing situation, where only evidence
     * from the same days as the article can confirm or contradict it.
     */
    timeless: boolean;
}

export interface TriageInput {
    text: string;
    /** A published fact-check of a possibly similar claim, as worded by the fact-checker. */
    factCheckedClaim?: string;
}

export interface TriageResult {
    scores: TriageScore[];
    usage: ChatResult;
}

const UNSCORED: TriageScore = { pFalse: 50, basis: 'unsure', stance: 'asserts', sameClaim: null, timeless: false };

export function buildTriagePrompt(claims: TriageInput[], publishedAt?: string | null): string {
    const numbered = claims.map((claim, i) => {
        const line = `${i + 1}. ${claim.text}`;
        return claim.factCheckedClaim ? `${line}\n   FACT-CHECKED CLAIM: "${claim.factCheckedClaim}"` : line;
    }).join('\n');

    return [
        'These sentences were extracted from web articles. Use only what you already know; do not guess.',
        ...(publishedAt ? [`The article was published on ${publishedAt.slice(0, 10)}.`] : []),
        'For each sentence, estimate how likely it is to be factually wrong.',
        '',
        'Return a JSON object: {"claims": [{"id": <number>, "p_false": <0-100>, "basis": "known" | "unsure", "stance": "asserts" | "reports" | "denies", "same_claim": true | false | null, "timeless": true | false}]}',
        '"known" means you have solid knowledge about this specific fact.',
        '"unsure" means it is too recent, too local, or too vague for you to judge. Give those a p_false near 50.',
        'Pay close attention to exact numbers, dates and names: a statement with one wrong figure is wrong.',
        'Your knowledge stops at a cutoff date. A sentence about events, prices or figures after that date, or about a situation that is still developing, may be true even if it surprises you: mark it "unsure" with p_false near 50.',
        '"timeless": true if the fact cannot change with time (a historical event, a scientific fact, a figure for a finished period such as a past year). false if it describes a current or developing situation (something "so far", "since" a recent event, "this year", latest prices or totals).',
        '"stance": "asserts" if the sentence states it as fact, "reports" if it attributes it to someone else, "denies" if the sentence itself says it is false or a myth.',
        '"same_claim" applies only when a FACT-CHECKED CLAIM is listed under the sentence: true if the sentence makes that same factual assertion (same subject, same figures and dates), false if it merely shares a topic. Otherwise null.',
        '',
        numbered,
    ].join('\n');
}

export function parseTriage(text: string, count: number): TriageScore[] {
    const scores: TriageScore[] = Array.from({ length: count }, () => ({ ...UNSCORED }));
    const parsed = extractJson(text);
    const items = Array.isArray(parsed.claims) ? parsed.claims : [];

    for (const item of items) {
        const index = Number(item.id) - 1;
        const pFalse = Number(item.p_false);
        if (!Number.isInteger(index) || index < 0 || index >= count || !Number.isFinite(pFalse)) continue;
        scores[index] = {
            pFalse: Math.min(100, Math.max(0, pFalse)),
            basis: item.basis === 'known' ? 'known' : 'unsure',
            stance: item.stance === 'reports' || item.stance === 'denies' ? item.stance : 'asserts',
            sameClaim: typeof item.same_claim === 'boolean' ? item.same_claim : null,
            timeless: item.timeless === true,
        };
    }
    return scores;
}

export async function triageClaims(llm: LlmConfig, claims: TriageInput[], publishedAt?: string | null): Promise<TriageResult> {
    const { value, usage } = await chatParsed(llm, buildTriagePrompt(claims, publishedAt), text => parseTriage(text, claims.length));
    return { scores: value, usage };
}
