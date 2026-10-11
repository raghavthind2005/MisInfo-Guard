import { VerificationResult } from './types';

/**
 * ApiClient - Refactored to deduplicate requests and cache results.
 */
export class ApiClient {
    private cache = new Map<string, VerificationResult>();
    private pending = new Map<string, Promise<VerificationResult>>();

    /**
     * Send a claim to the background script for verification.
     * Includes strict deduplication to prevent "barrage" of requests.
     */
    async verifyClaim(claim: string): Promise<VerificationResult> {
        const trimmedClaim = claim.trim();

        // 1. Check Local Cache
        if (this.cache.has(trimmedClaim)) {
            return this.cache.get(trimmedClaim)!;
        }

        // 2. Deduplicate simultaneous requests for the same text
        if (this.pending.has(trimmedClaim)) {
            return this.pending.get(trimmedClaim)!;
        }

        // 3. Create new request
        const requestPromise = new Promise<VerificationResult>((resolve) => {
            chrome.runtime.sendMessage({
                type: 'VERIFY_CLAIM',
                claim: trimmedClaim
            }, (response: VerificationResult) => {
                if (chrome.runtime.lastError || !response) {
                    console.error('❌ ApiClient: Background message failed:', JSON.stringify(chrome.runtime.lastError));
                    resolve({
                        status: 'error',
                        claim: trimmedClaim,
                        message: 'The extension background process did not respond.'
                    });
                    return;
                }

                // Only successful verdicts are cached, so setup and network failures can be retried
                if (response.status === 'ok') {
                    this.cache.set(trimmedClaim, response);
                }
                resolve(response);
            });
        }).finally(() => {
            this.pending.delete(trimmedClaim);
        });

        this.pending.set(trimmedClaim, requestPromise);
        return requestPromise;
    }
}

export const apiClient = new ApiClient();
