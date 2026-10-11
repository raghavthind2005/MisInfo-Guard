import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './public/manifest.json';

export default defineConfig({
    plugins: [
        preact(),
        crx({ manifest }),
    ],
    server: {
        port: 5173,
        strictPort: true,
        hmr: {
            port: 5173,
        },
    },
    define: {
        // WORKAROUND: Fix "Cannot use 'import.meta' outside a module" in content scripts
        // This allows onnxruntime-web to load without syntax error.
        'import.meta.url': 'self.location.href',
    },
    build: {
        target: 'es2020',
        modulePreload: false,
        rollupOptions: {
            input: {
                popup: 'src/popup/popup.html',
            },
            output: {
                // Force manual chunks to avoid aggressive splitting that confuses Chrome
                manualChunks: undefined,
            },
        },
    },
});
