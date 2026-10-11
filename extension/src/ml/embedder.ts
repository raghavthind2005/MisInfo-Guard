import { pipeline } from '@xenova/transformers';
import './modelLoader'; // configures local model and WASM paths

/**
 * Sentence embeddings for the fact-check memory.
 * Must stay the same model the index was built with (scripts/build_factcheck_index.py).
 */

const MODEL_ID = 'all-MiniLM-L6-v2';
const BATCH_SIZE = 8;

let extractor: Promise<any> | null = null;

function getExtractor() {
    if (!extractor) {
        extractor = pipeline('feature-extraction', MODEL_ID, { quantized: true }).catch(err => {
            extractor = null;
            throw err;
        });
    }
    return extractor;
}

/**
 * Returns one normalized embedding per input text.
 */
export async function embedTexts(texts: string[]): Promise<Float32Array[]> {
    const extract = await getExtractor();
    const embeddings: Float32Array[] = [];

    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
        const batch = texts.slice(start, start + BATCH_SIZE);
        const output = await extract(batch, { pooling: 'mean', normalize: true });
        const dimensions = output.dims[1];
        for (let i = 0; i < batch.length; i++) {
            embeddings.push(output.data.slice(i * dimensions, (i + 1) * dimensions));
        }
    }
    return embeddings;
}
