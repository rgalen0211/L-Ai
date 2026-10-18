// Which datasets a story from an AI connection may name: ENGINE's catalog entries that are usable on the installed render worker AND may be listed
// to a person (RULINGS 2026-10-17). The same rule search_datasets, describe_dataset and compile_film apply, so a story the builder compiles is a
// story set_story accepts. The render worker's own allowlist stays authoritative and re-checks every job.
import { CATALOG } from "../_shared/catalog_data.ts";

const IDS = new Set<string>((CATALOG as { id: string; status: string; listable?: boolean }[])
  .filter((e) => e.listable === true && e.status === "usable").map((e) => e.id));

export const isKnownDataset = (id: string): boolean => IDS.has(id);
export const knownDatasetIds = (): string[] => [...IDS];
