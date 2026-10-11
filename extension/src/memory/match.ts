import { embedTexts } from '../ml/embedder';
import { FactCheckIndex, MemoryMatch } from './factCheckIndex';
import { loadIndex } from './store';
import { CANDIDATE_THRESHOLD } from './thresholds';

let index: Promise<FactCheckIndex | null> | null = null;

/** Drops the in-memory index so the next lookup reloads it from storage. */
export function resetIndex() {
    index = null;
}

/**
 * Looks each sentence up in the local fact-check index.
 * Returns null for sentences with no candidate match, or when no index is installed.
 */
export async function matchFactChecks(texts: string[]): Promise<(MemoryMatch | null)[]> {
    if (!index) index = loadIndex();
    const loaded = await index;
    if (!loaded || texts.length === 0) return texts.map(() => null);

    const embeddings = await embedTexts(texts);
    return embeddings.map(embedding => loaded.search(embedding, CANDIDATE_THRESHOLD));
}
