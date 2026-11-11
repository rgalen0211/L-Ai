// Per-account switches (WEB 11-10, Ryan's Q576 yes). A switch in assets/ryagram-config.js is ONE file every visitor downloads, so `true` means on for EVERYONE.
// A switch may now hold the string 'account' instead: it is on only for a person whose own list (the server's my_switches(), set only by an admin) names it.
//   featureOn(name) is true when the switch is exactly true (everyone), or is exactly 'account' AND the list names it. Everything else is OFF: 'true', 1, 'yes', 'ACCOUNT', a missing switch, a list that failed to load,
//   a list that is not an array of plain switch names. The list is read ONLY when some switch is exactly 'account' (so nothing is asked of the server today). It fails closed: an error means an empty list.
// The existing strict `=== true` reads elsewhere stay as they are: a switch that holds 'account' is not `true`, so a feature not yet moved to featureOn() stays OFF for everyone.
(function () {
  const NAME = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
  let listed = new Set(), loaded = null;

  // Only an array of plain switch-name strings counts; anything else is an empty list.
  function parse(raw) {
    if (!Array.isArray(raw)) return new Set();
    const out = new Set();
    for (const n of raw) if (typeof n === 'string' && NAME.test(n)) out.add(n);
    return out;
  }
  const cfgOf = cfg => cfg || (typeof window !== 'undefined' ? window.ryagramConfig : undefined);
  const hasAccountSwitch = cfg => !!cfg && Object.keys(cfg).some(k => cfg[k] === 'account');

  function featureOn(name, cfg) {
    const c = cfgOf(cfg);
    if (!c || typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(c, name)) return false;
    const v = c[name];
    if (v === true) return true;
    return v === 'account' && listed.has(name);
  }

  // Reads the person's list once per page load when it is needed. `data.mySwitches()` returns the server's list; any failure leaves the list empty (fail closed) and is tried again on the next call.
  async function load(data, cfg) {
    if (!hasAccountSwitch(cfgOf(cfg))) return false;
    if (loaded) return loaded;
    loaded = (async () => {
      try { listed = parse(await data.mySwitches()); return true; }
      catch { listed = new Set(); loaded = null; return false; }
    })();
    return loaded;
  }
  function reset() { listed = new Set(); loaded = null; }
  function forget() { reset(); }                       // on sign-out: the next person starts with an empty list

  const api = { featureOn, load, forget, parse, _reset: reset };
  if (typeof window !== 'undefined') window.ryagramSwitches = Object.freeze(api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
