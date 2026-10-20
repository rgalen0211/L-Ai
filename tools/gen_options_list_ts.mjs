// Regenerates supabase/functions/_shared/options_list.ts from options_list.json (WEB's merged options.draft.json: the ONE list of what a person, the desktop app or a connected AI can set).
// The list is WORDING AND DISPLAY ONLY. It is never the validator: the worker's story schema (story_schema.ts) is, and tests/connect-options.test.mjs proves the two agree.
import fs from 'node:fs';
import crypto from 'node:crypto';
const dir = new URL('../supabase/functions/_shared/', import.meta.url);
const raw = fs.readFileSync(new URL('options_list.json', dir), 'utf8');
const data = JSON.parse(raw);
const sha = crypto.createHash('sha256').update(raw).digest('hex');
// ASCII only in the generated file: every non-ASCII character becomes an escape, so no raw invisible or direction character can ever land in the source.
// (The escape and the character range are built from numbers, so this file itself holds no raw or escaped special characters.)
const BS = String.fromCharCode(92);
const NON_ASCII = new RegExp('[' + String.fromCharCode(127) + '-' + String.fromCharCode(0xffff) + ']', 'g');
const ascii = (s) => s.replace(NON_ASCII, (c) => BS + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
const body = "// GENERATED from options_list.json by tools/gen_options_list_ts.mjs. Do not edit; tests/connect-options.test.mjs compares the two.\n" +
  "// Source: WEB's merged options.draft.json (the shared list) with RENDERER's engine fields and plain help. WORDING AND DISPLAY ONLY; the story schema is the validator.\n" +
  "export const OPTIONS_SHA256 = \"" + sha + "\";\n" +
  "export interface HelpDetail { changes?: string; use_when?: string; example?: string; careful?: string }\n" +
  "export interface Option { id: string; path?: string | null; group: string; label: string; help: string; control: string; default?: unknown; status: string; source: string; connector: string; connector_note?: string; same_as?: string; hard?: Record<string, unknown> | null; choices?: { value: unknown; label: string; [k: string]: unknown }[]; help_detail?: HelpDetail; owner?: string | null; [extra: string]: unknown }\n" +
  "export const OPTION_GROUPS: { id: string; label: string; help?: string }[] = " + ascii(JSON.stringify(data.groups, null, 1)) + ";\n" +
  "export const OPTIONS: Option[] = " + ascii(JSON.stringify(data.options, null, 1)) + ";\n";
fs.writeFileSync(new URL('options_list.ts', dir), body);
console.log('rows', data.options.length, 'sha256', sha.slice(0, 16));
