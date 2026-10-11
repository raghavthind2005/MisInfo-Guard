import { describe, expect, it } from 'vitest';
import { ClaimRow, FactCheckIndex, IndexManifest } from '../src/memory/factCheckIndex';
import { cacheKey } from '../src/verify/cache';
import { extractJson } from '../src/llm/provider';

const DIMENSIONS = 4;
const SCALE = 100;
const manifest: IndexManifest = { builtAt: '2026-10-11T00:00:00Z', count: 3, dimensions: DIMENSIONS, scale: SCALE };
const claims: ClaimRow[] = [
    ['Claim A', 'False', 'false', 'Snopes', 'https://snopes.com/a', '2026-01-01'],
    ['Claim B', 'Misleading', 'misleading', 'AFP', 'https://afp.com/b', '2026-02-02'],
    ['Claim C', 'False', 'false', 'Full Fact', 'https://fullfact.org/c', ''],
];
// Unit vectors along three axes, stored as int8 at the manifest's scale
const vectors = new Int8Array([SCALE, 0, 0, 0, 0, SCALE, 0, 0, 0, 0, SCALE, 0]);
const index = new FactCheckIndex(manifest, claims, vectors);

describe('FactCheckIndex', () => {
    it('returns the closest fact-check with its similarity', () => {
        const match = index.search(new Float32Array([0, 1, 0, 0]), 0.5);
        expect(match?.factCheck).toMatchObject({ text: 'Claim B', rating: 'Misleading', publisher: 'AFP', url: 'https://afp.com/b' });
        expect(match?.similarity).toBeCloseTo(1, 2);
    });

    it('scores partial matches by cosine similarity', () => {
        const match = index.search(new Float32Array([0.6, 0.8, 0, 0]), 0.5);
        expect(match?.factCheck.text).toBe('Claim B');
        expect(match?.similarity).toBeCloseTo(0.8, 2);
    });

    it('returns null when nothing reaches the threshold', () => {
        expect(index.search(new Float32Array([0, 0, 0, 1]), 0.5)).toBeNull();
        expect(index.search(new Float32Array([0.6, 0.8, 0, 0]), 0.9)).toBeNull();
    });

    it('rejects data that does not match its manifest', () => {
        expect(() => new FactCheckIndex(manifest, claims, new Int8Array(8))).toThrow(/corrupt/);
        expect(() => new FactCheckIndex({ ...manifest, count: 2 }, claims, vectors.slice(0, 8))).toThrow(/corrupt/);
    });
});

describe('cacheKey', () => {
    it('is the same for copies that differ only in case, spacing and punctuation', () => {
        expect(cacheKey('  Tesla delivered 1.8 million vehicles, in 2023! ')).toBe(cacheKey('tesla delivered 1.8 million vehicles in 2023'));
        expect(cacheKey('Tesla delivered 1.8 million')).not.toBe(cacheKey('Tesla delivered 4.5 million'));
    });
});

describe('extractJson', () => {
    it('finds the object inside code fences or surrounding prose', () => {
        expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
        expect(extractJson('Here you go: {"a": {"b": 2}} hope that helps')).toEqual({ a: { b: 2 } });
        expect(() => extractJson('nothing')).toThrow();
    });
});
