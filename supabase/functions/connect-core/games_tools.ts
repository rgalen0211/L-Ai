// GAMES for the person's AI (CONNECT, 2026-11-27, the "turn the other departments on" order). Contract and reasons: Ryagram-logs/proposals/CONNECT-DEPT-GAMES-1127.md (its UPDATE block says what GAMES had when this was aligned).
// WHAT IS REAL TODAY (read from GAMES' branches games-live-1127 e7e2b0c6 and games-on-compilations-1127 e22af41f, 11-27 09:0x): a game lives ONLY in the host's browser and in Supabase Realtime between the host screen and the players' phones:
// no table, no SQL, no server call. The host screen (assets/app-games.js) is the Games page for an account whose switch list names `games`; the players' page is /game-phone/ (assets/game-phone-live.js).
// TWO games on the page, picked by the host in the lobby under "Which game?": "Guess the next line" and "Fill the gap". Five rounds each, 45 seconds a round, 1 to 8 players, a room code of four letters.
// So nothing about a game exists on the server for the AI to start, read or end, and these tools do not pretend otherwise. Two read-only tools, neither makes a server call of its own:
//   list_games        the games the Games page offers                    <- opening the Games page and looking at "Which game?"
//   open_games_page   where Games is and how a game is run, in words    <- finding Games in the top bar
// The tools that WOULD start, read and end a round (start_game_round, get_game_round, end_game_round) need server calls that do not exist; they are written, tested and kept as a draft beside the contract paper
// (proposals/CONNECT-DEPT-GAMES-1127-rounds-draft/) for the day GAMES decides to keep a round on the server.
// WHAT THE AI CANNOT DO, said in the words the AI reads: press anything on the page, see a room, a player or a guess, play, or spend credits. Nothing is written or started by either tool.
// THE GATE: both tools first ask the account's own switch list and department list (the connector's existing switches() and departments()): they answer only when the switch `games` is on for the account or
// the Games department already says `working` for it. Otherwise each refuses in plain words; if neither list can be read it refuses too (fails closed). All words here are DRAFTS for Ryan's yes. Pure TypeScript, no network.
import type { ToolCtx, ToolDef, ToolResult } from "./types.ts";

const obj = (properties: Record<string, unknown> = {}, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text, data });
const refuse = (text: string, code: string, data?: Record<string, unknown>): ToolResult => ({ text, isError: true, code, ...(data ? { data } : {}) });

/** The Games page in the Ryagram app (the department page the top bar opens) and the players' page. Paths on the Ryagram site, never an address with a key in it. Both read from GAMES' pages (app-games.js, game-phone/index.html). */
export const GAMES_PAGE_PATH = "/app/#/d/games";
export const PLAYERS_PAGE_PATH = "/game-phone/";

/** The numbers on GAMES' page today, each read from its code: MAX_PLAYERS 8 and ROUND_SECONDS 45 (app-games.js), five rounds in each pack (game-rounds.js, game-gap-rounds.js), the room code is 4 letters (game-room.js CODE_LEN).
 *  The host's Start button stays off until one player has joined, so the least is 1. If GAMES changes one of them the page is right and this changes in the same step. */
export const GAMES_FACTS = Object.freeze({ players_min: 1, players_max: 8, rounds_per_game: 5, seconds_per_round: 45, room_code_letters: 4 });

const num = (n: number) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? String(n);
export interface GameListed { id: string; label: string; line: string }
/** The games on offer today: the two the host picks between under "Which game?". The names and the one line of each are GAMES' own words on the page (app-games.js), put in the person's voice. */
export const GAMES_OFFERED: readonly GameListed[] = Object.freeze([
  Object.freeze({ id: "guess_the_next_line", label: "Guess the next line", line: "The host reads out the start of a line and stops; everyone types on their phone the words they think come next." }),
  Object.freeze({ id: "fill_the_gap", label: "Fill the gap", line: "The host reads out a line with one word missing; everyone types the missing word on their phone." }),
]);

/** The steps, in the person's words. They follow the Games page as GAMES builds it (its own button and heading names in quotes): if the page looks different, the page is right. */
export const HOW_A_ROUND_GOES: readonly string[] = Object.freeze([
  `Open Games from the top bar in Ryagram, signed in (the page is at ${GAMES_PAGE_PATH}). Under "Waiting for players" the screen shows a room code of ${num(GAMES_FACTS.room_code_letters)} letters straight away.`,
  'Under "Which game?" the host picks Guess the next line or Fill the gap.',
  `Players open the players' page on their phones (${PLAYERS_PAGE_PATH}) and type the room code and a name for the scoreboard. No sign-in is needed on a phone. Up to ${GAMES_FACTS.players_max} players can join, a name can be used once in a room, and no new player can join after the game has started.`,
  `The host presses "Start the game" (it works once at least one player has joined). A game is ${num(GAMES_FACTS.rounds_per_game)} rounds. In each round the host reads the line aloud and the players type on their phones, for up to ${GAMES_FACTS.seconds_per_round} seconds or until everyone has sent.`,
  `Then the host's screen shows the answer, each player's points and which words they got, and each phone shows the answer and its own points. After round ${num(GAMES_FACTS.rounds_per_game)} the final scores show on the screen and on the phones, and "Play again with the same players" starts over.`,
]);

/** What the page says about itself and its limits, in GAMES' own words (its draft note, its paper, its review notes). Said to the AI so it does not promise more than the page is. */
export const ABOUT_THE_GAMES: readonly string[] = Object.freeze([
  `The page marks this as a draft: the ${num(GAMES_FACTS.rounds_per_game)} rounds are the same sample rounds each time, made from a made-up script, and there is no video, so the host reads the line aloud.`,
  "Points follow one rule in both games: exact words score the most, near forms (such as a plural) and a one-letter typo in a long word earn part, and word order matters.",
  "Names and guesses pass between the host's screen and the phones and are not kept. Closing the host's page ends the room.",
  "The room code is the only lock on a room, so it is meant for friends: the host should share it only with the people who are playing.",
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
      return ok(games.map((g) => `- ${g.id}: ${g.label}. ${g.line}`).join("\n") + `\nThe host picks one under "Which game?" before starting. To see where to play, call open_games_page.`, { ok: true, games });
    },
  };

  const openGamesPage: ToolDef = {
    name: "open_games_page", title: "Find the Games page", scope: "read", readOnly: true, idempotent: true,
    description: "Tells the person where Games is in Ryagram and how a game is run, in words: where the host picks a game and starts it, where the players join with a room code, and what the host's screen shows. "
      + "Read-only; nothing is started. You cannot press anything on the page, see a room, its players or their guesses, play, or change anything: a game lives on the host's own screen and the players' phones, "
      + "so the person runs it themselves. Nothing here spends credits. If games are not open for this person yet, it says so plainly: tell them, and do not promise a date.",
    inputSchema: obj(),
    async run(_a, ctx) {
      { const g = await gate(ctx, "The Games page"); if (g) return g; }
      return ok(["Games is open for this person. How a game goes (these steps follow the Games page as it is built: if the page looks different, the page is right):",
        ...HOW_A_ROUND_GOES.map((s, i) => `${i + 1}. ${s}`),
        ...ABOUT_THE_GAMES,
        "You cannot press anything on the page, see the room, the players or their guesses, or play: the person and their players do that on their own screens."].join("\n"),
        { ok: true, page_path: GAMES_PAGE_PATH, players_page_path: PLAYERS_PAGE_PATH, steps: [...HOW_A_ROUND_GOES], notes: [...ABOUT_THE_GAMES], facts: { ...GAMES_FACTS },
          ai_can: ["say where Games is and how a game goes", "list the games"], ai_cannot: ["press anything on the page", "see a room, its players or their guesses", "play", "start or end a round"] });
    },
  };

  return [listGames, openGamesPage];
}
