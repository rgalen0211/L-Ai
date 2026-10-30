// Regenerates supabase/functions/_shared/dataset_info.ts from dataset-info.json (ENGINE's docs/dataset-info.json, vendored byte for byte; see dataset-info.source.txt).
import fs from 'node:fs';
const dir = new URL('../supabase/functions/_shared/', import.meta.url);
const data = JSON.parse(fs.readFileSync(new URL('dataset-info.json', dir), 'utf8'));
const body = "// GENERATED from dataset-info.json (the engine's per-dataset records, vendored; see dataset-info.source.txt) by tools/gen_dataset_info_ts.mjs. Do not edit; tests/connect-dataset-info.test.mjs compares the two.\n" +
  "// A plain module, because the platform's bundler is not asked to understand JSON import attributes.\n" +
  "const info: Record<string, unknown> = " + JSON.stringify(data) + ";\nexport default info;\n";
fs.writeFileSync(new URL('dataset_info.ts', dir), body);
