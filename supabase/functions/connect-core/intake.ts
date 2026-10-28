// "READ THE ROOM" (NEXT-CONNECT 153; Ryan 22:37): Ryagram's guidance for how a connected AI gets started with a person. A PURE function: no database, no network, nothing stored.
// The AI passes what the person has ALREADY told it; the answer is the ONE next step. Rules (Ryan):
//   1. First the basic question: what are you making? A data film, a compilation, or a department that is "coming soon" (said plainly).
//   2. Then the questions that fit the kind. A data film: the scale and the place, what to look at, the years, which picture. ONLY what the engine draws today is offered; the 3D interactive globe
//      (and a city or whole-country picture) is named as coming soon, never promised. A compilation: the Windows desktop app, folder NAMES, a phrase or a song.
//   3. NEVER ask what the person already said: a field that is known is never asked for again. The one exception is a "not drawn" answer (a globe, a city map): the person is asked to pick again, and the
//      answer says so (reask: true).
// Free text the AI passes (place, dataset, years) is never echoed back: the answer holds fixed sentences only.

export const KINDS = ["data_film", "compilation", "department"] as const;
export const SCALES = ["city", "county", "state", "country", "world"] as const;
export const PICTURES = ["county_map", "state_map", "prism_map", "line", "bars", "paired", "globe"] as const;
export const CHOSE = ["phrase", "song"] as const;

export type Kind = (typeof KINDS)[number];
export type Scale = (typeof SCALES)[number];
export type Picture = (typeof PICTURES)[number];

export interface Known {
  kind?: Kind; scale?: Scale; place?: string; dataset?: string; years?: string; picture?: Picture;
  have_app?: boolean; folders_named?: boolean; chose?: (typeof CHOSE)[number]; department?: string;
}

export interface Step {
  step: string;                         // an id, for the AI and for tests
  asking: string | null;                // the one field this step asks about, or null when it asks nothing
  reask?: boolean;                      // true only when the field was known but cannot be drawn (the person is asked to pick again)
  ask: string | null;                   // the one question to put to the person, in plain words
  options: string[];                    // what to offer (only what exists today)
  say: string | null;                   // a plain statement to make to the person first (coming soon, not drawn)
  then: string;                         // what the AI does next (tool names), once the person has answered
  kind: Kind | null;                    // the kind as far as it is known (given or inferred)
  known: string[];                      // the fields this answer treats as already answered
}

const PICTURE_WORDS: Record<string, string> = {
  county_map: "a county map", state_map: "a state map", prism_map: "the living 3D prism map", line: "a line chart", bars: "a ranked bar race", paired: "a map and a bar race side by side", globe: "the 3D interactive globe",
};
const SCALE_PICTURES: Record<string, Picture[]> = {
  county: ["county_map", "prism_map", "line", "bars"],
  state: ["state_map", "prism_map", "line", "bars", "paired"],
};
const NOT_DRAWN_SCALE = "Ryagram draws state and county pictures today. A city picture and a whole-country or world picture are not drawn yet.";
const GLOBE = "The 3D interactive globe is coming soon. It is not available yet, so do not promise it.";

export function inferKind(k: Known): Kind | null {
  if (k.kind) return k.kind;
  if (k.department !== undefined) return "department";
  if (k.chose !== undefined || k.folders_named !== undefined) return "compilation";
  if (k.scale !== undefined || k.place !== undefined || k.dataset !== undefined || k.years !== undefined || k.picture !== undefined) return "data_film";
  return null;
}

const present = (k: Known): string[] => (Object.entries(k) as [string, unknown][]).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([f]) => f);

export function nextStep(input: Known): Step {
  const k: Known = {}; for (const [f, v] of Object.entries(input) as [keyof Known, unknown][]) if (v !== undefined && v !== null && v !== "") (k as Record<string, unknown>)[f] = v;
  const kind = inferKind(k);
  const known = present(k);
  const mk = (s: Omit<Step, "kind" | "known"> & Partial<Pick<Step, "kind" | "known">>): Step => ({ kind, known, ...s });

  // ---- 1. the basic question
  if (kind === null) {
    return mk({ step: "kind", asking: "kind", ask: "What would you like to make: a data film (numbers drawn as a map or a chart over time), a compilation of clips from your own videos, or something else?",
      options: ["a data film", "a compilation of clips from my own videos", "something else (some departments are coming soon)"], say: null, then: "Pass the answer back as kind, then continue with suggest_next_step." });
  }

  // ---- a department that is not built
  if (kind === "department") {
    return mk({ step: "coming_soon", asking: null, ask: "Would you like to make a data film or a compilation of your own clips in the meantime?", options: ["a data film", "a compilation of clips from my own videos"],
      say: "That part of Ryagram is coming soon. It is not available yet, and nothing can be started in it today.", then: "If they choose, pass kind and continue with suggest_next_step. Do not invent a way to do the coming-soon thing." });
  }

  // ---- a compilation: the desktop app, folder names, a phrase or a song
  if (kind === "compilation") {
    if (k.have_app === undefined) {
      return mk({ step: "app", asking: "have_app", ask: "A compilation is made on your own computer, from your own videos, by the Ryagram desktop app for Windows. Do you have the app?", options: ["yes, I have it", "no, I don't have it yet"],
        say: null, then: "Pass have_app, then continue with suggest_next_step." });
    }
    if (k.have_app === false) {
      return mk({ step: "get_app", asking: null, ask: null, options: [], say: "The compilation is made in the Ryagram desktop app for Windows, on the person's own computer; their videos never leave it. Tell them where to get the app on the Ryagram website (Account), and that you can write down what they want so the app shows it when they open it.",
        then: "When they have the app, pass have_app: true and continue with suggest_next_step." });
    }
    if (k.folders_named === undefined) {
      return mk({ step: "folders", asking: "folders_named", ask: "Which folders of your videos should it look in? Tell me the folder NAMES as the app shows them (not where they are on your computer).", options: [],
        say: null, then: "Pass folders_named: true once you have the names, then continue with suggest_next_step." });
    }
    if (k.chose === undefined) {
      return mk({ step: "phrase_or_song", asking: "chose", ask: "Do you want every time a phrase is said, or a line sung to a tune made of the words from your videos?", options: ["a phrase: every time it is said", "a song"], say: null,
        then: "Pass chose as phrase or song, then continue with suggest_next_step." });
    }
    return mk({ step: "write_request", asking: null, ask: null, options: [], say: null,
      then: "Use set_compilation_request on their project (create_project first if there is none) with the phrase, the folder names, and song if they chose it. Tell them to open the Ryagram desktop app, where the request waits for them to check and build." });
  }

  // ---- a data film
  if (k.scale === undefined) {
    return mk({ step: "scale", asking: "scale", ask: "What place do you want to look at, and at what scale: a city, a county, a state, a country, or the world?", options: [...SCALES].map((s) => s), say: null,
      then: "Pass scale (and place if they named one), then continue with suggest_next_step." });
  }
  if (k.scale !== "county" && k.scale !== "state") {
    return mk({ step: "scale_not_drawn", asking: "scale", reask: true, ask: "Would you like to look at it by state or by county instead?", options: ["by state", "by county"], say: NOT_DRAWN_SCALE,
      then: "Pass scale as state or county, then continue with suggest_next_step." });
  }
  if (k.place === undefined) {
    return mk({ step: "place", asking: "place", ask: k.scale === "county" ? "Which state or counties do you want to look at?" : "Which states do you want to look at, or all of them?", options: [], say: null,
      then: "Pass place, then continue with suggest_next_step." });
  }
  if (k.dataset === undefined) {
    return mk({ step: "dataset", asking: "dataset", ask: "What do you want to measure (for example rent, building permits, unemployment, obesity)?", options: [], say: null,
      then: "Use get_story_schema to see the catalog and pick the dataset that matches; pass dataset as a short name of the topic, then continue with suggest_next_step." });
  }
  if (k.years === undefined) {
    return mk({ step: "years", asking: "years", ask: "Which years do you want to cover?", options: [], say: "Only the years the chosen dataset covers can be used; get_story_schema lists them.",
      then: "Pass years, then continue with suggest_next_step." });
  }
  const allowed = SCALE_PICTURES[k.scale];
  if (k.picture === undefined) {
    return mk({ step: "picture", asking: "picture", ask: "Which picture do you want?", options: allowed.map((p) => PICTURE_WORDS[p]), say: "The 3D interactive globe is coming soon and is not offered yet.",
      then: "Pass picture as county_map, state_map, prism_map, line, bars or paired, then continue with suggest_next_step." });
  }
  if (k.picture === "globe") {
    return mk({ step: "picture_coming_soon", asking: "picture", reask: true, ask: "Which of these would you like instead?", options: allowed.map((p) => PICTURE_WORDS[p]), say: GLOBE,
      then: "Pass picture as one of the options, then continue with suggest_next_step." });
  }
  if (!allowed.includes(k.picture)) {
    return mk({ step: "picture_not_for_scale", asking: "picture", reask: true, ask: "Which of these would you like instead?", options: allowed.map((p) => PICTURE_WORDS[p]),
      say: `That picture does not fit a ${k.scale}-level film. These do.`, then: "Pass picture as one of the options, then continue with suggest_next_step." });
  }
  return mk({ step: "confirm_and_build", asking: null, ask: null, options: [], say: null,
    then: "Do NOT ask the person anything else they already told you. Call get_story_schema, choose the catalog dataset that matches the topic and the years it covers, and tell the person which one you chose (ask only if it is a poor match). Then create_project, set_story (it checks every rule), and make_contact_sheet; show the result with get_film_link when it is ready." });
}

export function stepText(s: Step): string {
  const lines: string[] = [];
  if (s.say) lines.push(s.say);
  if (s.ask) lines.push(`Ask the person (one question only): ${s.ask}`);
  if (s.options.length) lines.push("Offer: " + s.options.join("; ") + ".");
  lines.push(`Then: ${s.then}`);
  if (s.known.length) lines.push(`Already answered, do not ask again: ${s.known.join(", ")}.`);
  return lines.join("\n");
}
