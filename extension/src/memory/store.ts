import { ClaimRow, FactCheckIndex, IndexManifest } from './factCheckIndex';

/**
 * Downloads the published fact-check index and keeps it in IndexedDB,
 * which is shared between the options page and the service worker.
 */

const RELEASE_URL = 'https://github.com/raghavthind2005/MisInfo-Guard/releases/download/factcheck-index';
const DB_NAME = 'misinfo-guard';
const STORE = 'factcheck-index';

interface StoredIndex {
    manifest: IndexManifest;
    claims: ClaimRow[];
    vectors: ArrayBuffer;
}

export async function fetchRemoteManifest(): Promise<IndexManifest> {
    const response = await fetch(`${RELEASE_URL}/manifest.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not reach the fact-check database (${response.status})`);
    return response.json();
}

/**
 * Downloads the index and replaces the stored copy.
 * onProgress receives the fraction of the vector file downloaded so far.
 */
export async function downloadIndex(onProgress: (fraction: number) => void): Promise<IndexManifest> {
    const manifest = await fetchRemoteManifest();

    const claimsResponse = await fetch(`${RELEASE_URL}/claims.json`, { cache: 'no-store' });
    if (!claimsResponse.ok) throw new Error(`Download failed (${claimsResponse.status})`);
    const claims = await claimsResponse.json() as ClaimRow[];

    const vectorsResponse = await fetch(`${RELEASE_URL}/vectors.bin`, { cache: 'no-store' });
    if (!vectorsResponse.ok || !vectorsResponse.body) throw new Error(`Download failed (${vectorsResponse.status})`);

    const expected = manifest.count * manifest.dimensions;
    const vectors = new Uint8Array(expected);
    const reader = vectorsResponse.body.getReader();
    let received = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > expected) throw new Error('Downloaded index is larger than its manifest says');
        vectors.set(value, received);
        received += value.length;
        onProgress(received / expected);
    }
    if (received !== expected || claims.length !== manifest.count) {
        throw new Error('Downloaded index is incomplete');
    }

    await put({ manifest, claims, vectors: vectors.buffer });
    return manifest;
}

export async function loadIndex(): Promise<FactCheckIndex | null> {
    const stored = await get();
    return stored ? new FactCheckIndex(stored.manifest, stored.claims, new Int8Array(stored.vectors)) : null;
}

export async function loadStoredManifest(): Promise<IndexManifest | null> {
    return (await get())?.manifest ?? null;
}

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function get(): Promise<StoredIndex | null> {
    const db = await open();
    return new Promise((resolve, reject) => {
        const request = db.transaction(STORE).objectStore(STORE).get('current');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
    });
}

async function put(value: StoredIndex): Promise<void> {
    const db = await open();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, 'current');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}
