// The render worker's limits for a TITLE card, checked in the browser BEFORE a story is saved (so the person hears it from us, in plain words,
// not from a failed render). These numbers are the worker's own (ryagram/worker/schema.py, TITLE: Ryan's W2 ruling, 2026-10-05; confirmed 2026-10-12):
//   length 0.5 to 12 seconds (required) | headline at most 160 characters | subhead at most 320 | credit at most 160 | fade 0 to 2
//   a headline or a subhead is required | headline and subhead may hold a line break ("\n"); no control or invisible character anywhere
// Characters are counted as Python counts them (code points, not UTF-16 units). The same rules, in TypeScript, are in
// supabase/functions/_shared/title_limits.ts (the AI editor); tests/title-limits.test.mjs holds the two together and to the worker's constants.
(() => {
  const TITLE = Object.freeze({ minSeconds: 0.5, maxSeconds: 12, headline: 160, subhead: 320, credit: 160, minFade: 0, maxFade: 2 });
  const BAD = /\p{Cc}|\p{Cf}|\p{Cs}|\p{Co}|\p{Cn}/u;
  const count = s => Array.from(s).length;
  const NAMES = { headline: 'headline', subhead: 'subhead', credit: 'credit line' };

  // Plain sentences, one per problem, for every title card in the story; [] when every card is within the limits.
  function titleProblems(story) {
    const out = [];
    const clips = story && story.sequence && Array.isArray(story.sequence.clips) ? story.sequence.clips : [];
    clips.forEach((c, i) => {
      if (!c || typeof c !== 'object' || c.kind !== 'title') return;
      const who = `Title card ${i + 1}${typeof c.id === 'string' && c.id ? ` (${c.id.slice(0, 40)})` : ''}`;
      if (typeof c.seconds !== 'number' || !Number.isFinite(c.seconds)) out.push(`${who} needs a length in seconds, from ${TITLE.minSeconds} to ${TITLE.maxSeconds}.`);
      else if (c.seconds < TITLE.minSeconds || c.seconds > TITLE.maxSeconds) out.push(`${who} runs ${c.seconds} seconds; a title card can run ${TITLE.minSeconds} to ${TITLE.maxSeconds} seconds.`);
      for (const key of ['headline', 'subhead', 'credit']) {
        if (!(key in c)) continue;
        const v = c[key];
        if (typeof v !== 'string') { out.push(`${who}: the ${NAMES[key]} must be text.`); continue; }
        const n = count(v);
        if (n > TITLE[key]) out.push(`${who}: the ${NAMES[key]} is ${n} characters; the limit is ${TITLE[key]}.`);
        else if (BAD.test(key === 'credit' ? v : v.replace(/\n/g, ''))) out.push(`${who}: the ${NAMES[key]} holds a control or invisible character${key === 'credit' ? ' (a credit line cannot break lines)' : ''}.`);
      }
      if (!('headline' in c) && !('subhead' in c)) out.push(`${who} needs a headline or a subhead.`);
      if ('fade' in c && (typeof c.fade !== 'number' || !Number.isFinite(c.fade) || c.fade < TITLE.minFade || c.fade > TITLE.maxFade)) out.push(`${who}: the fade must be a number from ${TITLE.minFade} to ${TITLE.maxFade} seconds.`);
    });
    return out;
  }

  window.ryagramLimits = { TITLE, titleProblems };
})();
