import nlp from 'compromise';

export interface TextSegment {
    id: string;
    text: string;
    element: Node;
}

/**
 * Extracts readable text from the document.
 */
export function extractReadableText(root: HTMLElement): TextSegment[] {
    const segments: TextSegment[] = [];

    const IGNORE_TAGS = new Set([
        'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT',
        'NAV', 'FOOTER', 'HEADER', 'ASIDE', 'SVG', 'BUTTON', 'INPUT', 'TEXTAREA',
        'CODE', 'PRE'
    ]);

    function traverse(node: Node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;

            if (IGNORE_TAGS.has(el.tagName)) return;
            if (el.classList.contains('misinfo-highlight')) return; // SKIIP ALREADY HIGHLIGHTED
            if (el.classList.contains('misinfo-tooltip')) return; // our own tooltip is not page content
            // Text that is itself a link is a headline or teaser for another page, not this article's prose
            if (el.tagName === 'A' && (el.textContent || '').trim().length > 25) return;
            if (el.style.display === 'none' || el.style.visibility === 'hidden') return;
            if (el.getAttribute('aria-hidden') === 'true') return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent || '';
            const trimmed = text.trim();

            if (trimmed.length > 20) {
                const doc = nlp(trimmed);
                const sentences = doc.sentences().json() as any[];

                sentences.forEach((s: any) => {
                    const sentenceText = s.text.trim();
                    if (sentenceText.length > 25) {
                        const id = Math.random().toString(36).substr(2, 9);
                        segments.push({
                            id,
                            text: sentenceText,
                            element: node
                        });
                    }
                });
            }
        }

        node.childNodes.forEach(child => traverse(child));
    }

    traverse(root);
    return segments;
}

/**
 * Picks the element holding the article, so that sidebars, related-story
 * lists and comment threads are not scanned as if they were the article.
 * Falls back to the whole page when no single article container stands out.
 */
export function findArticleRoot(): HTMLElement {
    const MIN_ARTICLE_LENGTH = 1500;
    const articles = [...document.querySelectorAll<HTMLElement>('article')]
        .filter(el => (el.innerText || '').length >= MIN_ARTICLE_LENGTH);
    if (articles.length === 1) return articles[0];

    const main = document.querySelector<HTMLElement>('main, [role="main"]');
    if (main && (main.innerText || '').length >= MIN_ARTICLE_LENGTH) return main;

    return document.body;
}

/**
 * The page's headline as a segment. Headlines usually sit in a <header>,
 * which the body scan skips, yet the headline is often the main claim.
 */
export function extractHeadline(): TextSegment | null {
    const heading = document.querySelector('h1');
    if (!heading || heading.querySelector('.misinfo-highlight')) return null;

    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent || '').trim();
        if (text.length > 25) {
            return { id: Math.random().toString(36).substr(2, 9), text, element: node };
        }
    }
    return null;
}
