import { describe, expect, it } from 'vitest';
import { CoverageArticle, coverageWindow, headlineQuery, matchCoverage, splitSentences } from '../src/verify/coverage';

const article: CoverageArticle = {
    url: 'https://www.cnbc.com/tesla',
    title: 'Tesla Q3 deliveries',
    publishedAt: '2026-10-02',
    text: 'Tesla reports 486,532 vehicle deliveries for third quarter, topping expectations.\n'
        + 'Deliveries fell about 2% from 497,099 a year earlier, but climbed from the second quarter. '
        + 'Analysts were expecting around 461,100 deliveries, according to StreetAccount\'s consensus. '
        + '[Read more about our newsletter here](https://example.com/newsletter-sign-up-page-link).',
};

describe('headlineQuery', () => {
    it('drops the site name from a page title', () => {
        expect(headlineQuery('Tesla quarterly deliveries fall more than expected - BBC News')).toBe('Tesla quarterly deliveries fall more than expected');
        expect(headlineQuery('Reuters | Tesla quarterly deliveries fall more than expected')).toBe('Tesla quarterly deliveries fall more than expected');
    });

    it('refuses titles too short to identify a story', () => {
        expect(headlineQuery('Home | Reuters')).toBeNull();
    });
});

describe('coverageWindow', () => {
    it('spans a few days before to ten days after publication', () => {
        expect(coverageWindow('2026-10-02T18:30:00Z')).toEqual({ start: '2026-09-29', end: '2026-10-12' });
    });

    it('rejects an unreadable date', () => {
        expect(coverageWindow('last Tuesday')).toBeNull();
    });
});

describe('splitSentences', () => {
    it('drops fragments and markdown page furniture', () => {
        const sentences = splitSentences(article.text);
        expect(sentences).toHaveLength(3);
        expect(sentences.some(s => s.includes('newsletter'))).toBe(false);
    });
});

describe('matchCoverage', () => {
    it('finds the passage about the same fact and notices a differing figure', () => {
        const match = matchCoverage('Deliveries rose about 12% from 497,099 a year earlier, the company said on Friday.', [article]);
        expect(match?.evidence[0].text).toContain('Deliveries fell about 2% from 497,099');
        expect(match?.figuresDiffer).toBe(true);
    });

    it('reports agreement when the figures match', () => {
        const match = matchCoverage('Tesla reported 486,532 vehicle deliveries for the third quarter, topping expectations.', [article]);
        expect(match?.figuresDiffer).toBe(false);
        expect(match?.evidence[0].url).toBe('https://www.cnbc.com/tesla');
    });

    it('returns nothing for a sentence the coverage does not discuss', () => {
        expect(matchCoverage('The city council approved a new library budget on Monday.', [article])).toBeNull();
        expect(matchCoverage('Tesla reported 486,532 vehicle deliveries.', [])).toBeNull();
    });
});
