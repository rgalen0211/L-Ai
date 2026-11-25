"""Must-fail proof for the checkout tax work (checkout.ts, migration 20261123000900, live steps 69 and 70): each mutant breaks ONE thing in a scratch copy and the matching tests must then FAIL.
Two groups: JS mutants run `node --test tests/stripe.test.mjs`, SQL mutants run supabase/tests/test_checkout_tax.py on a real Postgres. A baseline run of each group on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once.
One runner at a time, alone (it starts Postgres and node). Run from the repo root with TEMP on D: and the pgvenv python:
    pgvenv/Scripts/python tests/connect_checkout_tax_mutants.py
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path(os.environ.get("TEMP", ".")) / "mut-checkouttax"
C = "supabase/functions/stripe-checkout/checkout.ts"
M = "supabase/migrations/20261123000900_checkout_tax_profile.sql"
S69 = "supabase/live-steps/69_buying_open.sql"
S70 = "supabase/live-steps/70_buying_UNDO.sql"

JS = [
    ("a missing answer still opens a checkout", C, '    if (!profile || (profile.use !== "business" && profile.use !== "personal")) {\n      return reply(422, { error: "Tell us whether this is for business or personal use and where you are first.", code: "tax_profile_missing" });\n    }\n', ""),
    ("a credit pack is taxed at checkout", C, 'ctx.mode === "subscription" ? (ctx.tax_rate_id ?? null) : null', "(ctx.tax_rate_id ?? null)"),
    ("a plan with no rate to give is sold untaxed", C, '    if (ctx.mode === "subscription" && ctx.tax_unknown === true) {\n      return reply(503, { error: "Tax for your area isn\'t set up yet. Please try again later.", code: "tax_not_ready" });\n    }\n', ""),
    ("a test key with buying open opens a checkout", C, '    if (action === "checkout" && deps.keyIsTest && ctx.buying_open === true) return reply(503, { error: "Payments aren\'t open yet." });\n', ""),
    ("an administrator may use a test key with buying open", C, "deps.keyIsTest && ctx.buying_open === true)", "deps.keyIsTest && ctx.buying_open === true && ctx.is_admin !== true)"),
    ("the tax rate is not put on the line", C, ", ...(taxRate ? { tax_rates: [taxRate] } : {})", ""),
    ("the idempotency key ignores the rate", C, '${taxRate ?? "none"}-', ""),
    ("the county is not recorded", C, "    if (ctx.tax_county) metadata.tax_county = ctx.tax_county;\n", ""),
]
SQL = [
    ("personal use is taxed", M, " and prof.use = 'business' and prof.country = 'US'", " and prof.country = 'US'"),
    ("a pack is taxed", M, "and v_mode = 'subscription' and prof.use = 'business'", "and v_mode is not null and prof.use = 'business'"),
    ("business outside Ohio is taxed", M, " and prof.state = 'OH' then", " then"),
    ("a missing rate is not unknown", M, "v_unknown := v_rate is null;", "v_unknown := false;"),
    ("an inactive rate is used", M, "where c.county = v_county and r.active;", "where c.county = v_county;"),
    ("a person reads someone else's answer", M, "from public.account_tax_profile t where t.owner_id = (select auth.uid())", "from public.account_tax_profile t where true limit 1"),
    ("the id of the person is given back", M, "select to_jsonb(t) - 'owner_id' from", "select to_jsonb(t) from"),
    ("the answer table is open to a signed-in person", M, "revoke all on public.account_tax_profile from anon, authenticated, service_role;", "revoke all on public.account_tax_profile from anon, service_role;"),
    ("an Ohio business ZIP is not checked", M, "p_use = 'business' and not exists (select 1 from public.ohio_zip_county o where o.zip = z)", "false"),
    ("a US answer needs no state", M, "raise exception 'state_required: Choose your state.';", "null;"),
    ("an anonymous caller may read the answer", M, "revoke execute on function public.my_tax_profile() from public, anon;", "revoke execute on function public.my_tax_profile() from public;"),
    ("step 69 accepts a price id that is still the test one", S69, "    if exists (select 1 from public.stripe_prices where price_code = k and stripe_price_id = v) then raise exception 'Not run: % is still the old (test) price id.', k; end if;\n", ""),
    ("step 69 part 2 opens buying", S69, "update public.stripe_settings set live_ok = true where id;", "update public.stripe_settings set live_ok = true, buying_open = true where id;"),
    ("step 69 part 4 opens without a live refund", S69, "\n     or (select count(*) from public.stripe_events e where e.livemode and e.outcome = 'applied' and e.type = 'charge.refunded') < 1 then", " then"),
    ("step 69 part 4 opens with no Ohio ZIPs loaded", S69, "(select count(*) from public.ohio_zip_county) = 0 or ", ""),
    ("step 69 part 4 opens with a rate that has no Stripe id", S69, " or exists (select 1 from public.tax_rates r where r.active and r.stripe_tax_rate_id is null)", ""),
    ("step 69 part 4 opens with a test price id left", S69, "  if exists (select 1 from public.stripe_prices p join ryagram_private.stripe_prices_test_ids t using (price_code) where p.stripe_price_id = t.stripe_price_id) then\n    raise exception 'Not run: a price id is still the test one.';\n  end if;\n", ""),
    ("step 70 goes back to test mode after a live payment", S70, "  if exists (select 1 from public.stripe_events where livemode and outcome = 'applied') then raise exception 'Not run: a live Stripe event was applied, so a real payment exists. Do not go back to test mode: ask CC1.'; end if;\n", ""),
    ("step 70 part 2 runs while buying is open", S70, "  if (select s.buying_open from public.stripe_settings s where s.id) then raise exception 'Not run: buying is still open. Run part 1 first.'; end if;\n", ""),
]


def fresh():
    shutil.rmtree(SCRATCH, ignore_errors=True)
    shutil.copytree(ROOT / "supabase", SCRATCH / "supabase", ignore=shutil.ignore_patterns("__pycache__"))
    (SCRATCH / "tests").mkdir()
    shutil.copy(ROOT / "tests" / "stripe.test.mjs", SCRATCH / "tests" / "stripe.test.mjs")
    shutil.copytree(ROOT / "tests" / "fixtures" / "stripe", SCRATCH / "tests" / "fixtures" / "stripe")


def run(group):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    cmd = ["node", "--test", "tests/stripe.test.mjs"] if group == "js" else [sys.executable, "-B", "-m", "unittest", "supabase/tests/test_checkout_tax.py"]
    r = subprocess.run(cmd, cwd=SCRATCH, capture_output=True, text=True, env=env, timeout=900)
    return r.returncode, (r.stdout + r.stderr)[-500:]


missed = 0
ONLY = os.environ.get("MUT_GROUPS", "js,sql").split(",")             # MUT_GROUPS=js runs only the node group (light); the sql group starts a Postgres per mutant
for group, mutants in (("js", JS), ("sql", SQL)):
    if group not in ONLY:
        continue
    fresh()
    rc, tail = run(group)
    if rc:
        print(f"BASELINE FAILS for {group} (nothing proved)\n" + tail)
        shutil.rmtree(SCRATCH, ignore_errors=True)
        sys.exit(2)
    print(f"baseline passes ({group})", flush=True)
    for name, rel, old, new in mutants:
        fresh()
        p = SCRATCH / rel
        t = p.read_text(encoding="utf-8").replace("\r\n", "\n")
        n = t.count(old)
        if n != 1:
            print(f"BROKEN MUTANT (text found {n} times, need 1): {name}", flush=True)
            missed += 1
            continue
        p.write_text(t.replace(old, new), encoding="utf-8")
        rc, _ = run(group)
        print(("caught  " if rc else "MISSED  ") + name, flush=True)
        missed += 0 if rc else 1
shutil.rmtree(SCRATCH, ignore_errors=True)
total = sum(len(g) for n, g in (("js", JS), ("sql", SQL)) if n in ONLY)
print(f"{missed} mutant(s) not caught" if missed else f"all {total} mutants caught")
sys.exit(1 if missed else 0)
