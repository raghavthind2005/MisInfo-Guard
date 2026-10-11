import { Verdict } from '../verify/judge';
import { FigureMismatch } from '../verify/numbers';

export interface VerifiedClaim {
    status: 'ok';
    claim: string;
    verdict: Verdict;
    /** Exact words from the source that back the verdict. Null when the verdict is UNCLEAR. */
    quote: string | null;
    source: { url: string; title: string } | null;
    /** A figure the article and the source state differently, found by comparing the numbers in code. */
    figures?: FigureMismatch;
}

export interface FailedClaim {
    /** 'setup' means API keys are missing; 'error' covers network and provider failures. */
    status: 'setup' | 'error';
    claim: string;
    message: string;
}

export type VerificationResult = VerifiedClaim | FailedClaim;
