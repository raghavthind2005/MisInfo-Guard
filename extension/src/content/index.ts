import { extractHeadline, extractReadableText, findArticleRoot, TextSegment } from './extractor';
import { detectClaims } from '../ml/claimDetector';
import { HighlightItem, applyOutcome, hasLostHighlights, highlightClaims, restoreLostHighlights } from './highlighter';
import { DISPLAY_THRESHOLD } from '../memory/thresholds';
import { ClaimOutcome, PageClaim } from '../verify/analyzePage';
import { MemoryMatch } from '../memory/factCheckIndex';
import { smartFilter } from './smartFilter';
import './styles.css';

/**
 * MisInfo Guard - Content Script Orchestrator
 */

if (window !== window.top) {
    // Silent return for iframes
} else {
    console.log('🚀 MisInfo Guard: Content Script LOADED');
}

let isRunning = false;
let hasInitialScan = false;
let observer: MutationObserver | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let isEnabled = true;

/** Sentence texts already scanned on this page. */
const processed = new Set<string>();
/** Upper bound on sentences embedded per scan, to keep the page responsive. */
const MAX_MEMORY_LOOKUPS = 80;
/** Claims sent to the model in one automatic check. */
const MAX_CLAIMS_PER_ANALYSIS = 12;
/** Automatic checks per page load. One, so the per-article search limit holds however often the page changes. */
const MAX_ANALYSES_PER_PAGE = 1;
/** How long the reader must stay before an automatic check is spent on the page. */
const DWELL_MS = 4000;
let analysesStarted = 0;

async function init() {
    const data = await chrome.storage.local.get(['isEnabled']);
    isEnabled = data.isEnabled !== false;

    if (isEnabled) {
        setup();
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (message.type === 'TOGGLE_EXTENSION') {
            isEnabled = message.isEnabled;
            if (isEnabled) {
                console.log('🛡️ MisInfo Guard: Enabled');
                setup();
            } else {
                console.log('💤 MisInfo Guard: Disabled');
                cleanup();
            }
        }
    });
}

function setup() {
    if (document.visibilityState === 'visible') {
        handleVisibilityChange();
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
}

function cleanup() {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    stopObserver();
}

async function scanPage() {
    if (isRunning || !isEnabled) return;
    isRunning = true;

    try {
        // Rescans are triggered by DOM changes, so only look at sentences we have not handled yet
        const headline = extractHeadline();
        const all = [
            ...(headline ? [headline] : []),
            ...extractReadableText(findArticleRoot()).filter(seg => seg.text !== headline?.text),
        ];
        restoreLostHighlights(all);
        const segments = all.filter(seg => !processed.has(seg.text));
        segments.forEach(seg => processed.add(seg.text));
        if (segments.length === 0) return;

        const memoryCandidates = segments.filter(isMemoryCandidate).slice(0, MAX_MEMORY_LOOKUPS);
        const claimCandidates = segments.filter(seg => seg !== headline && smartFilter(seg.text).shouldCheck);

        const [matches, claims] = await Promise.all([
            matchFactChecks(memoryCandidates.map(s => s.text)),
            detectClaims(claimCandidates.map(s => s.text)),
        ]);

        // A fact-check match takes priority over a plain detected claim for the same sentence
        const items = new Map<string, HighlightItem>();
        const pageClaims: PageClaim[] = [];
        memoryCandidates.forEach((segment, i) => {
            const match = matches[i];
            if (!match) return;
            const shown = match.similarity >= DISPLAY_THRESHOLD;
            // Weaker candidates stay invisible unless the model later confirms them
            items.set(segment.id, { segment, state: shown ? { kind: 'similar', match } : { kind: 'unchecked' }, hidden: !shown });
            pageClaims.push({ id: segment.id, text: segment.text, factCheck: match });
        });

        // The headline is always checked first: it is usually the article's central claim
        const ranked = [
            ...(headline && segments.includes(headline) ? [headline] : []),
            ...[...claims].sort((a, b) => b.score - a.score).map(claim => claimCandidates.find(s => s.text === claim.text)),
        ];
        for (const segment of ranked) {
            if (!segment || items.has(segment.id)) continue;
            items.set(segment.id, { segment, state: { kind: 'unchecked' } });
            if (pageClaims.length < MAX_CLAIMS_PER_ANALYSIS) {
                pageClaims.push({ id: segment.id, text: segment.text });
            }
        }

        await addToStats(claimCandidates.length, 0);

        if (items.size > 0) {
            highlightClaims([...items.values()]);
        }
        if (pageClaims.length > 0) {
            scheduleAnalysis(pageClaims);
        }

        hasInitialScan = true;

    } catch (err) {
        console.error('Scan failed:', err);
    } finally {
        isRunning = false;
    }
}

/**
 * Sends claims for automatic checking once the reader has stayed on the page
 * for a moment, so tabs that are opened and closed straight away cost nothing.
 */
function scheduleAnalysis(claims: PageClaim[]) {
    if (analysesStarted >= MAX_ANALYSES_PER_PAGE) return;
    analysesStarted++;

    setTimeout(() => {
        if (!isEnabled || document.visibilityState !== 'visible') {
            analysesStarted--;
            return;
        }
        const page = { title: document.title, host: location.hostname, publishedAt: findPublishDate() };
        chrome.runtime.sendMessage({ type: 'ANALYZE_PAGE', page, claims }, async (outcomes: ClaimOutcome[]) => {
            if (chrome.runtime.lastError || !Array.isArray(outcomes)) return;
            const warnings = outcomes.filter(outcome => applyOutcome(outcome)).length;
            await addToStats(0, warnings);
            // If the page re-rendered while the check was running, draw the results on the new text
            if (hasLostHighlights()) scanPage();
        });
    }, DWELL_MS);
}

/**
 * Reads the article's publication date from the metadata news sites commonly provide.
 */
function findPublishDate(): string | null {
    const candidates: (string | null | undefined)[] = [
        document.querySelector('meta[property="article:published_time"]')?.getAttribute('content'),
        document.querySelector('meta[name="article:published_time"], meta[name="pubdate"], meta[name="publish-date"], meta[name="date"], meta[itemprop="datePublished"]')?.getAttribute('content'),
        document.querySelector('time[datetime]')?.getAttribute('datetime'),
    ];
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        candidates.push(script.textContent?.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1]);
    }

    for (const value of candidates) {
        if (value && !Number.isNaN(new Date(value).getTime())) return value;
    }
    return null;
}

async function addToStats(claimsChecked: number, warningsFound: number) {
    const stats = await chrome.storage.local.get(['claimsChecked', 'warningsFound']);
    await chrome.storage.local.set({
        claimsChecked: (stats.claimsChecked || 0) + claimsChecked,
        warningsFound: (stats.warningsFound || 0) + warningsFound,
    });
}

/**
 * Sentences worth looking up in the fact-check memory. This is deliberately
 * broader than the claim filter: a known hoax need not mention a name or number.
 */
function isMemoryCandidate(segment: TextSegment): boolean {
    const text = segment.text.trim();
    return text.length >= 40 && text.length <= 400 && !text.endsWith('?');
}

/**
 * Asks the background worker to look sentences up in the local fact-check index.
 */
function matchFactChecks(texts: string[]): Promise<(MemoryMatch | null)[]> {
    if (texts.length === 0) return Promise.resolve([]);
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'MATCH_FACT_CHECKS', texts }, (response) => {
            if (chrome.runtime.lastError || !Array.isArray(response)) {
                resolve(texts.map(() => null));
                return;
            }
            resolve(response);
        });
    });
}

function startObserver() {
    if (observer || !isEnabled) return;

    observer = new MutationObserver((mutations) => {
        // DEFENSIVE: Ignore mutations that look like they were caused by our highlighter
        const significantMutation = mutations.some(m => {
            if (m.target instanceof HTMLElement) {
                if (m.target.classList.contains('misinfo-highlight') ||
                    m.target.classList.contains('misinfo-tooltip')) {
                    return false;
                }
            }
            return true;
        });

        if (!significantMutation) return;

        if (debounceTimer) clearTimeout(debounceTimer);

        debounceTimer = setTimeout(() => {
            if (document.visibilityState === 'visible' && isEnabled) {
                scanPage();
            }
        }, 2000);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: false // avoid triggering on minor text changes
    });
}

function stopObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

function handleVisibilityChange() {
    if (document.visibilityState === 'visible' && isEnabled) {
        if (!hasInitialScan) {
            scanPage();
        }
        startObserver();
    } else {
        stopObserver();
    }
}

init();
