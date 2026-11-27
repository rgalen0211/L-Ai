// GAMES 11-27 (hold 2, names): the ONE name rule for the live game room, used by the host (every join) and the phone (before it sends). A port of FACES' reference filter
// (Ryagram-logs/proposals/FACES-game_name_filter-1127.py, its 41 test cases are in tests/game-names.test.mjs) to plain browser JS, same steps in the same order:
//   1. hidden characters (control, format such as zero-width and bidi, surrogate, private use, unassigned, line/paragraph separator) -> refused, never silently cleaned;
//   2. tabs and runs of spaces become one space, NFKC, trimmed; empty -> refused; more than 16 characters -> refused (never cut for the player);
//   3. web or email addresses, then more than 3 digits (a phone number) -> refused;
//   4. at least one letter; only letters (any alphabet), marks, digits, space and ' - . ;
//   5. no word may mix alphabets (a Cyrillic 'a' inside a Latin word is how look-alike names are made);
//   6. reserved and blocked WHOLE words, compared after folding case and accents, then also after a leetspeak fold, joining runs of one-letter words ('h o s t', 'a.d.m.i.n')
//      and squashing 3+ repeated letters ('hoooost'). Whole words only, so 'Scunthorpe', 'Hostel Pete' and 'Admiral Ann' pass;
//   7. an optional second list of long distinctive stems matched INSIDE words (empty unless GAMES supplies one).
// THE ABUSE LIST SHIPS EMPTY. The real list is a data decision for Ryan/GAMES with its own recorded source; setBlocked(words, stems) adds it later. Tests use invented stand-ins.
// This is a speed bump for a family room, not moderation: the host's Remove button is the real answer.
// THREE ADDITIONS beyond FACES' reference, so switching the host and phone to this file loses nothing the old rule in app-games.js caught:
//   a. characters that show as nothing but are letters or marks (Default_Ignorable_Code_Point: Hangul fillers U+3164/U+FFA0/U+115F/U+1160, the combining grapheme joiner,
//      variation selectors) count as hidden characters; a lone Hangul filler would otherwise be a blank name;
//   b. more than 3 marks stacked on one letter (the tall 'glitch text' look) is refused with the characters words.
//   c. nameKey also maps the common Cyrillic, Greek and small-capital look-alikes to Latin (the old host fold did), so an all-Cyrillic 'Pop' is the same name as 'Pop'.
// Plain ASCII source: every non-ASCII character is written as a \u escape.
(function () {
  const NAME_MAX = 16, MAX_STACKED_MARKS = 3;
  // FACES' reference list (its section 2 table names ten; the reference code also holds 'administrator' and 'mod', kept here).
  const RESERVED = Object.freeze(['host', 'admin', 'administrator', 'moderator', 'mod', 'system', 'ryagram', 'game', 'tv', 'everyone', 'staff', 'support']);
  const RESERVED_SET = new Set(RESERVED);
  const LEET = Object.freeze({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '$': 's', '!': 'i', '|': 'i', '+': 't' });
  const ALLOWED_PUNCT = " '-.";
  const URL_LIKE = /(https?|ftp)|www|:\/\/|[a-z0-9]\.[a-z]{2,}/iu;
  const HIDDEN = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
  const STACKED = new RegExp(`\\p{M}{${MAX_STACKED_MARKS + 1},}`, 'u');
  const WORDS = Object.freeze({
    empty: 'Type a name to join.',
    long: 'Use 16 letters or fewer.',
    hidden: 'That name has hidden characters. Type it again.',
    noletter: 'Use at least one letter in your name.',
    web: 'Leave out web addresses and email addresses.',
    phone: 'Leave out phone numbers.',
    chars: 'Use letters, numbers, spaces, apostrophes and dashes only.',
    script: 'Use one alphabet in each word.',
    reserved: 'That name belongs to the game. Pick another.',
    blocked: 'Please pick a different name.',                 // never says which word matched
    taken: 'Someone in this room already has that name. Add a letter or pick another.',
  });
  // Scripts a letter can belong to (Unicode Script property). A letter in none of these counts as 'Other'.
  const SCRIPTS = ['Latin', 'Cyrillic', 'Greek', 'Armenian', 'Georgian', 'Hebrew', 'Arabic', 'Syriac', 'Thaana', 'Nko', 'Devanagari', 'Bengali', 'Gurmukhi', 'Gujarati',
    'Oriya', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Sinhala', 'Thai', 'Lao', 'Tibetan', 'Myanmar', 'Khmer', 'Mongolian', 'Ethiopic', 'Cherokee',
    'Canadian_Aboriginal', 'Ogham', 'Runic', 'Hangul', 'Hiragana', 'Katakana', 'Bopomofo', 'Han', 'Yi', 'Tifinagh', 'Vai', 'Javanese', 'Balinese', 'Sundanese',
    'Tagalog', 'Coptic', 'Glagolitic', 'Common', 'Inherited'].map(s => [s, new RegExp(`\\p{Script=${s}}`, 'u')]);
  // Look-alikes for nameKey (copied from the host's old fold in app-games.js): Cyrillic, Greek and small capitals that read as Latin letters.
  const LOOK_FROM = '\u0430\u0435\u043e\u0440\u0441\u0443\u0445\u0456\u0458\u0455\u0501\u03b1\u03bf\u03c1\u03bd\u03b9\u03ba\u03c7\u03b5\u03c5\u03c4\u04bb\u051b\u051d\u1d00\u0299\u1d04\u1d05\u1d07\u0262\u029c\u026a\u1d0a\u1d0b\u029f\u1d0d\u0274\u1d0f\u1d18\u0280\ua731\u1d1b\u1d1c\u1d20\u1d21\u028f\u1d22';
  const LOOK_TO = 'aeopcyxijsdaopvikxeuthqwabcdeghijklmnoprstuvwyz';

  let blocked = new Set();          // EMPTY on purpose (see the header)
  let stems = [];

  const fail = key => ({ why: 'name', words: WORDS[key], key });
  const chars = s => [...s];
  // Python's str.casefold(), closely: upper then lower turns 'ss'-type letters into their folded form (sharp s -> ss, final sigma -> sigma).
  const casefold = s => s.toUpperCase().toLowerCase();
  // Lower case, NFKD, marks dropped ('Zo\u00eb' -> 'zoe').
  const fold = s => casefold(s).normalize('NFKD').replace(/\p{M}/gu, '');
  const tokens = s => s.split(/[^a-z0-9]+/).filter(Boolean);
  const squash = w => w.replace(/(.)\1{2,}/g, '$1');          // 'hoooost' -> 'host'
  const leet = s => s.replace(/[0134578$!|+]/g, c => LEET[c]);
  const scriptOf = c => { for (const [n, re] of SCRIPTS) if (re.test(c)) return n; return 'Other'; };

  // Every spelling of the name worth comparing, as lists of whole words (same order as the reference).
  function forms(name) {
    const plain = fold(name), out = [];
    for (const useLeet of [false, true]) {
      const words = tokens(useLeet ? leet(plain) : plain);
      out.push(words, words.map(squash));
      const merged = []; let run = '';
      for (const w of words) {
        if (w.length === 1) run += w;
        else { if (run) { merged.push(run); run = ''; } merged.push(w); }
      }
      if (run) merged.push(run);
      out.push(merged, merged.map(squash));
    }
    return out;
  }

  // The string two names are compared by for "already taken": case, accents, look-alikes, spaces, dots and dashes ignored ('Ana', 'ANA', 'A.na', 'An\u00e1' are one name).
  function nameKey(name) {
    return fold(String(name ?? '')).replace(/[^\x00-\x7f]/g, c => { const i = LOOK_FROM.indexOf(c); return i >= 0 ? LOOK_TO[i] : c; }).replace(/[^\p{L}\p{N}]+/gu, '');
  }

  // The name as it will show (spaces tidied, NFKC), or a refusal { why:'name', words, key }.
  function check(raw) {
    if (typeof raw !== 'string') return fail('empty');
    for (const c of raw) if (c !== '\t' && HIDDEN.test(c)) return fail('hidden');
    const name = raw.replace(/\t/g, ' ').normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!name) return fail('empty');
    if (chars(name).length > NAME_MAX) return fail('long');
    if (name.includes('@') || URL_LIKE.test(name)) return fail('web');
    if ((name.match(/\p{Nd}/gu) || []).length > 3) return fail('phone');
    if (!/\p{L}/u.test(name)) return fail('noletter');
    for (const c of name) if (!(/[\p{L}\p{M}\p{N}]/u.test(c) || ALLOWED_PUNCT.includes(c))) return fail('chars');
    if (STACKED.test(name)) return fail('chars');
    for (const word of name.split(' ')) {
      const scripts = new Set(chars(word).filter(c => /\p{L}/u.test(c)).map(scriptOf));
      if (scripts.size > 1) return fail('script');
    }
    const all = forms(name);
    for (const words of all) for (const w of words) {
      if (RESERVED_SET.has(w)) return fail('reserved');
      if (blocked.has(w)) return fail('blocked');
    }
    if (stems.length) for (const words of all) { const joined = words.join(''); if (stems.some(s => joined.includes(s))) return fail('blocked'); }
    return { name };
  }

  // null when the name is fine (and not already in the room), else { why:'name', words } with the words the player sees. taken: names (or players with .name) in the room.
  function problem(name, taken = []) {
    const r = check(name);
    if (!r.name) return { why: r.why, words: r.words };
    const key = nameKey(r.name);
    if ((Array.isArray(taken) ? taken : []).some(t => nameKey(t && typeof t === 'object' ? t.name : t) === key)) return { why: 'name', words: WORDS.taken };
    return null;
  }
  // The name tidied as it will show, or null when it is refused.
  const cleanName = name => check(name).name ?? null;

  // A data list (one lowercase word each), whole-word matched; stems (6+ letters advised) are matched inside words. Replaces the current lists; [] empties them.
  function setBlocked(words = [], stemWords = []) {
    const tidy = a => (Array.isArray(a) ? a : []).filter(w => typeof w === 'string').map(w => casefold(w.trim())).filter(Boolean);
    blocked = new Set(tidy(words));
    stems = tidy(stemWords);
  }

  window.ryagramGameNames = Object.freeze({ problem, nameKey, cleanName, setBlocked, RESERVED, WORDS, NAME_MAX });
})();
