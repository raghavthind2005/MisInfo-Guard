// Copies the ONNX Runtime WASM binaries out of node_modules into public/wasm
// so they are bundled with the extension without being committed to git.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'onnxruntime-web', 'dist');
const target = join(root, 'public', 'wasm');

mkdirSync(target, { recursive: true });

const files = readdirSync(source).filter((name) => name.endsWith('.wasm'));
for (const name of files) {
    cpSync(join(source, name), join(target, name));
}

console.log(`Copied ${files.length} WASM files to public/wasm`);
