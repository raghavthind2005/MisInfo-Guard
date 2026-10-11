import { TextSegment } from './extractor';
import { MemoryMatch } from '../memory/factCheckIndex';
import { ClaimOutcome } from '../verify/analyzePage';
import { apiClient } from '../api/client';
import { VerificationResult } from '../api/types';
import { tooltip } from './tooltip';

/**
 * What we currently know about a highlighted sentence. The tooltip and the
 * highlight colour are both derived from this.
 */
export type HighlightState =
    /** A detected claim nothing has been spent on yet. */
    | { kind: 'unchecked' }
    /** Resembles a published fact-check, by local similarity only. */
    | { kind: 'similar'; match: MemoryMatch }
    /** The model confirmed it makes the same claim as a published fact-check. */
    | { kind: 'factcheck'; match: MemoryMatch }
    | { kind: 'checking' }
    | { kind: 'verified'; result: VerificationResult };

export interface HighlightItem {
    segment: TextSegment;
    state: HighlightState;
    /** Wrap the sentence without any visible styling until an outcome arrives. */
    hidden?: boolean;
}

const STATE_CLASSES = ['misinfo-hidden', 'misinfo-memory', 'border-false', 'border-true'];
const highlights = new Map<string, { wrapper: HTMLElement; text: string; state: HighlightState; hidden: boolean }>();

/**
 * Highlights sentences in the DOM.
 */
export function highlightClaims(items: HighlightItem[]) {
    // 1. Group items by their underlying DOM Node
    const nodeMap = new Map<Node, HighlightItem[]>();

    items.forEach(item => {
        if (item.segment.element.parentElement) {
            const list = nodeMap.get(item.segment.element) || [];
            list.push(item);
            nodeMap.set(item.segment.element, list);
        }
    });

    // 2. Process each Node once
    nodeMap.forEach((nodeItems, node) => {
        const parent = node.parentElement;
        if (!parent || parent.classList.contains('misinfo-highlight')) return;

        const originalText = node.textContent || '';
        const fragment = document.createDocumentFragment();

        // We need to split the original text by the claims it contains
        // For simplicity, we'll sort the claims by their position in the string
        const sorted = nodeItems
            .map(item => ({ item, start: originalText.indexOf(item.segment.text) }))
            .filter(info => info.start !== -1)
            .sort((a, b) => a.start - b.start);

        let lastIndex = 0;

        sorted.forEach(({ item, start }) => {
            if (start < lastIndex) return; // overlaps the previous highlight

            // Append text before the claim
            if (start > lastIndex) {
                fragment.appendChild(document.createTextNode(originalText.substring(lastIndex, start)));
            }

            // Create the highlight span
            const wrapper = document.createElement('span');
            wrapper.className = 'misinfo-highlight';
            wrapper.textContent = item.segment.text;

            highlights.set(item.segment.id, { wrapper, text: item.segment.text, state: item.state, hidden: item.hidden ?? false });
            render(item.segment.id);
            attachListeners(wrapper, item.segment.id);

            fragment.appendChild(wrapper);
            lastIndex = start + item.segment.text.length;
        });

        // Append remaining text
        if (lastIndex < originalText.length) {
            fragment.appendChild(document.createTextNode(originalText.substring(lastIndex)));
        }

        // Replace the node with the fragment
        parent.replaceChild(fragment, node);
    });
}

/**
 * Re-applies highlights the page has thrown away. Sites built with client-side
 * frameworks often re-render their text after loading, which silently removes
 * our wrappers; what we learned about each sentence is kept and drawn again.
 */
export function restoreLostHighlights(segments: TextSegment[]) {
    const lost = new Map<string, string>();
    highlights.forEach((entry, id) => {
        if (!entry.wrapper.isConnected) lost.set(entry.text, id);
    });
    if (lost.size === 0) return;

    const items: HighlightItem[] = [];
    for (const segment of segments) {
        const id = lost.get(segment.text);
        if (!id) continue;
        const entry = highlights.get(id)!;
        lost.delete(segment.text);
        // Keep the original id, so a check still in flight lands on the new wrapper
        items.push({ segment: { ...segment, id }, state: entry.state, hidden: entry.hidden });
    }
    highlightClaims(items);
}

/** True when the page has removed at least one of our highlights. */
export function hasLostHighlights(): boolean {
    for (const entry of highlights.values()) {
        if (!entry.wrapper.isConnected) return true;
    }
    return false;
}

/**
 * Applies the result of automatic checking to an existing highlight.
 * Returns true when the sentence ends up drawn to the reader's attention:
 * flagged red, or left amber as similar to a published fact-check.
 */
export function applyOutcome(outcome: ClaimOutcome): boolean {
    const entry = highlights.get(outcome.id);
    if (!entry) return false;

    switch (outcome.kind) {
        case 'verified':
            entry.state = { kind: 'verified', result: outcome.result };
            break;
        case 'factcheck':
            entry.state = { kind: 'factcheck', match: outcome.match };
            break;
        case 'dismissed':
            entry.state = { kind: 'unchecked' };
            entry.hidden = true;
            render(outcome.id);
            return false;
        case 'unchecked':
            return entry.state.kind === 'similar';
    }
    entry.hidden = false;
    render(outcome.id);
    return isFlagged(entry.state);
}

function isFlagged(state: HighlightState): boolean {
    return state.kind === 'factcheck'
        || (state.kind === 'verified' && state.result.status === 'ok' && state.result.verdict === 'CONTRADICTED');
}

function render(id: string) {
    const entry = highlights.get(id);
    if (!entry) return;
    const { wrapper, state, hidden } = entry;

    wrapper.classList.remove(...STATE_CLASSES);
    if (hidden) {
        wrapper.classList.add('misinfo-hidden');
    } else if (state.kind === 'similar') {
        wrapper.classList.add('misinfo-memory');
    } else if (isFlagged(state)) {
        wrapper.classList.add('border-false');
    } else if (state.kind === 'verified' && state.result.status === 'ok' && state.result.verdict === 'SUPPORTED') {
        wrapper.classList.add('border-true');
    }
}

function attachListeners(wrapper: HTMLElement, id: string) {
    wrapper.addEventListener('mouseenter', () => {
        const entry = highlights.get(id);
        if (!entry || wrapper.classList.contains('misinfo-hidden')) return;

        tooltip.show(wrapper, entry.text, entry.state, () => checkNow(id));
    });

    wrapper.addEventListener('mouseleave', () => {
        tooltip.hide();
    });
}

/**
 * Runs a manual check the reader asked for from the tooltip.
 */
async function checkNow(id: string) {
    const entry = highlights.get(id);
    if (!entry) return;

    const refresh = () => tooltip.show(entry.wrapper, entry.text, entry.state, () => checkNow(id));

    entry.state = { kind: 'checking' };
    refresh();

    entry.state = { kind: 'verified', result: await apiClient.verifyClaim(entry.text) };
    render(id);
    if (tooltip.isOpen()) refresh();
}
