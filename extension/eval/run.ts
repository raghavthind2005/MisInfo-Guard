/**
 * Evaluation harness for the verification pipeline.
 *
 *   npm run eval -- --env ../.env --providers gemini,sarvam
 *
 * Triage is scored on every claim in claims.json. The evidence judge is scored
 * on the claims marked "judge": true, using one Tavily search each. Search
 * results are cached in eval/.cache so reruns do not spend credits.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LlmConfig, LlmError, PROVIDER_PRESETS, ProviderId } from '../src/llm/provider';
import { searchEvidence } from '../src/search/tavily';
import { Evidence, Judgement, judgeClaims } from '../src/verify/judge';
import { TriageScore, triageClaims } from '../src/verify/triage';

interface EvalClaim {
    id: number;
    category: string;
    label: 'true' | 'false' | 'unknowable';
    text: string;
    source?: string;
    judge?: boolean;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(HERE, '.cache');
const SEARCH_CACHE = join(CACHE_DIR, 'search.json');
const FLAG_THRESHOLD = 70;
const TRIAGE_BATCH = 14;
const JUDGE_BATCH = 4;
const KEY_NAMES: Record<ProviderId, string> = { gemini: 'GEMINI_API_KEY', sarvam: 'SARVAM_API_KEY' };

const args = parseArgs(process.argv.slice(2));
const env = loadEnv(resolve(args.env ?? join(HERE, '..', '..', '.env')));
const claims: EvalClaim[] = JSON.parse(readFileSync(join(HERE, 'claims.json'), 'utf8'));
const providers = (args.providers ?? 'gemini').split(',') as ProviderId[];

for (const id of providers) {
    const preset = PROVIDER_PRESETS[id];
    const apiKey = env[KEY_NAMES[id]];
    if (!preset || !apiKey) {
        console.log(`\nSkipping ${id}: unknown provider or ${KEY_NAMES[id]} not set`);
        continue;
    }
    const llm: LlmConfig = { ...preset, apiKey, model: args[`${id}-model`] ?? preset.model };
    console.log(`\n=== ${preset.label} (${llm.model}) ===`);

    await runTriage(llm);
    if (!('skip-judge' in args)) {
        await runJudge(llm);
    }
}

async function runTriage(llm: LlmConfig) {
    const order = shuffle(claims, 7);
    const scores = new Map<number, TriageScore>();
    let tokens = 0, calls = 0, ms = 0;

    for (let i = 0; i < order.length; i += TRIAGE_BATCH) {
        const batch = order.slice(i, i + TRIAGE_BATCH);
        const started = Date.now();
        const result = await withRetry(() => triageClaims(llm, batch.map(c => ({ text: c.text }))));
        ms += Date.now() - started;
        tokens += result.usage.inputTokens + result.usage.outputTokens;
        calls++;
        batch.forEach((claim, j) => scores.set(claim.id, result.scores[j]));
    }

    const p = (c: EvalClaim) => scores.get(c.id)!.pFalse;
    const falses = claims.filter(c => c.label === 'false');
    const trues = claims.filter(c => c.label === 'true');
    let wins = 0;
    for (const f of falses) for (const t of trues) wins += p(f) > p(t) ? 1 : p(f) === p(t) ? 0.5 : 0;

    console.log(`\nTriage (no search): ${calls} calls, ${tokens} tokens, ${(ms / calls / 1000).toFixed(1)}s per call of ${TRIAGE_BATCH} claims`);
    console.log(`Ranking quality (AUC, false above true): ${(wins / (falses.length * trues.length)).toFixed(3)}`);
    console.log(`\n| Category | Claims | Flagged at >=${FLAG_THRESHOLD} | Mean p_false | Marked unsure |`);
    console.log('|---|---|---|---|---|');
    for (const category of unique(claims.map(c => c.category))) {
        const group = claims.filter(c => c.category === category);
        const flagged = group.filter(c => p(c) >= FLAG_THRESHOLD).length;
        const mean = group.reduce((sum, c) => sum + p(c), 0) / group.length;
        const unsure = group.filter(c => scores.get(c.id)!.basis === 'unsure').length;
        console.log(`| ${category} | ${group.length} | ${flagged} | ${mean.toFixed(0)} | ${unsure} |`);
    }

    const missed = falses.filter(c => p(c) < FLAG_THRESHOLD);
    const wronglyFlagged = trues.filter(c => p(c) >= FLAG_THRESHOLD);
    console.log(`\nFalse claims caught: ${falses.length - missed.length}/${falses.length}. True claims wrongly flagged: ${wronglyFlagged.length}/${trues.length}.`);
    if ('verbose' in args) {
        missed.forEach(c => console.log(`  missed   [${p(c)}] ${c.text}`));
        wronglyFlagged.forEach(c => console.log(`  flagged  [${p(c)}] ${c.text}`));
    }
}

async function runJudge(llm: LlmConfig) {
    const subset = claims.filter(c => c.judge);
    const evidence = await gatherEvidence(subset);
    const judgements = new Map<number, Judgement>();
    let tokens = 0, calls = 0, ms = 0;

    for (let i = 0; i < subset.length; i += JUDGE_BATCH) {
        const batch = subset.slice(i, i + JUDGE_BATCH);
        const started = Date.now();
        const result = await withRetry(() => judgeClaims(llm, batch.map(c => ({ claim: c.text, evidence: evidence[c.id] }))));
        ms += Date.now() - started;
        tokens += result.usage.inputTokens + result.usage.outputTokens;
        calls++;
        batch.forEach((claim, j) => judgements.set(claim.id, result.judgements[j]));
    }

    const expected = (c: EvalClaim) => (c.label === 'false' ? 'CONTRADICTED' : 'SUPPORTED');
    const of = (label: string) => subset.filter(c => c.label === label);
    const count = (group: EvalClaim[], verdict: string) => group.filter(c => judgements.get(c.id)!.verdict === verdict).length;
    const dropped = subset.filter(c => {
        const j = judgements.get(c.id)!;
        return j.rawVerdict !== 'UNCLEAR' && j.verdict === 'UNCLEAR';
    }).length;

    console.log(`\nEvidence judge (1 search per claim): ${calls} calls, ${tokens} tokens, ${(ms / calls / 1000).toFixed(1)}s per call of ${JUDGE_BATCH} claims`);
    console.log('\n| Actual | Claims | Shown as contradicted | Shown as supported | Unclear |');
    console.log('|---|---|---|---|---|');
    for (const label of ['false', 'true']) {
        const group = of(label);
        console.log(`| ${label} | ${group.length} | ${count(group, 'CONTRADICTED')} | ${count(group, 'SUPPORTED')} | ${count(group, 'UNCLEAR')} |`);
    }
    const correct = subset.filter(c => judgements.get(c.id)!.verdict === expected(c)).length;
    console.log(`\nCorrect verdicts: ${correct}/${subset.length}. True claims wrongly shown as contradicted: ${count(of('true'), 'CONTRADICTED')}. Verdicts dropped by the quote check: ${dropped}.`);
    if ('verbose' in args) {
        for (const c of subset) {
            const j = judgements.get(c.id)!;
            const mark = j.verdict === expected(c) ? 'ok  ' : j.verdict === 'UNCLEAR' ? 'miss' : 'BAD ';
            console.log(`  ${mark} ${c.category.padEnd(15)} ${j.verdict.padEnd(12)} ${c.text.slice(0, 70)}`);
            if (j.quote) console.log(`         "${j.quote.slice(0, 110)}" (${new URL(j.evidence!.url).hostname})`);
        }
    }
}

async function gatherEvidence(subset: EvalClaim[]): Promise<Record<number, Evidence[]>> {
    const cache: Record<number, Evidence[]> = existsSync(SEARCH_CACHE) ? JSON.parse(readFileSync(SEARCH_CACHE, 'utf8')) : {};
    const missing = subset.filter(c => !cache[c.id]);
    if (missing.length > 0) {
        const key = env.TAVILY_API_KEY;
        if (!key) throw new Error('TAVILY_API_KEY not set and search cache is incomplete');
        console.log(`\nSearching Tavily for ${missing.length} claims (${missing.length} credits)...`);
        for (const claim of missing) {
            cache[claim.id] = await searchEvidence(key, claim.text);
        }
        mkdirSync(CACHE_DIR, { recursive: true });
        writeFileSync(SEARCH_CACHE, JSON.stringify(cache, null, 2));
    }
    return cache;
}

async function withRetry<T>(call: () => Promise<T>): Promise<T> {
    try {
        return await call();
    } catch (err) {
        if (err instanceof LlmError && err.isQuota) {
            console.log('  rate limited, waiting 30s...');
            await new Promise(r => setTimeout(r, 30000));
            return call();
        }
        throw err;
    }
}

function shuffle<T>(items: T[], seed: number): T[] {
    const out = [...items];
    let state = seed;
    for (let i = out.length - 1; i > 0; i--) {
        state = (state * 1103515245 + 12345) % 2147483648;
        const j = state % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

function unique<T>(items: T[]): T[] {
    return [...new Set(items)];
}

function loadEnv(path: string): Record<string, string> {
    if (!existsSync(path)) throw new Error(`Env file not found: ${path}`);
    const out: Record<string, string> = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
        if (match) out[match[1]] = match[2];
    }
    return out;
}

function parseArgs(argv: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const name = argv[i].slice(2);
        const next = argv[i + 1];
        out[name] = next && !next.startsWith('--') ? argv[++i] : '';
    }
    return out;
}
