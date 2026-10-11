import { VerificationResult } from '../api/types';
import { matchFactChecks, resetIndex } from '../memory/match';
import { detectClaims } from '../ml/claimDetector';
import { loadSettings } from '../settings';
import { analyzePage } from '../verify/analyzePage';
import { verifyClaim } from '../verify/verifyClaim';

/**
 * Background Service Worker
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'VERIFY_CLAIM') {
        handleVerifyClaim(message.claim).then(sendResponse);
        return true;
    }

    if (message.type === 'ANALYZE_PAGE') {
        loadSettings()
            .then(settings => analyzePage(settings, message.page, message.claims))
            .then(sendResponse)
            .catch(err => {
                console.error('❌ Background Page Analysis Error:', err);
                sendResponse([]);
            });
        return true;
    }

    if (message.type === 'DETECT_CLAIMS') {
        detectClaims(message.texts).then(sendResponse).catch(err => {
            console.error('❌ Background Detection Error:', err);
            sendResponse([]); // Return empty on error
        });
        return true;
    }

    if (message.type === 'MATCH_FACT_CHECKS') {
        matchFactChecks(message.texts).then(sendResponse).catch(err => {
            console.error('❌ Background Fact-check Match Error:', err);
            sendResponse(message.texts.map(() => null));
        });
        return true;
    }

    if (message.type === 'INDEX_UPDATED') {
        resetIndex();
    }

    if (message.type === 'OPEN_OPTIONS') {
        chrome.runtime.openOptionsPage();
    }
});

async function handleVerifyClaim(claim: string): Promise<VerificationResult> {
    const settings = await loadSettings();
    return verifyClaim(settings, claim);
}
