// The plain words the connector hands an AI (and so, when the AI repeats them, a person) when a call is refused or cannot go on.
// DRAFTS for Ryan's yes (CONNECT 11-27, proposals/CONNECT-ERROR-WORDS-1127.md). WORDS ONLY: no status code, error code, limit or rule lives here, and a number in a sentence is read from the code that enforces it.
// Every sentence says what happened, what is NOT lost, and what to do next. No price. "An AI cannot spend credits; the person presses the button in the Ryagram app" is the one rule they all keep.
import { LIMITS } from "./types.ts";

/** The sign-in behind a call is missing, has ended or was removed (HTTP 401; also what the database says for a dead token, PT401). */
export const SIGNED_OUT = "This AI is not signed in to Ryagram, or its sign-in has ended. Nothing was done, and nothing in the account was lost. To go on, connect Ryagram again in the AI app and sign in when it asks.";

/** No live connection for this account: removed, switched off for everyone, or an account that may not connect an AI. */
export const NO_GRANT = "This AI cannot use this Ryagram account right now: the connection may have been removed, AI connections may be switched off, or the account may not be allowed to connect an AI. Nothing was done, and nothing was lost. "
  + "The person can open Account, then Connected AIs, in the Ryagram app to connect again; if Connected AIs is not there, connecting is not open to this account yet, and they can ask for it from the Help page.";

/** The sign-in or the AI connections are switched off for everyone right now (the database's own sentence for it, PT403 and PT400 'unavailable'). */
export const SWITCHED_OFF = "AI connections to Ryagram are switched off right now, so nothing was done. Nothing in the account was lost. Try again later.";

/** A request over the size limit (HTTP 413). */
export const tooBig = () => `That request was too big for Ryagram to accept (the limit is ${Math.round(LIMITS.maxBodyBytes / 1024)} KB). Nothing was saved. Send less in one go.`;

/** What each permission lets an AI do, in the words the person saw on the consent page. */
const PERMISSION_WORDS: Record<string, string> = {
  read: "see the person's projects, films and credits",
  write: "create projects and change film stories",
  render_free: "make contact sheets and previews",
  edit: "change the look and the clip list in the person's open editor",
  fetch_data: "ask the Ryagram app to download a public data file",
  submit_data: "hand over a table of data for the person to accept",
};
/** The call needed a permission this AI was not given when it was connected. */
export const noPermission = (scope: string) =>
  `This AI was not given permission to ${PERMISSION_WORDS[scope] ?? "do that"} when it was connected, so nothing was done. There is no switch for it in Ryagram. `
  + "To add it, the person opens Account, then Connected AIs, in the Ryagram app and presses Disconnect, then connects the AI again from the AI app and leaves the box for that permission ticked on the Ryagram page.";

/** The database's own sentences that are plainer here. Matched whole and only for the codes friendlyError already lets through, so a changed or unknown sentence is shown as the database wrote it. */
export const SQL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  "Sign in to Ryagram to use this connection.": SIGNED_OUT,
  "AI connections to Ryagram are switched off right now.": SWITCHED_OFF,
  "This account is not enabled for AI connections, or the connection was revoked or does not allow that.": NO_GRANT,
  "daily_cap: you have reached today's credit limit. Try again tomorrow.": "The person has reached today's limit on how many credits can be used, so nothing was started. Nothing was lost. They can try again later.",
  "daily_cap: this person has reached their daily credit cap; approve later or decline.": "The person has reached today's limit on how many credits can be used, so nothing was started. Nothing was lost. They can try again later.",
  "Full renders cannot be started from an AI connection yet. Start it in the Ryagram app.": "An AI cannot start a full film render. Nothing was started and no credits were used. The person starts the final film themselves by pressing 'Render final film' in the Ryagram app.",
  "This would cost credits. Credits can only be spent from the Ryagram app for now; start it there.": "This needs credits, and an AI cannot spend credits. Nothing was started and no credits were used. If the person has credits, they can start it themselves in the Ryagram app.",
});
