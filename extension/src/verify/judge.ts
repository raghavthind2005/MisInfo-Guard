import { VerifiedClaim } from '../api/types';
import { ChatResult, LlmConfig, chatParsed, extractJson } from '../llm/provider';
import { compareFigures } from './numbers';

/**
 * The judge compares claims against retrieved evidence.
 * A verdict only stands if the model can point to words that are really in
 * one of the snippets; otherwise it is downgraded to UNCLEAR.
 */

export type Verdict = 'SUPPORTED' | 'CONTRADICTED' | 'UNCLEAR';

export interface Evidence {
    url: string;
    title: string;
    text: string;
    /** ISO date the source was published, when the search reports one. */
    publishedAt?: string;
}

export interface JudgeInput {
    claim: string;
    evidence: Evidence[];
}

export interface Judgement {
    verdict: Verdict;
    /** The verdict the model gave before the quote check. */
    rawVerdict: Verdict;
    evidence: Evidence | null;
    quote: string | null;
}

export interface JudgeResult {
    judgements: Judgement[];
    usage: ChatResult;
}

const MIN_QUOTE_LENGTH = 15;
const MIN_QUOTE_WORDS = 6;
/** Share of a quote's words a source sentence must contain to stand in for a slightly reworded quote. */
const NEAR_QUOTE_SHARE = 0.75;
const MAX_SNIPPET_LENGTH = 600;
const MAX_TITLE_LENGTH = 90;

export function buildJudgePrompt(inputs: JudgeInput[], publishedAt?: string | null): string {
    const blocks = inputs.map((input, i) => {
        const snippets = input.evidence.map((ev, j) => {
            const host = safeHost(ev.url);
            // The headline tells the judge what a snippet is about when the snippet itself says "the company"
            const headline = ev.title.slice(0, MAX_TITLE_LENGTH).replace(/\s+/g, ' ');
            const dated = ev.publishedAt ? `, ${ev.publishedAt.slice(0, 10)}` : '';
            return `  [${j + 1}] (${host}${dated}, from "${headline}") ${ev.text.slice(0, MAX_SNIPPET_LENGTH).replace(/\s+/g, ' ')}`;
        });
        return [`CLAIM ${i + 1}: ${input.claim}`, ...snippets].join('\n');
    });

    return [
        'Check each claim ONLY against the numbered evidence snippets listed under it. Ignore anything you know from elsewhere.',
        ...(publishedAt ? [`The article making these claims was published on ${publishedAt.slice(0, 10)}.`] : []),
        '',
        'Return a JSON object: {"claims": [{"id": <claim number>, "verdict": "SUPPORTED" | "CONTRADICTED" | "UNCLEAR", "evidence": <snippet number or null>, "quote": "<exact words copied from that snippet, or null>"}]}',
        'SUPPORTED: a snippet states the same fact, with matching figures, dates and names.',
        'CONTRADICTED: a snippet clearly states something incompatible with the claim, or explicitly calls it false.',
        'UNCLEAR: the snippets are off-topic, incomplete, or do not settle it. Prefer UNCLEAR when in doubt.',
        'A snippet that only repeats the claim as a myth, rumour, allegation or something a person said is NOT support.',
        'A snippet about a different time period, event, place or organisation than the claim does not settle it: answer UNCLEAR. Reports of earlier quarters or years are not evidence about the current one.',
        'For a claim about a situation that changes over time (prices, totals so far, who holds an office), a snippet only counts if it describes the same point in time as the article. An undated or earlier snippet with a different figure is not a contradiction: answer UNCLEAR.',
        'If the source presents the claim in order to debunk it (myth, false, baseless, no evidence, discredited, retracted), the verdict is CONTRADICTED.',
        'The quote must be copied character for character from the snippet text you cite, not from its headline.',
        '',
        blocks.join('\n\n'),
    ].join('\n');
}

export function parseJudgements(text: string, inputs: JudgeInput[]): Judgement[] {
    const judgements: Judgement[] = inputs.map(() => ({
        verdict: 'UNCLEAR', rawVerdict: 'UNCLEAR', evidence: null, quote: null,
    }));
    const parsed = extractJson(text);
    const items = Array.isArray(parsed.claims) ? parsed.claims : [];

    for (const item of items) {
        const index = Number(item.id) - 1;
        const input = inputs[index];
        if (!input) continue;

        const rawVerdict = toVerdict(item.verdict);
        const evidence = input.evidence[Number(item.evidence) - 1] ?? null;
        // Replace the model's quote with the source's own words, or drop it if the source has none like it
        const quote = evidence !== null && typeof item.quote === 'string' ? locateQuote(evidence.text, item.quote) : null;
        // A quote that merely repeats the claim proves nothing: fact-check pages restate
        // the claim they are about to debunk, and that restatement is not support.
        const verified = quote !== null && !(rawVerdict === 'SUPPORTED' && restatesClaim(input.claim, quote));

        judgements[index] = {
            verdict: verified ? rawVerdict : 'UNCLEAR',
            rawVerdict,
            evidence: verified ? evidence : null,
            quote: verified ? quote : null,
        };
    }
    return judgements;
}

export async function judgeClaims(llm: LlmConfig, inputs: JudgeInput[], publishedAt?: string | null): Promise<JudgeResult> {
    const { value, usage } = await chatParsed(llm, buildJudgePrompt(inputs, publishedAt), text => parseJudgements(text, inputs));
    return { judgements: value, usage };
}

/**
 * Finds the model's quote in the source and returns the source's own wording.
 *
 * An exact match (ignoring case, spacing and quote marks) is returned as given.
 * Models sometimes tidy a quote slightly ("in Q4" for "for the fourth quarter"),
 * so failing that, the source sentence sharing nearly all of the quote's words
 * and every one of its figures is returned instead. What the reader sees is
 * therefore always text that really is in the source. Returns null otherwise.
 */
export function locateQuote(source: string, quote: string): string | null {
    const needle = normalize(quote);
    // A few words ("And he's wrong on that.") cannot show the reader what the source actually says
    if (needle.length < MIN_QUOTE_LENGTH || words(quote).length < MIN_QUOTE_WORDS) return null;
    if (normalize(source).includes(needle)) return quote.trim();

    const quoteWords = words(quote);
    const quoteFigures = quoteWords.filter(word => /^\d/.test(word));
    let best: string | null = null;
    let bestShare = NEAR_QUOTE_SHARE;

    for (const sentence of source.split(/(?<=[.!?]["”']?)\s+|\n+/)) {
        const sentenceWords = new Set(words(sentence));
        if (!quoteFigures.every(figure => sentenceWords.has(figure))) continue;
        const share = quoteWords.filter(word => sentenceWords.has(word)).length / quoteWords.length;
        if (share >= bestShare) {
            bestShare = share;
            best = sentence.replace(/\s+/g, ' ').trim();
        }
    }
    return best;
}

/** True when the quote appears in the source, exactly or as a near-verbatim sentence. */
export function containsQuote(source: string, quote: string): boolean {
    return locateQuote(source, quote) !== null;
}

function words(text: string): string[] {
    return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.,]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) ?? [];
}

/**
 * True when a quote is just the claim again, word for word.
 */
function restatesClaim(claim: string, quote: string): boolean {
    const a = normalize(claim);
    const b = normalize(quote);
    return a === b || (b.length >= MIN_QUOTE_LENGTH && a.includes(b)) || a.length >= MIN_QUOTE_LENGTH && b.includes(a);
}

function normalize(text: string): string {
    return text
        .toLowerCase()
        .replace(/[‘’“”"'`]/g, '')
        .replace(/\s+/g, ' ')
        .replace(/^[\s.,;:!?…-]+|[\s.,;:!?…-]+$/g, '');
}

function toVerdict(value: unknown): Verdict {
    return value === 'SUPPORTED' || value === 'CONTRADICTED' ? value : 'UNCLEAR';
}

function safeHost(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return 'unknown';
    }
}

/**
 * Packages a judgement for display. For a contradiction, the article's and
 * the source's figures are compared in code so the tooltip can show both.
 */
export function toVerifiedClaim(claim: string, judgement: Judgement): VerifiedClaim {
    const figures = judgement.verdict === 'CONTRADICTED' && judgement.quote ? compareFigures(claim, judgement.quote) : null;
    return {
        status: 'ok',
        claim,
        verdict: judgement.verdict,
        quote: judgement.quote,
        source: judgement.evidence ? { url: judgement.evidence.url, title: judgement.evidence.title } : null,
        ...(figures ? { figures } : {}),
    };
}
