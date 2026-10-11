import { defineConfig } from 'vitest/config';

// Kept separate from vite.config.ts: unit tests cover the pure modules and
// must not load the Chrome extension build plugin.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.test.ts'],
    },
});
