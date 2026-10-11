import ModelLoader from './modelLoader';

export interface ClaimPrediction {
    label: string;
    score: number;
    text: string;
}

/**
 * detectClaims - The main entry point for claim detection.
 * Automatically handles routing between Content Script and Background processes.
 */
export async function detectClaims(texts: string[]): Promise<ClaimPrediction[]> {
    if (texts.length === 0) return [];

    // 1. Check if we are in a Content Script or Background Worker
    // In Manifest V3, background workers have 'chrome.runtime' but NO 'document'
    const isBackground = typeof document === 'undefined';

    if (!isBackground) {
        // CONTENT SCRIPT: Send message to background to bypass CSP/WASM issues
        console.log('📡 Content: Delegating detection to background...');
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({
                type: 'DETECT_CLAIMS',
                texts
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error('❌ Content: Detection message failed:', chrome.runtime.lastError);
                    resolve([]);
                    return;
                }
                resolve(response || []);
            });
        });
    }

    // BACKGROUND WORKER: Run actual inference
    return runLocalInference(texts);
}

/**
 * Internal logic for running the ONNX model locally.
 * ONLY called in the background service worker context.
 */
async function runLocalInference(texts: string[]): Promise<ClaimPrediction[]> {
    const classifier = await ModelLoader.getInstance();

    if (!classifier) {
        throw new Error('Model failed to initialize');
    }

    console.log(`🧠 Background: Scanning ${texts.length} segments with AI...`);

    const results = await classifier(texts, {
        topk: 1
    });

    // Ensure results is an array (transformers.js can return single object for single text)
    const resultsArray = Array.isArray(results) ? results : [results];

    const predictions: ClaimPrediction[] = resultsArray.map((res: any, index: number) => ({
        label: res.label,
        score: res.score,
        text: texts[index]
    }));

    // Filter: Keep only high-confidence claims (LABEL_1 = check-worthy)
    const claims = predictions.filter(p =>
        (p.label === 'LABEL_1' || p.label === '1' || p.label === 'claim') &&
        p.score > 0.7
    );

    console.log(`✅ Background: Found ${claims.length} checkable claims.`);
    return claims;
}
