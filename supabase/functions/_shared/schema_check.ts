// A small JSON Schema checker for the subset the worker's story schema uses (draft 2020-12 as exported by
// ryagram/worker/schema.py json_schema()): object (properties, required, additionalProperties false or a schema,
// propertyNames, maxProperties, anyOf-required), array (items, minItems, maxItems, prefixItems), string
// (maxLength, pattern), number and integer (minimum, maximum), boolean, enum, anyOf, oneOf.
//
// It exists so an Edge Function can refuse a story the worker would refuse, with a reason. The worker's own
// check (validate_story) is the authority; nothing here is trusted by the worker.
// A node this checker does not understand is reported, never skipped: an unknown keyword means the schema moved.

type Json = any;

const KNOWN = new Set(["type", "properties", "required", "additionalProperties", "propertyNames", "maxProperties",
  "anyOf", "oneOf", "items", "minItems", "maxItems", "prefixItems", "maxLength", "pattern", "minimum", "maximum",
  "enum", "$schema", "$id", "description", "x-not-in-schema", "x-locked"]);

function deepEq(a: Json, b: Json): boolean {
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEq(x, b[i]));
  return a === b;
}

export function checkAgainst(schema: Json, value: Json, path = "$"): string[] {
  const errs: string[] = [];
  walk(schema, value, path, errs);
  return errs;
}

function ok(schema: Json, v: Json, path: string): boolean {
  const t: string[] = [];
  walk(schema, v, path, t);
  return t.length === 0;
}

function walk(node: Json, v: Json, path: string, errs: string[]): void {
  for (const k of Object.keys(node)) if (!KNOWN.has(k)) errs.push(`${path}: internal: the schema uses '${k}', which this checker does not know`);
  if (node.enum) {
    if (!node.enum.some((a: Json) => deepEq(a, v))) errs.push(`${path}: ${JSON.stringify(v)?.slice(0, 60)} is not one of ${node.enum.map((a: Json) => JSON.stringify(a)).join(", ")}`);
    return;
  }
  if (node.anyOf && node.type !== "object") {
    if (!node.anyOf.some((n: Json) => ok(n, v, path))) errs.push(`${path}: matches none of the allowed forms`);
    return;
  }
  if (node.oneOf) {
    const hits = node.oneOf.filter((n: Json) => ok(n, v, path)).length;
    if (hits !== 1) {
      // Say which form it nearly is: the object's "kind", when it has one.
      const kind = v && typeof v === "object" ? (v as Json).kind : undefined;
      errs.push(`${path}: matches ${hits} of the allowed forms, needs exactly one${kind ? ` (kind ${JSON.stringify(kind)})` : ""}`);
      if (kind) {
        const form = node.oneOf.find((n: Json) => n.properties?.kind?.enum?.some((a: Json) => a === kind));
        if (form) walk(form, v, path, errs);
      }
    }
    return;
  }
  switch (node.type) {
    case "object": {
      if (v === null || typeof v !== "object" || Array.isArray(v)) { errs.push(`${path}: expected an object`); return; }
      const props = node.properties ?? {};
      const keys = Object.keys(v);
      if (node.maxProperties != null && keys.length > node.maxProperties) { errs.push(`${path}: at most ${node.maxProperties} entries, has ${keys.length}`); return; }
      for (const k of keys) {
        if (node.propertyNames?.pattern && !new RegExp(node.propertyNames.pattern).test(k)) { errs.push(`${path}: key '${k.slice(0, 40)}' does not match ${node.propertyNames.pattern}`); continue; }
        if (k in props) walk(props[k], v[k], `${path}.${k}`, errs);
        else if (node.additionalProperties && typeof node.additionalProperties === "object") walk(node.additionalProperties, v[k], `${path}.${k}`, errs);
        else if (node.additionalProperties === false) errs.push(`${path}: unknown key '${k.slice(0, 40)}'`);
      }
      for (const k of node.required ?? []) if (!(k in v)) errs.push(`${path}: missing '${k}'`);
      // An object-level anyOf of {required: [k]} alternatives: at least one of those keys must be present.
      if (node.anyOf && !node.anyOf.some((n: Json) => (n.required ?? []).every((k: string) => k in v))) {
        errs.push(`${path}: needs one of ${node.anyOf.map((n: Json) => (n.required ?? []).join("+")).join(", ")}`);
      }
      return;
    }
    case "array": {
      if (!Array.isArray(v)) { errs.push(`${path}: expected a list`); return; }
      if (node.prefixItems) {
        if (v.length !== node.prefixItems.length) { errs.push(`${path}: expected a list of ${node.prefixItems.length}`); return; }
        node.prefixItems.forEach((n: Json, i: number) => walk(n, v[i], `${path}[${i}]`, errs));
        return;
      }
      if (v.length < (node.minItems ?? 0) || v.length > (node.maxItems ?? Infinity)) { errs.push(`${path}: needs ${node.minItems ?? 0}..${node.maxItems} items, has ${v.length}`); return; }
      if (node.items) v.forEach((x, i) => walk(node.items, x, `${path}[${i}]`, errs));
      return;
    }
    case "string": {
      if (typeof v !== "string") { errs.push(`${path}: expected a string`); return; }
      if (node.maxLength != null && v.length > node.maxLength) { errs.push(`${path}: longer than ${node.maxLength} characters`); return; }
      if (node.pattern && !new RegExp(node.pattern).test(v)) errs.push(`${path}: does not match the allowed form (${String(node.pattern).slice(0, 60)})`);
      return;
    }
    case "number":
    case "integer": {
      if (typeof v !== "number") { errs.push(`${path}: expected a number`); return; }
      if (!Number.isFinite(v)) { errs.push(`${path}: not a finite number`); return; }
      if (node.type === "integer" && !Number.isInteger(v)) { errs.push(`${path}: expected a whole number`); return; }
      if (v < node.minimum || v > node.maximum) errs.push(`${path}: ${v} is outside ${node.minimum}..${node.maximum}`);
      return;
    }
    case "boolean":
      if (typeof v !== "boolean") errs.push(`${path}: expected true or false`);
      return;
    default:
      errs.push(`${path}: internal: unsupported schema node`);
  }
}
