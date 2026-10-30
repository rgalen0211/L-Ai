// Turns an Ajv 2020 constructor into Deps.compile. The constructor is passed in so this file imports nothing:
// Deno wires `npm:ajv`, the node tests wire the npm package.
import { plainError, type AjvError } from "./story_check.ts";

// deno-lint-ignore no-explicit-any
export function makeCompile(Ajv2020: any): (schema: object) => ((value: unknown) => string[]) & { detailed?: (value: unknown) => AjvError[] } {
  const ajv = new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true });
  const cache = new WeakMap<object, ((value: unknown) => string[]) & { detailed?: (value: unknown) => AjvError[] }>();
  return (schema) => {
    const hit = cache.get(schema);
    if (hit) return hit;
    const validate = ajv.compile(schema);
    const fn = ((value: unknown): string[] => (validate(value) ? [] : (validate.errors as AjvError[]).map((e) => plainError(e, (schema as { $id?: string }).$id ? "story" : "call")))) as ((value: unknown) => string[]) & { detailed?: (value: unknown) => AjvError[] };
    fn.detailed = (value: unknown): AjvError[] => (validate(value) ? [] : (validate.errors as AjvError[]).map((e) => ({ ...e })));       // the raw errors with their paths: structured results (NEXT-CONNECT 157)
    cache.set(schema, fn);
    return fn;
  };
}
