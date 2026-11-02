// NEXT-WEB 203: the TV screen page for "Guess the next line" (/game-tv/, behind gameTv, OFF). It REPLAYS a recorded sample game night (assets/game-tv-sample.js): FACES' real engine
// (Ryagram ryagram/games/guess_line.py, NEXT-FACES 104) over a MADE-UP transcript, written by tools/make-game-sample.py. The page does not score anything itself: it shows the engine's own public view
// (to_public), reveal and score_guess results. Design: proposals/BUILDER-GAME-ROOM-1102.md way A (one screen, the host's computer). The clip itself would play on this screen in the Ryagram app; this sample has no video.
// The answer is not drawn until the guesses are locked, and the typed guesses are not drawn until then either. Words are drafts for Ryan.
(function () {
  const on = cfg => !!cfg && cfg.gameTv === true;
  const PHASES = ['question', 'locked', 'reveal'];
  const MARK = { exact: { sym: '✓', word: 'right' }, near: { sym: '≈', word: 'nearly' }, missed: { sym: '✗', word: 'missed' } };

  // Competition ranking: the same total shares a place, and the next place is skipped (1, 1, 3).
  function ranks(totals) {
    const rows = Object.entries(totals).map(([player, points]) => ({ player, points })).sort((a, b) => b.points - a.points || a.player.localeCompare(b.player));
    const out = [];
    rows.forEach((r, i) => out.push({ ...r, place: i > 0 && rows[i - 1].points === r.points ? out[i - 1].place : i + 1 }));
    return out;
  }
  const placeWord = n => ({ 1: '1st', 2: '2nd', 3: '3rd' }[n] || `${n}th`);

  // One plain line of why a guess earned what it did, from the engine's own marks.
  function reasonFor(result) {
    const m = result.marks || [], n = m.length, exact = m.filter(x => x.mark === 'exact').length, near = m.filter(x => x.mark === 'near').length;
    if (result.verdict === 'no guess') return 'no guess, so no points';
    if (!exact && !near) return `none of the ${n} words, so no points`;
    return `${exact + near} of the ${n} words${near ? ` (${near} nearly)` : ''}, ${result.verdict}` + (result.truncated ? ', and the guess was cut because it was far too long' : '');
  }
  const timerText = s => (s <= 0 ? 'Time is up' : `${s} second${s === 1 ? '' : 's'} left`);

  // A sample must be what the engine promises before the page will draw it.
  function check(sample) {
    const bad = [];
    if (!sample || sample.schema !== 'ryagram.game-night-sample/0') return ['not a game night sample'];
    if (!Array.isArray(sample.rounds) || !sample.rounds.length) bad.push('no rounds');
    const totals = Object.fromEntries((sample.players || []).map(p => [p, 0]));
    for (const [i, r] of (sample.rounds || []).entries()) {
      if (!r.public || 'answer' in r.public || 'answer_text' in r.public) bad.push(`round ${i + 1}: the public view holds the answer`);
      if (!r.reveal || typeof r.reveal.answer_text !== 'string') bad.push(`round ${i + 1}: no reveal`);
      for (const g of r.guesses || []) { if (!g.result || !Number.isFinite(g.result.points)) bad.push(`round ${i + 1}: ${g.player} has no score`); else totals[g.player] += g.result.points; }
    }
    for (const p of sample.players || []) if (totals[p] !== sample.totals[p]) bad.push(`${p}: the totals do not add up`);
    return bad;
  }

  function mount(root, sample) {
    const el = (tag, attrs, ...kids) => {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); }
      for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
      return n;
    };
    const state = { round: 0, phase: 0, left: sample.timer_s, paused: false, running: {} };
    for (const p of sample.players) state.running[p] = 0;
    let timer = null;
    const live = el('p', { class: 'tv-live', role: 'status', 'aria-live': 'polite' });
    const stage = el('div', { class: 'tv-stage' });
    const next = el('button', { class: 'tv-next', type: 'button', onclick: () => advance() });
    const pause = el('button', { class: 'tv-pause', type: 'button', onclick: () => { state.paused = !state.paused; pause.textContent = state.paused ? 'Resume the timer' : 'Pause the timer'; } }, 'Pause the timer');

    function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
    function startTimer() {
      stopTimer(); state.left = sample.timer_s; state.paused = false; pause.textContent = 'Pause the timer';
      timer = setInterval(() => {
        if (state.paused || PHASES[state.phase] !== 'question') return;
        state.left -= 1;
        const t = stage.querySelector('.tv-timer'); if (t) t.textContent = timerText(state.left);
        if (state.left === 10 || state.left === 5) live.textContent = timerText(state.left);
        if (state.left <= 0) { live.textContent = 'Time is up. The guesses are locked.'; advance(); }
      }, 1000);
    }

    function advance() {
      if (state.round >= sample.rounds.length) { state.round = 0; state.phase = 0; for (const p of sample.players) state.running[p] = 0; draw(); return; }      // the sample again
      if (PHASES[state.phase] === 'reveal') { state.round += 1; state.phase = 0; } else state.phase += 1;
      draw();
    }

    function draw() {
      stopTimer();
      if (state.round >= sample.rounds.length) return final();
      const r = sample.rounds[state.round], phase = PHASES[state.phase], head = el('h2', { tabindex: '-1' }, `Round ${state.round + 1} of ${sample.rounds.length}`);
      const kids = [head];
      if (phase === 'question') {
        kids.push(el('p', { class: 'tv-clipnote' }, '▶ The clip plays on this screen and stops here. (This sample has no video.)'),
          el('p', { class: 'tv-label' }, 'What was said so far'), el('p', { class: 'tv-heard' }, `“${r.public.heard_text} …”`),
          el('p', { class: 'tv-left' }, `${r.public.words_left} words are left to guess: `, el('span', { class: 'tv-blanks', 'aria-hidden': 'true' }, Array(r.public.words_left).fill('____').join(' '))),
          el('p', { class: 'tv-meta' }, `This line is ${r.public.difficulty} in the library.`), el('p', { class: 'tv-timer' }, timerText(state.left)),
          el('p', { class: 'tv-meta' }, 'Players: type or say your guess for the next line.'), pause);
        next.textContent = 'Lock the guesses'; live.textContent = `Round ${state.round + 1}. The clip has stopped. ${r.public.words_left} words are left to guess.`;
        startTimer();
      } else if (phase === 'locked') {
        kids.push(el('p', { class: 'tv-label' }, 'The guesses are in'), el('ul', { class: 'tv-guesses' }, r.guesses.map(g => el('li', {}, el('strong', {}, g.player), ': ', g.text ? `“${g.text}”` : el('em', {}, 'no guess')))));
        next.textContent = 'Reveal the answer'; live.textContent = 'The guesses are locked.';
      } else {
        const earned = Object.fromEntries(r.guesses.map(g => [g.player, g.result.points]));
        for (const p of sample.players) state.running[p] += earned[p] || 0;
        kids.push(el('p', { class: 'tv-label' }, 'The answer'), el('p', { class: 'tv-answer' }, `“${r.public.heard_text} ${r.reveal.answer_text}”`),
          el('p', { class: 'tv-meta' }, `A perfect guess was worth ${Math.round(r.reveal.base_points)} points.`),
          el('ul', { class: 'tv-results' }, r.guesses.map(g => el('li', {},
            el('p', {}, el('strong', {}, g.player), ' ', el('span', { class: 'tv-pts' }, `+${g.result.points}`), ` — ${reasonFor(g.result)}`),
            el('p', { class: 'tv-marks' }, g.result.marks.map(m => el('span', { class: `tv-mark tv-${m.mark}` }, `${MARK[m.mark].sym} ${m.word} (${MARK[m.mark].word})`))),
            g.text ? el('p', { class: 'tv-meta' }, `They wrote: “${g.text}”`) : null))),
          el('h3', {}, 'Scores so far'), board(state.running, earned));
        next.textContent = state.round + 1 >= sample.rounds.length ? 'See the final scores' : 'Next round'; live.textContent = `The answer is: ${r.reveal.answer_text}.`;
      }
      kids.push(next);
      stage.replaceChildren(...kids); head.focus();
    }
    function board(totals, earned) {
      return el('table', { class: 'tv-board' }, el('thead', {}, el('tr', {}, ['Place', 'Player', 'Points', earned ? 'This round' : null].map(t => (t ? el('th', { scope: 'col' }, t) : null)))),
        el('tbody', {}, ranks(totals).map(r => el('tr', {}, el('td', {}, placeWord(r.place)), el('th', { scope: 'row' }, r.player), el('td', {}, String(r.points)), earned ? el('td', {}, `+${earned[r.player] || 0}`) : null))));
    }
    function final() {
      const top = ranks(sample.totals), winners = top.filter(r => r.place === 1).map(r => r.player);
      next.textContent = 'Play the sample again'; live.textContent = `The game is over. ${winners.join(' and ')} ${winners.length > 1 ? 'share' : 'has'} first place.`;
      const head = el('h2', { tabindex: '-1' }, 'Final scores');
      stage.replaceChildren(head, el('p', { class: 'tv-answer' }, winners.length > 1 ? `${winners.join(' and ')} share first place` : `${winners[0]} wins`), board(sample.totals), el('p', { class: 'tv-meta' }, 'A tie shares the place.'), next);
      head.focus();
    }

    document.addEventListener('keydown', ev => { if ((ev.key === 'ArrowRight' || ev.key === 'PageDown') && !ev.altKey && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); advance(); } });
    root.replaceChildren(el('div', { class: 'tv-screen' },
      el('p', { class: 'tv-banner', role: 'note' }, el('strong', {}, 'SAMPLE NIGHT. '), 'A recorded game made by the real engine over a made-up transcript with made-up players. Typing guesses and live scoring run in the Ryagram app on the host’s computer; this page replays the result. Draft words for Ryan.'),
      el('h1', {}, 'Guess the next line'), live, stage, el('p', { class: 'tv-meta' }, 'Keyboard: press the button, or the right arrow key, to go on.')));
    draw();
  }

  window.ryagramGameTv = Object.freeze({ on, ranks, placeWord, reasonFor, timerText, check, mount, PHASES });
  const root = document.getElementById('game-tv'), off = document.getElementById('not-available'), S = window.ryagramGameTvSample;
  if (root && S) {
    const enabled = on(window.ryagramConfig);
    root.hidden = !enabled; if (off) off.hidden = enabled;
    if (enabled) { const bad = check(S); if (bad.length) root.textContent = `The sample did not pass the check (${bad[0]}), so nothing is shown.`; else mount(root, S); }
  }
})();
