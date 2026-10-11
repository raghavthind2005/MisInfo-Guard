import { Evidence } from './judge';
import { compareFigures } from './numbers';

/**
 * Cross-coverage check: instead of one search per claim, fetch how other
 * outlets covered the same story at the same time, once, then line each
 * claim up with the passages that talk about the same thing.
 */

export interface CoverageArticle {
    url: string;
    title: string;
    text: string;
    /** ISO date the article was published. */
    publishedAt: string;
}

/**
 * Other coverage only counts if it was published around the same time as the
 * page. Recurring stories (quarterly results, monthly statistics) look alike
 * from one period to the next, and last year's report must not be mistaken
 * for a contradiction of this year's.
 */
const DAYS_BEFORE = 3;
const DAYS_AFTER = 10;

export function coverageWindow(publishedAt: string): { start: string; end: string } | null {
    const published = new Date(publishedAt);
    if (Number.isNaN(published.getTime())) return null;
    const day = 24 * 60 * 60 * 1000;
    const iso = (time: number) => new Date(time).toISOString().slice(0, 10);
    return { start: iso(published.getTime() - DAYS_BEFORE * day), end: iso(published.getTime() + DAYS_AFTER * day) };
}

export interface CoverageMatch {
    /** Passages from other outlets that best overlap the claim, most relevant first. */
    evidence: Evidence[];
    /** True when the best passage states one of the claim's figures differently. */
    figuresDiffer: boolean;
}

const STOPWORDS = new Set(('the a an and or but of to in on at for from by with as is are was were be been has have had it its this that these those ' +
    'he she they we you his her their our will would can could should may might not no than then there which who whom what when where why how ' +
    'said says according also more most about over after before into out up down new year years').split(' '));

/** Share of the claim's weighted terms a passage must contain to count as being about the same thing. */
const MIN_OVERLAP = 0.4;
const PASSAGES_PER_CLAIM = 3;
const MAX_PASSAGE_LENGTH = 420;

/**
 * Turns a page title into a search query by dropping the site name that
 * usually trails it ("Headline - BBC News", "Headline | Reuters").
 */
export function headlineQuery(title: string): string | null {
    const parts = title.split(/\s[|–—-]\s/).map(part => part.trim());
    const headline = parts.reduce((longest, part) => (part.length > longest.length ? part : longest), '');
    return headline.split(/\s+/).length >= 4 ? headline : null;
}

export function splitSentences(text: string): string[] {
    return text
        .split(/\n+|(?<=[.!?]["”']?)\s+(?=["“'[(]*[A-Z0-9])/)
        .map(sentence => sentence.replace(/\s+/g, ' ').trim())
        // Scraped article text carries markdown links and images; those lines are page furniture, not prose
        .filter(sentence => sentence.length >= 40 && sentence.length <= MAX_PASSAGE_LENGTH && !/\]\(|https?:\/\//.test(sentence));
}

/**
 * Finds the passages in other coverage that best match a claim.
 * Returns null when nothing overlaps enough to be evidence either way.
 */
export function matchCoverage(claim: string, articles: CoverageArticle[]): CoverageMatch | null {
    const claimTerms = weightedTerms(claim);
    const total = [...claimTerms.values()].reduce((sum, weight) => sum + weight, 0);
    if (total === 0) return null;

    const scored: { score: number; evidence: Evidence }[] = [];
    for (const article of articles) {
        for (const sentence of splitSentences(article.text)) {
            const terms = new Set(weightedTerms(sentence).keys());
            let shared = 0;
            claimTerms.forEach((weight, term) => {
                if (terms.has(term)) shared += weight;
            });
            const score = shared / total;
            if (score >= MIN_OVERLAP) {
                scored.push({ score, evidence: { url: article.url, title: article.title, text: sentence, publishedAt: article.publishedAt } });
            }
        }
    }
    if (scored.length === 0) return null;

    scored.sort((a, b) => b.score - a.score);
    const evidence = scored.slice(0, PASSAGES_PER_CLAIM).map(item => item.evidence);
    return { evidence, figuresDiffer: compareFigures(claim, evidence[0].text) !== null };
}

/**
 * Content words of a text with a weight each. Names and figures identify
 * what a sentence is about far better than ordinary words, so they count double.
 * A shared figure ("from 497,099 a year earlier") is a strong sign two sentences
 * describe the same fact, even when another figure in them disagrees.
 */
function weightedTerms(text: string): Map<string, number> {
    const terms = new Map<string, number>();
    for (const word of text.match(/[\p{L}][\p{L}'’-]*/gu) ?? []) {
        const term = word.toLowerCase().replace(/['’]s$/, '');
        if (term.length < 3 || STOPWORDS.has(term)) continue;
        const isName = word[0] !== word[0].toLowerCase();
        terms.set(term, Math.max(terms.get(term) ?? 0, isName ? 2 : 1));
    }
    for (const figure of text.match(/\d[\d,.]*\d|\d/g) ?? []) {
        terms.set(figure.replace(/,/g, ''), 2);
    }
    return terms;
}
