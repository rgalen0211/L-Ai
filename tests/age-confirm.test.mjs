// "I am 18 or older." (Ryan 11-21: age 18+). A required box on both sign-up forms (Create an account, and the invite-code form). It BLOCKS the sign-up on the page: unticked, no request is sent.
// The tick IS passed on (adult_confirmed: true) and recorded: the join function refuses anything else (ADULT_WORDS) and migration 20261121000800 copies it to public.account_adult_confirmation when the account is made. The page says nothing more about it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const load = () => { const win = { ryagramConfig: { waitingAccounts: true } }; vm.runInNewContext(read('assets/app-waiting.js'), { window: win, location: { origin: 'https://uselai.com' } }); return win.ryagramWaiting; };

test('only a real tick (the value true) passes the age check; the problem is in plain words', () => {
  const W = load();
  assert.equal(W.ageProblem(true), null);
  for (const x of [false, undefined, null, 'true', 'on', 1, 0, '', {}, ['x']]) assert.match(W.ageProblem(x), /18 or older/, String(JSON.stringify(x)));
});

test('unticked sends nothing; ticked passes the tick to the join call', async () => {
  const W = load(); const calls = [];
  const data = { joinWaiting: async (...a) => { calls.push(a); return { ok: true, off: false, message: 'sent' }; } };
  for (const x of [false, undefined, null, 'true', 1]) {
    const r = await W.signUp(data, 'a@b.co', x);
    assert.equal(r.ok, false); assert.match(r.message, /18 or older/);
  }
  assert.equal(calls.length, 0, 'no request when unticked');
  assert.deepEqual(await W.signUp(data, ' a@b.co ', true), { ok: true, off: false, message: 'sent' });
  assert.deepEqual(calls, [['a@b.co', true]], 'ticked: the trimmed email, and the tick passed on');
  assert.match(read('assets/app-data.js'), /functions\.invoke\('join', \{ body: \{ email: String\(email \|\| ''\)\.trim\(\), adult_confirmed: true \} \}\)/);
});

test("the invite-code form: redeem-invite (CONNECT 16b0bde5 refuses without the boolean) gets { code, email, adult_confirmed: true } and only when the box is ticked", () => {
  assert.match(read('assets/app-auth.js'), /functions\.invoke\('redeem-invite', \{\s*body: \{ code: inviteForm\.elements\.code\.value, email: inviteForm\.elements\.email\.value\.trim\(\), adult_confirmed: true \}/);
});

test('both sign-up forms have the box: a label with the words, not native "required" (so the error line shows), described by the error line', () => {
  const html = read('app/index.html');
  for (const [id, err] of [['ca-age', 'create-account-error'], ['iv-age', 'invite-error']]) {
    const m = html.match(new RegExp(`<label class="choice age-choice" for="${id}"><input id="${id}" name="over18" type="checkbox" aria-describedby="${err}" aria-required="true"><span>I am 18 or older\\.</span></label>`));
    assert.ok(m, id);
    assert.ok(html.includes(`id="${err}"`) && /role="alert"/.test(html.match(new RegExp(`<p id="${err}"[^>]*>`))[0]), `${err} is a live error line`);
  }
  assert.ok(!/id="(ca|iv)-age"[^>]*\srequired/.test(html), 'the page draws its own error line instead of the browser balloon');
  assert.match(read('assets/app.css'), /\.age-choice\{[^}]*min-height:44px/);
});

test('the page checks the box before any request on both forms, and focuses it', () => {
  const src = read('assets/app-auth.js');
  const ca = src.indexOf('ageProblem(f.over18.checked)'), caSend = src.indexOf('ryagramWaiting.signUp(');
  assert.ok(ca > 0 && caSend > ca, 'Create an account: the age check comes before the sign-up call');
  assert.match(src, /if \(ageBad\) \{[^}]*f\.over18\.focus\(\); return; \}/);
  const iv = src.indexOf('inviteForm.elements.over18.checked'), ivSend = src.indexOf("client.functions.invoke('redeem-invite'");
  assert.ok(iv > 0 && ivSend > iv, 'invite code: the age check comes before the redeem call');
  assert.match(src, /if \(ivAge\) \{[^}]*inviteForm\.elements\.over18\.focus\(\); return; \}/);
});

test('honest words: nothing on the page says the confirmation is recorded or kept', () => {
  const html = read('app/index.html');
  for (const id of ['create-account', 'sign-in']) {
    const panel = html.slice(html.indexOf(`<section id="${id}"`), html.indexOf('</section>', html.indexOf(`<section id="${id}"`)));
    const near = panel.match(/[^<>]*18[^<>]*/g).join(' ');
    assert.ok(!/record|stored|kept|saved|logged|verif/i.test(near), id);
  }
  assert.ok(!/record|stored|kept|saved/i.test(read('assets/app-data.js').match(/async joinWaiting[\s\S]*?\n      },/)[0].replace(/\/\/.*$/gm, '')), 'no words about recording in the join call');
});

test('the page comment no longer says the tick is not stored (GAMES 11-25 09:04 (3)); the join function and the migration both carry it', () => {
  const page = read('assets/app-waiting.js');
  assert.doesNotMatch(page, /NOT stored with the account/);
  assert.match(page, /adult_confirmed: true/);
  assert.match(read('supabase/functions/join/join.ts'), /body.adult_confirmed !== true/);
  assert.match(read('supabase/migrations/20261121000800_join_open.sql'), /account_adult_confirmation/);
});
