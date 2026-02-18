import { cp, mkdir, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('src', 'dist', { recursive: true });
await cp('src/index.js', 'dist/index.js');
await cp('src/ui/styles.css', 'dist/styles.css');
console.log('dist refreshed');
