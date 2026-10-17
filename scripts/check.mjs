// Sanity-checks the manifest before loading or packaging: valid JSON, and
// every file it points at actually exists.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));

const refs = [
  ...Object.values(manifest.icons ?? {}),
  manifest.action?.default_popup,
  manifest.background?.service_worker,
  manifest.options_page,
  ...(manifest.content_scripts ?? []).flatMap((cs) => [...(cs.js ?? []), ...(cs.css ?? [])]),
].filter(Boolean);

const missing = refs.filter((p) => !existsSync(join(ROOT, p)));

if (missing.length) {
  console.error('Missing files referenced by manifest.json:');
  for (const p of missing) console.error('  -', p);
  process.exit(1);
}

console.log(`manifest.json OK -- ${refs.length} referenced files present.`);
