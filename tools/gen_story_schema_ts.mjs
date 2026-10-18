// Regenerates supabase/functions/_shared/story_schema.ts from story.schema.json (the worker's export, vendored).
import fs from 'node:fs';
const dir = new URL('../supabase/functions/_shared/', import.meta.url);
const data = JSON.parse(fs.readFileSync(new URL('story.schema.json', dir), 'utf8'));
const body = "// GENERATED from story.schema.json (the worker's export) by tools/gen_story_schema_ts.mjs. Do not edit; tests/connect-tools.test.mjs compares the two.\n" +
  "// A plain module, because the platform's bundler is not asked to understand JSON import attributes.\n" +
  "const schema: Record<string, unknown> = " + JSON.stringify(data, null, 1) + ";\nexport default schema;\n";
fs.writeFileSync(new URL('story_schema.ts', dir), body);
