/**
 * The fact-check memory: human fact-checks with one embedding each, searched
 * locally so that known false claims can be recognised without any API call.
 */

export interface FactCheck {
    /** The claim as the fact-checker worded it. */
    text: string;
    /** The publisher's own rating, e.g. "False" or "Missing context". */
    rating: string;
    category: 'false' | 'misleading' | 'other';
    publisher: string;
    url: string;
    date: string;
}

export interface IndexManifest {
    builtAt: string;
    count: number;
    dimensions: number;
    /** Stored int8 values are the original floats multiplied by this. */
    scale: number;
}

export interface MemoryMatch {
    factCheck: FactCheck;
    /** Cosine similarity between the page sentence and the fact-checked claim, 0-1. */
    similarity: number;
}

/** [text, rating, category, publisher, url, date], as written by the build script. */
export type ClaimRow = [string, string, FactCheck['category'], string, string, string];

/** Query components are scaled to integers by this factor before the scan. */
const QUERY_SCALE = 4096;

export class FactCheckIndex {
    constructor(
        readonly manifest: IndexManifest,
        private claims: ClaimRow[],
        private vectors: Int8Array,
    ) {
        if (manifest.dimensions % 4 !== 0) {
            throw new Error('Fact-check index dimensions must be a multiple of 4');
        }
        if (vectors.length !== manifest.count * manifest.dimensions || claims.length !== manifest.count) {
            throw new Error('Fact-check index is corrupt: sizes do not match the manifest');
        }
    }

    /**
     * Returns the closest fact-check to a normalized query embedding,
     * or null when nothing reaches minSimilarity.
     */
    search(query: Float32Array, minSimilarity: number): MemoryMatch | null {
        const { count, dimensions, scale } = this.manifest;
        const vectors = this.vectors;

        // Integer arithmetic over the whole index is markedly faster than float maths in JS engines
        const fixed = new Int32Array(dimensions);
        for (let d = 0; d < dimensions; d++) {
            fixed[d] = Math.round(query[d] * QUERY_SCALE);
        }
        const toSimilarity = 1 / (QUERY_SCALE * scale);

        let best = -1;
        let bestScore = Math.floor(minSimilarity / toSimilarity);

        for (let i = 0, offset = 0; i < count; i++, offset += dimensions) {
            let score = 0;
            for (let d = 0; d < dimensions; d += 4) {
                score = (score
                    + fixed[d] * vectors[offset + d]
                    + fixed[d + 1] * vectors[offset + d + 1]
                    + fixed[d + 2] * vectors[offset + d + 2]
                    + fixed[d + 3] * vectors[offset + d + 3]) | 0;
            }
            if (score > bestScore) {
                bestScore = score;
                best = i;
            }
        }

        if (best === -1) return null;
        const [text, rating, category, publisher, url, date] = this.claims[best];
        return {
            factCheck: { text, rating, category, publisher, url, date },
            similarity: Math.min(1, bestScore * toSimilarity),
        };
    }
}
