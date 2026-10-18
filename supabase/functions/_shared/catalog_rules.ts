// Who may be LISTED (RULINGS 2026-10-17, Ryan): a dataset may be listed to people only if it is not personal and its licence
// allows showing derived visuals publicly; CC BY-SA, in whole or in part, is NOT listable in v1; every listing shows its source
// and licence.
//
// `listable` is a FIELD, decided per dataset by a person in listing_decisions.json and written into catalog_data.ts by
// tools/gen-catalog.py. It is NOT derived from the registry's prose. This file does not decide anything: it CHECKS the field
// against the prose with the same two guards the generator uses, so a hand edit, a stale regeneration or a decision that
// contradicts its own licence text is caught by tests rather than trusted. Keep the patterns equal to gen-catalog.py's.
import { CATALOG } from "./catalog_data.ts";

type Json = any;

export const LISTING_CLASSES = ["us-gov-public-domain", "open-licence", "not-listable"];

const EXCLUDE_ID = /(^example_corp_|_fixture(_|$)|^ryan_)/;
// A restriction word in the licence or the notes: a dataset carrying one is never listable.
const TRIPWIRE = /\bINTERNAL\b|BY-SA|share-?alike|\bBY-NC\b|\bBY-ND\b|non-?commercial|no ?derivatives?|all rights reserved|not for (public|redistribution)|\bnot\s+(a\s+)?public\b|confidential|proprietary/i;
// In the LICENCE only (prose such as "private-sector" or "personal income" is ordinary): a private or personal licence.
const PRIVATE_LICENCE = /^\s*(private|personal|local file)\b|\b(private|personal)\s+(data|dataset|use|file)\b/i;
const OPEN_LICENCE = /public domain|17 USC 105|U\.S\. Government works?|\bCC0\b|\bCC BY\b/i;

/** Why a `listable: true` entry is NOT sound according to its own text, or null. Used by the checks below and by tests. */
export function contradiction(entry: Json): string | null {
  const lic = String(entry.licence ?? "").replace(/\s+/g, " ").trim();
  const notes = String(entry.notes ?? "").replace(/\s+/g, " ").trim();
  if (EXCLUDE_ID.test(String(entry.id ?? ""))) return "personal, fixture or synthetic data is never listed";
  const hit = TRIPWIRE.exec(`${lic} ${notes}`) ?? PRIVATE_LICENCE.exec(lic);
  if (hit) return `its licence or notes say '${hit[0]}'`;
  if (!OPEN_LICENCE.test(lic)) return "its licence names no open licence";
  return null;
}

/** Every way the catalog's listing fields are wrong or incomplete. [] when sound. */
export function listableProblems(catalog: Json[] = CATALOG): string[] {
  const errs: string[] = [];
  for (const e of catalog) {
    if (typeof e.listable !== "boolean") { errs.push(`${e.id}: listable is not true or false`); continue; }
    if (!LISTING_CLASSES.includes(e.listable_class)) errs.push(`${e.id}: listable_class '${e.listable_class}' is not one of ${LISTING_CLASSES.join(", ")}`);
    if (e.listable === (e.listable_class === "not-listable")) errs.push(`${e.id}: listable=${e.listable} contradicts class ${e.listable_class}`);
    if (!String(e.listable_why ?? "").trim()) errs.push(`${e.id}: no reason recorded for the listing decision`);
    if (e.listable) {
      const why = contradiction(e);
      if (why) errs.push(`${e.id}: marked listable but ${why}`);
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
