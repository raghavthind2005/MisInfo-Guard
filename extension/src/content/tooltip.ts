import { VerificationResult } from '../api/types';
import { MemoryMatch } from '../memory/factCheckIndex';
import { HighlightState } from './highlighter';
import { Verdict } from '../verify/judge';

/**
 * Tooltip UI Component for MisInfo Guard
 * Shows what is known about a highlighted sentence on hover.
 *
 * Everything is built with DOM nodes and textContent: page text, search
 * snippets and model output are untrusted and must never be parsed as HTML.
 */

const HIDE_DELAY_MS = 250;
/** Space between the sentence and the tooltip, and between the tooltip and the window edge. */
const GAP = 6;
const EDGE = 12;

const VERDICT_LABELS: Record<Verdict, { text: string; colorClass: string }> = {
    CONTRADICTED: { text: 'Sources contradict this', colorClass: 'color-false' },
    SUPPORTED: { text: 'Sources support this', colorClass: 'color-true' },
    UNCLEAR: { text: 'No clear evidence found', colorClass: 'color-neutral' },
};

export class TooltipManager {
    private tooltip: HTMLDivElement;
    private hideTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        this.tooltip = document.createElement('div');
        this.tooltip.className = 'misinfo-tooltip';
        this.tooltip.style.display = 'none';
        // Keep the tooltip open while the pointer is on it, so the source link is clickable
        this.tooltip.addEventListener('mouseenter', () => this.cancelHide());
        this.tooltip.addEventListener('mouseleave', () => this.hide());
        document.body.appendChild(this.tooltip);
    }

    /**
     * Shows what is known about a highlighted sentence.
     * onCheck is called when the reader asks for a manual check.
     */
    show(anchor: HTMLElement, text: string, state: HighlightState, onCheck: () => void) {
        this.open();
        this.fill(text, state, onCheck);
        this.place(anchor);
    }

    private fill(text: string, state: HighlightState, onCheck: () => void) {

        switch (state.kind) {
            case 'unchecked': {
                this.add('msg-header color-neutral', 'Not checked');
                this.add('msg-text', `"${truncate(text, 100)}"`);
                const button = this.add('msg-link', 'Check this claim (uses one search)', 'button') as HTMLButtonElement;
                button.type = 'button';
                button.addEventListener('click', onCheck);
                return;
            }
            case 'checking':
                this.add('msg-header', '🔍 Checking sources...');
                this.add('msg-text', `"${truncate(text, 100)}"`);
                return;
            case 'similar':
                this.showFactCheck(state.match, 'A similar claim was fact-checked', 'color-mixed', true);
                return;
            case 'factcheck':
                this.showFactCheck(state.match, 'Fact-checkers have disputed this claim', 'color-false', false);
                return;
            case 'verified':
                this.showResult(state.result);
        }
    }

    isOpen(): boolean {
        return this.tooltip.style.display !== 'none';
    }

    /**
     * Shows a human fact-check. The reader sees the fact-checker's own
     * wording and rating, so they can judge the match themselves.
     */
    private showFactCheck(match: MemoryMatch, title: string, colorClass: string, showSimilarity: boolean) {
        const { factCheck } = match;

        this.add(`msg-header ${colorClass}`, title);
        this.add('msg-text', `"${truncate(factCheck.text, 220)}"`);

        const rated = this.add('msg-source', 'Rated ');
        const rating = document.createElement('b');
        rating.textContent = factCheck.rating || 'disputed';
        rated.append(rating, ` by ${factCheck.publisher}${factCheck.date ? `, ${factCheck.date}` : ''}`);

        this.addLink(factCheck.url, 'read the fact-check');
        if (showSimilarity) {
            this.add('msg-tier', `Matched on this device · ${Math.round(match.similarity * 100)}% similar`);
        }
    }

    private showResult(data: VerificationResult) {
        if (data.status !== 'ok') {
            this.add('msg-header color-neutral', data.status === 'setup' ? 'Setup needed' : 'Could not check this claim');
            this.add('msg-explanation', data.message);
            if (data.status === 'setup') {
                const button = this.add('msg-link', 'Open options', 'button') as HTMLButtonElement;
                button.type = 'button';
                button.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' }));
            }
            return;
        }

        const label = VERDICT_LABELS[data.verdict];
        this.add(`msg-header ${label.colorClass}`, label.text);
        this.add('msg-text', `"${truncate(data.claim, 100)}"`);

        if (data.figures) {
            const figures = this.add('msg-figures', 'This article: ');
            const article = document.createElement('b');
            article.textContent = data.figures.article;
            const source = document.createElement('b');
            source.textContent = data.figures.source;
            figures.append(article, ' · Source: ', source);
        }

        if (data.quote && data.source) {
            this.add('msg-explanation', `“${data.quote}”`);
            this.addLink(data.source.url, 'read the source');
        }
    }

    private open() {
        this.cancelHide();
        this.tooltip.style.display = 'block';
        this.tooltip.replaceChildren();
    }

    /**
     * Puts the tooltip just below the highlighted sentence, or above it when
     * there is no room below, and keeps it inside the window. It must never
     * cover the sentence it is describing.
     */
    private place(anchor: HTMLElement) {
        const rect = anchor.getBoundingClientRect();
        const firstLine = anchor.getClientRects()[0] ?? rect;
        const { offsetWidth: width, offsetHeight: height } = this.tooltip;

        const fitsBelow = rect.bottom + GAP + height <= window.innerHeight;
        const fitsAbove = rect.top - GAP - height >= 0;
        const top = fitsBelow || !fitsAbove ? rect.bottom + GAP : rect.top - GAP - height;
        const left = Math.max(EDGE, Math.min(firstLine.left, window.innerWidth - width - EDGE));

        this.tooltip.style.left = `${window.scrollX + left}px`;
        this.tooltip.style.top = `${window.scrollY + top}px`;
    }

    private addLink(href: string, label: string) {
        const url = safeHttpUrl(href);
        if (!url) return;
        const link = this.add('msg-link', `${url.hostname.replace(/^www\./, '')} — ${label}`, 'a') as HTMLAnchorElement;
        link.href = url.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
    }

    hide() {
        this.cancelHide();
        this.hideTimer = setTimeout(() => {
            this.tooltip.style.display = 'none';
        }, HIDE_DELAY_MS);
    }

    private cancelHide() {
        if (this.hideTimer) {
            clearTimeout(this.hideTimer);
            this.hideTimer = null;
        }
    }

    private add(className: string, text: string, tag = 'div'): HTMLElement {
        const el = document.createElement(tag);
        el.className = className;
        el.textContent = text;
        this.tooltip.appendChild(el);
        return el;
    }
}

function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}...` : text;
}

/** Only http(s) links are ever rendered, so a javascript: or data: URL cannot reach the page. */
function safeHttpUrl(value: string): URL | null {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
    } catch {
        return null;
    }
}

export const tooltip = new TooltipManager();
