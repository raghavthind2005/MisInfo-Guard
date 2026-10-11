import { CoverageArticle } from '../verify/coverage';
import { Evidence } from '../verify/judge';
import { TRUSTED_DOMAINS } from './trustedDomains';

const TAVILY_URL = 'https://api.tavily.com/search';

export class SearchError extends Error {
    constructor(message: string, public status: number) {
        super(message);
        this.name = 'SearchError';
    }
}

/** Longest article text kept per result; later text rarely adds facts the opening lacks. */
const MAX_ARTICLE_LENGTH = 15000;

interface TavilyResult {
    url: string;
    title: string;
    content: string;
    raw_content?: string | null;
    published_date?: string;
}

async function search(apiKey: string, body: Record<string, unknown>): Promise<TavilyResult[]> {
    const response = await fetch(TAVILY_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ search_depth: 'basic', include_domains: TRUSTED_DOMAINS, ...body }),
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new SearchError(`Tavily returned ${response.status}: ${text.slice(0, 200)}`, response.status);
    }

    const data = await response.json() as { results?: TavilyResult[] };
    return data.results ?? [];
}

/**
 * Runs one Tavily search restricted to trusted domains.
 * A search costs one credit however many results it returns.
 *
 * With a date window, only news published inside it is returned. That is how
 * claims about a developing situation are checked: older reports of the same
 * story would otherwise look like contradictions.
 */
export async function searchEvidence(
    apiKey: string,
    query: string,
    window?: { start: string; end: string } | null,
): Promise<Evidence[]> {
    const results = await search(apiKey, {
        query,
        max_results: 5,
        ...(window ? { topic: 'news', start_date: window.start, end_date: window.end } : {}),
    });
    return results
        .filter(result => !window || isoDate(result.published_date) !== null)
        .map(result => ({
            url: result.url,
            title: result.title,
            text: result.content,
            ...(isoDate(result.published_date) ? { publishedAt: isoDate(result.published_date)! } : {}),
        }));
}

function isoDate(value: string | undefined): string | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/**
 * Fetches how trusted outlets covered a story, with article text, in one search.
 * Only news published around the page's own date is returned, and results from
 * the page's own site are dropped: an article is not evidence for itself.
 */
export async function searchCoverage(
    apiKey: string,
    headline: string,
    pageHost: string,
    window: { start: string; end: string },
): Promise<CoverageArticle[]> {
    const results = await search(apiKey, {
        query: headline,
        topic: 'news',
        start_date: window.start,
        end_date: window.end,
        max_results: 6,
        include_raw_content: true,
    });
    const ownSite = pageHost.replace(/^www\./, '');
    const articles: CoverageArticle[] = [];

    for (const result of results) {
        const publishedAt = isoDate(result.published_date);
        if (!publishedAt) continue;

        let host: string;
        try {
            host = new URL(result.url).hostname.replace(/^www\./, '');
        } catch {
            continue;
        }
        if (ownSite !== '' && (host === ownSite || host.endsWith(`.${ownSite}`))) continue;

        articles.push({
            url: result.url,
            title: result.title,
            text: (result.raw_content || result.content).slice(0, MAX_ARTICLE_LENGTH),
            publishedAt,
        });
    }
    return articles;
}
