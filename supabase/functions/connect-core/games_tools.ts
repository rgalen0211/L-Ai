// GAMES for the person's AI (CONNECT, 2026-11-27, the "turn the other departments on" order). Contract and reasons: Ryagram-logs/proposals/CONNECT-DEPT-GAMES-1127.md.
// WHAT IS REAL TODAY: GAMES' plan (MAILBOX 11-27 08:12) keeps a game round ONLY in the host's browser and in Supabase Realtime between the host screen and the players' phones: no table, no SQL, no server call.
// So nothing about a round exists on the server for the AI to start, read or end, and these tools do not pretend otherwise. Two read-only tools, neither makes a server call of its own:
//   list_games        the games the Games page offers                    <- opening the Games page and looking at the list
//   open_games_page   where Games is and how a round is run, in words    <- finding Games in the top bar
// The tools that WOULD start, read and end a round (start_game_round, get_game_round, end_game_round) need server calls that do not exist; they are written, tested and kept as a draft beside the contract paper
// (proposals/CONNECT-DEPT-GAMES-1127-rounds-draft/) for the day GAMES decides to keep a round on the server.
// WHAT THE AI CANNOT DO, said in the words the AI reads: press anything on the page, see a room, a player or a guess, play, or spend credits. Nothing is written or started by either tool.
// THE GATE: both tools first ask the account's own switch list and department list (the connector's existing switches() and departments()): they answer only when the switch `games` is on for the account or
// the Games department already says `working` for it. Otherwise each refuses in plain words; if neither list can be read it refuses too (fails closed). All words here are DRAFTS for Ryan's yes. Pure TypeScript, no network.
import type { ToolCtx, ToolDef, ToolResult } from "./types.ts";

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text, data });
const refuse = (text: string, code: string, data?: Record<string, unknown>): ToolResult => ({ text, isError: true, code, ...(data ? { data } : {}) });

/** The Games page in the Ryagram app (the department page the top bar opens) and the players' page. Paths on the Ryagram site, never an address with a key in it. GAMES confirms both when its pages land. */
export const GAMES_PAGE_PATH = "/app/#/d/games";
export const PLAYERS_PAGE_PATH = "/game-phone/";

export interface GameListed { id: string; label: string; line: string }
/** The games on offer today. ONE game; when GAMES adds another it is added here in the same change as its page. */
export const GAMES_OFFERED: readonly GameListed[] = Object.freeze([
  Object.freeze({ id: "guess_the_next_line", label: "Guess the next line", line: "Everyone sees what was said so far and types the words they think come next; the host's screen shows the answer and the scores." }),
]);

/** The steps, in the person's words. They follow the Games page as GAMES builds it: if the page looks different, the page is right. */
export const HOW_A_ROUND_GOES: readonly string[] = Object.freeze([
  `Open Games from the top bar in Ryagram, signed in (the page is at ${GAMES_PAGE_PATH}).`,
  "Start a round there. The screen shows a four-letter room code.",
  `Players open the players' page on their phones (${PLAYERS_PAGE_PATH}) and type the room code and a name.`,
  "Each round the players type a guess on their phones; the host's screen shows the answer and the scores.",
]);

export function makeGamesTools(): ToolDef[] {
  /** The switch. Runs first in every game tool. */
  async function gate(ctx: ToolCtx, what: string): Promise<ToolResult | null> {
    const rows = await ctx.data.departments().catch(() => null);
    const sw = await ctx.data.switches().catch(() => null);
    if (rows === null && sw === null) return refuse(`${what} is not available just now. Try again in a minute.`, "unavailable", { ok: false, reason: "unreadable" });
    const on = (Array.isArray(sw) && sw.includes("games")) || (Array.isArray(rows) && rows.some((r) => r && r.id === "games" && r.status === "working"));
    if (on) return null;
    return refuse(`${what} is not open for this account yet: the Games department is not switched on for this person. Tell them plainly that games are not available to them yet, and do not promise a date.`,
      "not_available", { ok: false, reason: "games_not_open" });
  }

  const listGames: ToolDef = {
    name: "list_games", title: "See the games", scope: "read", readOnly: true, idempotent: true,
    description: "Lists the games on Ryagram's Games page: each game's id, its name and one line about it. Read-only, nothing is started. "
      + "Use it when the person asks what games there are. If games are not open for this person yet, it says so plainly: tell them, and do not promise a date.",
    inputSchema: obj(),
    async run(_a, ctx) {
      { const g = await gate(ctx, "Games"); if (g) return g; }
      const games = GAMES_OFFERED.map((g) => ({ ...g }));
      return ok(games.map((g) => `- ${g.id}: ${g.label}. ${g.line}`).join("\n") + "\nTo see where to play, call open_games_page.", { ok: true, games });
    },
  };

  const openGamesPage: ToolDef = {
    name: "open_games_page", title: "Find the Games page", scope: "read", readOnly: true, idempotent: true,
    description: "Tells the person where Games is in Ryagram and how a round is run, in words: where the host starts a round, where the players join with a room code, and what the host's screen shows. "
      + "Read-only; nothing is started. You cannot press anything on the page, see a room, its players or their guesses, play, or change anything: a round lives on the host's own screen and the players' phones, "
      + "so the person runs it themselves. Nothing here spends credits. If games are not open for this person yet, it says so plainly: tell them, and do not promise a date.",
    inputSchema: obj(),
    async run(_a, ctx) {
      { const g = await gate(ctx, "The Games page"); if (g) return g; }
      return ok(["Games is open for this person. How a round goes (these steps follow the Games page as it is built: if the page looks different, the page is right):",
        ...HOW_A_ROUND_GOES.map((s, i) => `${i + 1}. ${s}`),
        "You cannot press anything on the page, see the room, the players or their guesses, or play: the person and their players do that on their own screens."].join("\n"),
        { ok: true, page_path: GAMES_PAGE_PATH, players_page_path: PLAYERS_PAGE_PATH, steps: [...HOW_A_ROUND_GOES], ai_can: ["say where Games is and how a round goes", "list the games"], ai_cannot: ["press anything on the page", "see a room, its players or their guesses", "play", "start or end a round"] });
    },
  };

  return [listGames, openGamesPage];
}
