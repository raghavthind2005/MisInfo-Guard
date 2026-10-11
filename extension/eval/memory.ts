/**
 * Calibrates the fact-check memory against a locally built index.
 *
 *   python scripts/build_factcheck_index.py --out factcheck-index
 *   npm run eval:memory -- --index ../factcheck-index
 *
 * Probes marked "match" are well-known false claims reworded the way an article
 * would state them; a fact-check of the same claim should be found. Probes marked
 * "none" are ordinary news sentences and true claims that must not be matched.
 */
import { env, pipeline } from '@xenova/transformers';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FactCheckIndex } from '../src/memory/factCheckIndex';

const HERE = dirname(fileURLToPath(import.meta.url));
const THRESHOLDS = [0.7, 0.75, 0.8, 0.85, 0.9];

const indexArg = process.argv[process.argv.indexOf('--index') + 1];
const indexDir = resolve(process.argv.includes('--index') ? indexArg : join(HERE, '..', '..', 'factcheck-index'));
const verbose = process.argv.includes('--verbose');

const vectors = readFileSync(join(indexDir, 'vectors.bin'));
const index = new FactCheckIndex(
    JSON.parse(readFileSync(join(indexDir, 'manifest.json'), 'utf8')),
    JSON.parse(readFileSync(join(indexDir, 'claims.json'), 'utf8')),
    new Int8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength),
);

interface Probe { text: string; expect: 'match' | 'none' }
const probes: Probe[] = JSON.parse(readFileSync(join(HERE, 'memory-probes.json'), 'utf8'));
const claims: { text: string; label: string }[] = JSON.parse(readFileSync(join(HERE, 'claims.json'), 'utf8'));
// True claims from the main evaluation set double as extra "must not match" probes
probes.push(...claims.filter(c => c.label === 'true').map(c => ({ text: c.text, expect: 'none' as const })));

env.allowRemoteModels = false;
env.localModelPath = join(HERE, '..', 'public', 'models') + '/';
const extract = await pipeline('feature-extraction', 'all-MiniLM-L6-v2', { quantized: true });

const results: { probe: Probe; similarity: number; matched: string }[] = [];
for (const probe of probes) {
    const output = await extract(probe.text, { pooling: 'mean', normalize: true });
    const started = performance.now();
    const match = index.search(output.data as Float32Array, 0);
    if (results.length === 0) console.log(`Search over ${index.manifest.count} fact-checks: ${(performance.now() - started).toFixed(0)} ms per sentence`);
    results.push({ probe, similarity: match?.similarity ?? 0, matched: match ? `${match.factCheck.text} [${match.factCheck.rating} | ${match.factCheck.publisher}]` : '' });
}

const should = results.filter(r => r.probe.expect === 'match');
const shouldNot = results.filter(r => r.probe.expect === 'none');
console.log(`\n| Threshold | Known false claims surfaced (of ${should.length}) | Other sentences surfaced (of ${shouldNot.length}) |`);
console.log('|---|---|---|');
for (const t of THRESHOLDS) {
    console.log(`| ${t.toFixed(2)} | ${should.filter(r => r.similarity >= t).length} | ${shouldNot.filter(r => r.similarity >= t).length} |`);
}

if (verbose) {
    for (const r of [...results].sort((a, b) => b.similarity - a.similarity)) {
        console.log(`\n${r.similarity.toFixed(2)} ${r.probe.expect.padEnd(5)} ${r.probe.text.slice(0, 90)}\n       -> ${r.matched.slice(0, 150)}`);
    }
}
