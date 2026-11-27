// Guess the next line: the guess scorer, in the browser. A PORT of the Ryagram engine's guess_line.score_guess (ryagram/games/guess_line.py),
// with the word rules it uses: supercut/text.py normalize_word (version 2: NFKC, smart apostrophes, accented letters folded, the
// hand table for letters NFKD does not split) and normalize_phrase, and library/find.py loose_keys (numbers, -ing / -ed / -es / -s).
// It must give EXACTLY the engine's numbers and words: tests/game-score.test.mjs proves it against tests/fixtures/game-score-golden.json,
// which tools/make-game-rounds.py writes by running the real Python engine. Change the engine first, then this, then rerun both.
// Python details kept on purpose: str.split() whitespace (it differs from JS \s), round() is round-half-even on the exact binary
// value, and the stripped marks are the combining ones (unicodedata.combining). No network, no storage, nothing stored.
(function () {
  'use strict';
  var NEAR_CREDIT = 0.6;
  var WEIGHT_FLOOR = 0.5;
  var APOSTROPHES = { '\u2018': "'", '\u2019': "'", '\u02bc': "'", '\u00b4': "'", '`': "'" };
  var UNFOLDED = { '\u00df': 'ss', '\u1e9e': 'ss', '\u00e6': 'ae', '\u00c6': 'ae', '\u00f8': 'o', '\u00d8': 'o', '\u0153': 'oe', '\u0152': 'oe',
    '\u0142': 'l', '\u0141': 'l', '\u0111': 'd', '\u0110': 'd', '\u00fe': 'th', '\u00de': 'th' };
  var NUMBERS = { '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight',
    '9': 'nine', '10': 'ten', '11': 'eleven', '12': 'twelve', '13': 'thirteen', '14': 'fourteen', '15': 'fifteen',
    '16': 'sixteen', '17': 'seventeen', '18': 'eighteen', '19': 'nineteen', '20': 'twenty' };
  var NUMBER_WORDS = Object.keys(NUMBERS).map(function (k) { return NUMBERS[k]; });
  var VOWELS = 'aeiou';
  // Python str.split() splits on str.isspace(): this list, NOT JS \s (which adds U+FEFF and leaves out U+001C..U+001F and U+0085)
  var PY_SPACE = /[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/;
  var BETWEEN = /[\-\u2010-\u2015\/\\\u2026]+|\.{2,}/g;      // hyphens, dashes, slashes, an ellipsis: between words, a space
  var MARK = /\p{M}/gu;                                      // the combining marks NFKD splits off (unicodedata.combining)
  var KEEP = /[^a-z0-9']+/g;
  // letters added to Unicode after 15.0 (the engine's Python 3.12 unicodedata): Python leaves them as they are and then drops them as not a-z, but this browser's
  // newer tables would fold them to plain letters (U+A7F1, the outlined letters and digits U+1CCD6..U+1CCF9). They become U+FFFF, which no table changes, so they are dropped too.
  var NEWER_THAN_ENGINE = /[\uA7F1\u{1CCD6}-\u{1CCF9}]/gu;
  var EDGE_APOS = /^'+|'+$/g;
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  var mapChars = function (s, table) { var out = ''; for (var c of s) out += has(table, c) ? table[c] : c; return out; };

  function normalizeWord(word) {
    var w = mapChars(mapChars(String(word).replace(NEWER_THAN_ENGINE, '\uFFFF').normalize('NFKC'), APOSTROPHES), UNFOLDED);
    w = w.normalize('NFKD').replace(MARK, '');
    w = w.normalize('NFKC').toLowerCase();
    return w.replace(KEEP, '').replace(EDGE_APOS, '');
  }

  function normalizePhrase(phrase) {
    return String(phrase).split(PY_SPACE).map(normalizeWord).filter(function (t) { return t; });
  }

  function looseKeys(word) {
    var w = (word || '').replace(/'/g, '');
    if (has(NUMBERS, w)) return [NUMBERS[w]];
    if (NUMBER_WORDS.indexOf(w) >= 0) return [w];
    var ks = [w];
    var sufs = ['ing', 'ed', 'es', 's'];
    for (var s = 0; s < sufs.length; s++) {
      var suf = sufs[s];
      if (!w.endsWith(suf) || w.length - suf.length < 3) continue;
      var base = w.slice(0, -suf.length);
      if (suf === 'es') {
        if (!/(s|x|z|ch|sh)$/.test(base)) continue;
        ks.push(base);
      } else if (suf === 's') {
        if (w.endsWith('ss')) continue;
        ks.push(base);
      } else {
        ks.push(base);
        var b1 = base[base.length - 1], b2 = base[base.length - 2];
        if (VOWELS.indexOf(b2) >= 0 && (VOWELS + 'wxy').indexOf(b1) < 0) ks.push(base + 'e');
        if (base.length >= 3 && b1 === b2 && (VOWELS + 'lsz').indexOf(b1) < 0) ks.push(base.slice(0, -1));
      }
      break;
    }
    return Array.from(new Set(ks)).sort();
  }

  function oneEdit(a, b) {
    if (a === b) return false;
    if (a.length === b.length) {
      var diff = 0;
      for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) diff++;
      return diff === 1;
    }
    var s = a.length < b.length ? a : b, l = a.length < b.length ? b : a;
    for (var k = 0; k < l.length; k++) if (l.slice(0, k) + l.slice(k + 1) === s) return true;
    return false;
  }

  function credit(g, a) {
    if (g === a) return 1.0;
    var ka = looseKeys(a);
    if (looseKeys(g).some(function (k) { return ka.indexOf(k) >= 0; })) return NEAR_CREDIT;
    if (g.length >= 5 && a.length >= 5 && Math.abs(g.length - a.length) <= 1 && oneEdit(g, a)) return NEAR_CREDIT;
    return 0.0;
  }

  function guessWords(guess, answer) {
    var parts = normalizePhrase(String(guess || '').replace(BETWEEN, ' '));
    var keys = new Set(answer);
    var out = [], i = 0;
    while (i < parts.length) {
      if (i + 1 < parts.length && keys.has(parts[i] + parts[i + 1]) && !(keys.has(parts[i]) && keys.has(parts[i + 1]))) {
        out.push(parts[i] + parts[i + 1]); i += 2;
      } else {
        out.push(parts[i]); i += 1;
      }
    }
    return out;
  }

  function wordsLeft(round) { return round.answer.length; }

  function basePoints(round) {
    return 40.0 + 40.0 * round.rarity + 20.0 * Math.min(wordsLeft(round), 10) / 10.0;
  }

  // Python round(x): to the nearest integer, a tie to the even one
  function pyRoundInt(x) {
    var f = Math.floor(x), d = x - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }
  // Python round(x, 4) for x >= 0: the 4-place decimal nearest the EXACT binary value, and an exact tie goes to the even last digit. toFixed also uses the exact
  // value but sends a tie UP, and ties do happen (0.25 x 0.125 = 0.03125 exactly: Python says 0.0312, toFixed(4) says 0.0313). toFixed(60) shows a tie exactly:
  // 5 at the fifth place and zeros after (a double near 0..1 that is not a tie differs from one by far more than 1e-60).
  function pyRound4(x) {
    var full = x.toFixed(60), dot = full.indexOf('.');
    var tie = full[dot + 5] === '5' && /^0+$/.test(full.slice(dot + 6));
    if (tie && Number(full[dot + 4]) % 2 === 0) return Number(full.slice(0, dot + 5));
    return Number(x.toFixed(4));
  }

  function scoreGuess(round, guess) {
    var a = round.answer.map(function (w) { return w.norm; });
    var wt = round.answer.map(function (w) { return WEIGHT_FLOOR + w.rarity; });
    var g = guessWords(guess, a);
    var cap = 3 * a.length + 5;
    var truncated = g.length > cap;
    g = g.slice(0, cap);
    var marks = round.answer.map(function (w) { return { word: w.word, mark: 'missed' }; });
    if (!g.length) return { points: 0, accuracy: 0.0, verdict: 'no guess', marks: marks, truncated: false };
    var n = a.length, m = g.length, i, j, c;
    var dp = [];
    for (i = 0; i <= n; i++) { dp.push([]); for (j = 0; j <= m; j++) dp[i].push(0.0); }
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        c = credit(g[j - 1], a[i - 1]);
        var take = c ? dp[i - 1][j - 1] + c * wt[i - 1] : -1.0;
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1], take);
      }
    }
    i = n; j = m;
    var got = 0.0;
    while (i > 0 && j > 0) {
      c = credit(g[j - 1], a[i - 1]);
      if (c && Math.abs(dp[i][j] - (dp[i - 1][j - 1] + c * wt[i - 1])) < 1e-9) {
        marks[i - 1].mark = c === 1.0 ? 'exact' : 'near';
        got += c;
        i -= 1; j -= 1;
      } else if (dp[i][j] === dp[i - 1][j]) {
        i -= 1;
      } else {
        j -= 1;
      }
    }
    var sumWt = 0.0;
    for (i = 0; i < wt.length; i++) sumWt += wt[i];
    var coverage = dp[n][m] / sumWt;
    var precision = Math.min(1.0, got / m);
    var accuracy = coverage * precision;
    var verdict;
    if (marks.every(function (x) { return x.mark === 'exact'; }) && m === n) verdict = 'exact';
    else if (accuracy >= 0.8) verdict = 'close';
    else if (accuracy >= 0.4) verdict = 'partial';
    else if (accuracy > 0) verdict = 'a few words';
    else verdict = 'miss';
    return { points: pyRoundInt(accuracy * basePoints(round)), accuracy: pyRound4(accuracy), verdict: verdict, marks: marks, truncated: truncated };
  }

  window.ryagramGameScore = Object.freeze({ normalizeWord: normalizeWord, normalizePhrase: normalizePhrase, looseKeys: looseKeys, credit: credit,
    oneEdit: oneEdit, guessWords: guessWords, basePoints: basePoints, scoreGuess: scoreGuess });
})();
