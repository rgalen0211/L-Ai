// Who may be LISTED (RULINGS 2026-10-17, Ryan): a dataset may be listed to people only if it is not personal and its
// licence allows showing derived visuals publicly. Every listing then shows its source and licence.
//
// The rule is decided in tools/gen-catalog.py (listable_of) from the registry's licence text and written into
// catalog_data.ts as `listable` and `listable_why`. This file RE-DERIVES it, so a hand edit of the data, a stale
// regeneration or a wrong flag is caught by tests rather than trusted. The default is NO: an unknown or restrictive
// licence is not listable. Keep the three patterns equal to gen-catalog.py's (tests compare every entry).
import { CATALOG } from "./catalog_data.ts";

type Json = any;

const EXCLUDE_ID = /(^example_corp_|_fixture(_|$)|^ryan_)/;
const PERSONAL_LICENCE = /\b(private|personal)\b/i;
const PUBLIC_LICENCE = /public domain|17 USC 105|U\.S\. Government works?|\bCC0\b|\bCC BY\b/i;
const RESTRICTED_LICENCE = /\bCC BY[- ](NC|ND)|non-?commercial|no ?derivatives?|all rights reserved|not for (public|redistribution)/i;

/** [listable, why] for one catalog entry, from its id and licence text alone. */
export function classifyListable(entry: Json): [boolean, string] {
  const lic = String(entry.licence ?? "").replace(/\s+/g, " ").trim();
  if (EXCLUDE_ID.test(String(entry.id ?? "")) || PERSONAL_LICENCE.test(lic)) return [false, "personal"];
  if (RESTRICTED_LICENCE.test(lic)) return [false, "licence restricts public use"];
  if (PUBLIC_LICENCE.test(lic)) return [true, /public domain|17 USC 105|U\.S\. Government/i.test(lic) ? "public domain" : "open licence"];
  return [false, "licence not recognised"];
}

/** Every way the catalog's `listable` flags disagree with the rule, or lack what a listing must show. [] when sound. */
export function listableProblems(catalog: Json[] = CATALOG): string[] {
  const errs: string[] = [];
  for (const e of catalog) {
    const [want, why] = classifyListable(e);
    if (e.listable !== want) errs.push(`${e.id}: marked listable=${e.listable} but the rule says ${want} (${why})`);
    else if (e.listable_why !== why) errs.push(`${e.id}: listable_why is '${e.listable_why}', the rule says '${why}'`);
    if (e.listable) {
      // Rule 5: every listing shows its source and its licence.
      if (!String(e.publisher ?? "").trim()) errs.push(`${e.id}: listable but names no source`);
      if (!String(e.licence ?? "").trim() || !String(e.licence_short ?? "").trim()) errs.push(`${e.id}: listable but shows no licence`);
    }
  }
  return errs;
}

/** The entries a front end may list: listable, and (optionally) usable on the installed worker. */
export function listableEntries(opts: { usableOnly?: boolean } = {}, catalog: Json[] = CATALOG): Json[] {
  if (listableProblems(catalog).length) return [];           // a catalog that fails its own rule lists nothing
  return catalog.filter((e) => e.listable && (!opts.usableOnly || e.status === "usable"));
}
