/**
 * Pulls figures out of text and compares them in code, so a disagreement
 * between an article and a source can be shown as two concrete numbers.
 */

export interface Quantity {
    value: number;
    kind: 'percent' | 'money' | 'count';
    /** The figure as written, e.g. "$4.5 billion" or "38%". */
    raw: string;
}

export interface FigureMismatch {
    article: string;
    source: string;
}

const MAGNITUDES: Record<string, number> = {
    thousand: 1e3, k: 1e3,
    lakh: 1e5,
    million: 1e6, m: 1e6, mn: 1e6,
    crore: 1e7,
    billion: 1e9, bn: 1e9, b: 1e9,
    trillion: 1e12, tn: 1e12,
};

const NUMBER = /(?:([$€£₹])\s?)?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(%|percent\b|per cent\b)|\s?(thousand|million|billion|trillion|lakh|crore|mn|bn|tn|[kmb])\b)?(\s(?:dollars|euros|pounds|rupees)\b)?/gi;
const MONTH = /(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\.?$/i;
const MONTH_AFTER = /^\s(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;

/** Two figures within this relative distance are treated as the same number, allowing for rounding. */
const SAME_TOLERANCE = 0.05;
/** Counts and amounts further apart than this factor are assumed to measure different things. */
const COMPARABLE_FACTOR = 5;

export function extractQuantities(text: string): Quantity[] {
    const quantities: Quantity[] = [];

    for (const match of text.matchAll(NUMBER)) {
        const [raw, currency, whole, fraction, percent, magnitude, currencyWord] = match;
        const start = match.index ?? 0;
        const plain = !currency && !percent && !magnitude && !currencyWord;
        const base = Number(whole.replace(/,/g, '') + (fraction ?? ''));

        if (plain) {
            // Years and days of the month are dates, not quantities
            if (!fraction && !whole.includes(',') && base >= 1900 && base <= 2100) continue;
            const before = text.slice(Math.max(0, start - 12), start).trimEnd();
            const after = text.slice(start + raw.length, start + raw.length + 12);
            if (base <= 31 && (MONTH.test(before) || MONTH_AFTER.test(after))) continue;
            // A digit glued to letters ("COVID-19", "5G", "Q3") is a name
            if (/[A-Za-z-]$/.test(text.slice(Math.max(0, start - 1), start)) || /^[A-Za-z]/.test(after)) continue;
        }

        quantities.push({
            value: base * (magnitude ? MAGNITUDES[magnitude.toLowerCase()] : 1),
            kind: percent ? 'percent' : currency || currencyWord ? 'money' : 'count',
            raw: raw.trim(),
        });
    }
    return quantities;
}

/**
 * Finds a figure in the article sentence that the source states differently.
 * Returns null when the two agree or have no comparable figures.
 */
export function compareFigures(articleText: string, sourceText: string): FigureMismatch | null {
    const sourceQuantities = extractQuantities(sourceText);

    for (const claimed of extractQuantities(articleText)) {
        const sameKind = sourceQuantities.filter(q => q.kind === claimed.kind);
        if (sameKind.length === 0) continue;

        const closest = sameKind.reduce((best, q) => (distance(q, claimed) < distance(best, claimed) ? q : best));
        if (isSame(claimed, closest)) continue;

        const factor = Math.max(claimed.value, closest.value) / Math.max(Math.min(claimed.value, closest.value), 1e-9);
        if (claimed.kind === 'percent' || factor <= COMPARABLE_FACTOR) {
            return { article: claimed.raw, source: closest.raw };
        }
    }
    return null;
}

function distance(a: Quantity, b: Quantity): number {
    return Math.abs(Math.log((a.value + 1e-9) / (b.value + 1e-9)));
}

function isSame(a: Quantity, b: Quantity): boolean {
    if (a.kind === 'percent' && Math.abs(a.value - b.value) <= 0.5) return true;
    return Math.abs(a.value - b.value) <= SAME_TOLERANCE * Math.max(a.value, b.value);
}
