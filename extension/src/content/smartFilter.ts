import nlp from 'compromise';

/**
 * Smart Filter - a lightweight heuristic layer that drops text which cannot be a
 * factual claim (fragments, questions, opinions) before it reaches the claim model.
 */

// 1. Subjectivity Filters (Regex is faster than NLP)
const SUBJECTIVE_PATTERNS = [
    /^(I|We) (think|feel|believe|suppose|guess|reckon|hope)/i,
    /\b(in my opinion|to me|personally|from my perspective)\b/i,
    /\b(maybe|perhaps|possibly|probably|likely|unlikely|might|could be)\b/i,
    /\b(amazing|awesome|terrible|horrible|beautiful|ugly|wonderful|disgusting)\b/i,
    /\b(should|ought to|must necessarily)\b/i // Normative claims
];

// 2. Structural Filters
const MIN_LENGTH = 40; // Increased to filter out shorter, less likely claims

export interface SmartFilterResult {
    shouldCheck: boolean;
    reason?: string;
}

export function smartFilter(text: string): SmartFilterResult {
    const trimmed = text.trim();

    // --- Layer 1: Structural ---
    if (trimmed.length < MIN_LENGTH) {
        return { shouldCheck: false, reason: 'too_short' };
    }
    if (trimmed.endsWith('?')) {
        return { shouldCheck: false, reason: 'question' };
    }
    // Filter out obvious dialogue/quotes starters if they are too simple
    if (trimmed.startsWith('"') && trimmed.length < 60) {
        return { shouldCheck: false, reason: 'short_quote' };
    }

    // --- Layer 2: Subjectivity (Lexical) ---
    for (const pattern of SUBJECTIVE_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { shouldCheck: false, reason: 'subjective' };
        }
    }

    // --- Layer 3: Must have a Verb ---
    // Whether a sentence is check-worthy is left to the claim model. An earlier rule here required
    // named entities or numbers, but entity detection missed company names and dropped clear claims.
    if (!nlp(trimmed).verbs().found) {
        return { shouldCheck: false, reason: 'no_verb' };
    }

    return { shouldCheck: true };
}
