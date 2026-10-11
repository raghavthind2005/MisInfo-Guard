import { env, pipeline } from '@xenova/transformers';

/**
 * ModelLoader - Configures Transformers.js and onnxruntime-web
 * Optimized for Background Service Workers in Chrome Extensions.
 */

// 1. Path Configuration
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = false;
const baseUrl = chrome.runtime.getURL(''); // Base extension URL
env.localModelPath = `${baseUrl}models/`;

// 2. WASM Path Configuration
// Explicitly point to the wasm folder
const wasmPath = `${baseUrl}wasm/`;
env.backends.onnx.wasm.wasmPaths = wasmPath;

// Fallback logic for different transformers.js/onnx versions
(env as any).wasm = (env as any).wasm || {};
(env as any).wasm.wasmPaths = wasmPath;
(env as any).backends.onnx.wasm.numThreads = 1; // Limit threads to avoid shared-memory issues in some envs

const modelId = 'tinybert-claim-detector';

class ModelLoader {
    private static instance: any = null;
    private static isLoading = false;

    static async getInstance() {
        if (this.instance) return this.instance;

        if (this.isLoading) {
            while (this.isLoading) {
                await new Promise(r => setTimeout(r, 100));
            }
            return this.instance;
        }

        this.isLoading = true;
        console.log('🛡️ MisInfo Guard: Initializing AI Pipeline...');

        try {
            const options: any = {
                quantized: true,
                device: 'webgpu', // Try WebGPU first
            };

            try {
                this.instance = await pipeline('text-classification', modelId, options);
                console.log('✅ AI: WebGPU Backend Ready');
            } catch (err) {
                console.warn('⚠️ WebGPU Init Failed, trying WASM...', err);

                // Fallback to WASM
                options.device = 'wasm';
                this.instance = await pipeline('text-classification', modelId, options);
                console.log('✅ AI: WASM Backend Ready');
            }

            return this.instance;
        } catch (error) {
            console.error('❌ CRITICAL AI FAILURE:', error);
            this.instance = null;
            throw error;
        } finally {
            this.isLoading = false;
        }
    }
}

export default ModelLoader;
