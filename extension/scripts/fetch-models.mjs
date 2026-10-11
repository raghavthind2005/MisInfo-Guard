// Downloads the sentence embedding model used by the fact-check memory into
// public/models, so it ships inside the extension without being committed to git.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'onnx/model_quantized.onnx'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'public', 'models', 'all-MiniLM-L6-v2');

for (const file of FILES) {
    const destination = join(target, file);
    if (existsSync(destination)) continue;

    const response = await fetch(`https://huggingface.co/${MODEL}/resolve/main/${file}`);
    if (!response.ok) {
        throw new Error(`Failed to download ${file}: ${response.status}`);
    }
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
    console.log(`Downloaded ${file}`);
}

console.log('Embedding model ready in public/models/all-MiniLM-L6-v2');
