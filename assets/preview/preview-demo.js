// The live preview demo page (/preview-demo/): fetches ONE static scene bundle (a zip), reads it with the same reader the app uses, mounts
// the same viewer, and offers the same colour edits. Nothing is sent anywhere. `?perf` shows the measured frame times on this device.
(() => {
  const $ = id => document.getElementById(id);
  const status = $('demo-status');
  const errorEl = $('demo-error');
  const fail = msg => { status.textContent = ''; errorEl.textContent = msg; errorEl.hidden = false; };

  async function main() {
    if (typeof DecompressionStream !== 'function') return fail('This browser can’t open the preview. Use a recent Chrome, Edge, Safari or Firefox.');
    if (!window.RyagramScene) return fail('The preview drawing code didn’t load. Reload the page.');
    const res = await fetch('interstate.bundle.zip');
    if (!res.ok) return fail('The film file didn’t load. Reload the page.');
    status.textContent = 'Opening the film…';
    const files = await window.ryagramZip.read(new Uint8Array(await res.arrayBuffer()));
    const baseScene = await window.ryagramZip.sceneJson(files['scene.json.gz']);
    const host = $('demo-host');
    const E = window.ryagramPreviewEdit;
    let endCard = null;
    const viewer = await window.ryagramPreview.mount(host, { scene: { ...baseScene }, fonts: files,
      onFrame: (frame, { playing }) => { if (endCard) endCard.hidden = !(frame >= baseScene.frames - 1 && !playing); } });
    status.textContent = 'Drag the slider to see the film at any moment.';

    // the closing card: shown when the film has played to its last frame (or the slider is at the end), with a way to replay and a way in
    endCard = document.createElement('div');
    endCard.className = 'pv-endcard';
    endCard.hidden = true;
    endCard.setAttribute('role', 'region');
    endCard.setAttribute('aria-label', 'End of the film');
    const mark = Object.assign(document.createElement('p'), { className: 'pv-endcard-mark', textContent: 'Made with Ryagram' });
    const line = Object.assign(document.createElement('p'), { className: 'pv-endcard-line', textContent: 'Public data, drawn as a short film, with its sources on every frame.' });
    const again = Object.assign(document.createElement('button'), { type: 'button', className: 'button secondary', textContent: 'Watch again' });
    const more = Object.assign(document.createElement('a'), { className: 'button primary', href: '/ryagram/?utm_source=preview_demo&utm_medium=referral&utm_campaign=interstate', textContent: 'Make your own data film' });
    again.addEventListener('click', () => { viewer.setFrame(0); viewer.play(); });
    const actions = document.createElement('div'); actions.className = 'pv-endcard-actions'; actions.append(again, more);
    endCard.append(mark, line, actions);
    viewer.stage.append(endCard);

    // THEME (dark or light): the engine's own two palettes, applied through the bundle's styles table. Roads belong to the story and keep their colour.
    const themeHost = $('demo-theme');
    let theme = 'dark';
    let themed = baseScene;
    const edits = {};
    const rows = [];                                                              // the colour rows, so a theme change can show the colours now in force
    const now = E.current(baseScene);
    const redraw = () => viewer.setScene(E.recolour(themed, edits));
    if (themeHost && E.themeKeys(baseScene).length) {
      themeHost.hidden = false;
      for (const [value, label] of [['dark', 'Dark (as exported)'], ['light', 'Light']]) {
        const id = `demo-theme-${value}`;
        const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'demo-theme', id, value, checked: value === 'dark' });
        const lab = Object.assign(document.createElement('label'), { htmlFor: id, className: 'choice' });
        lab.append(input, ' ', label);
        input.addEventListener('change', () => {
          if (!input.checked) return;
          theme = value;
          themed = value === 'dark' ? baseScene : E.restyle(baseScene, E.themeEdits(baseScene, 'light'));
          Object.assign(now, E.current(themed));
          for (const r of rows) r.text.value = r.swatch.value = edits[r.layer.id] || now[r.layer.id];
          redraw();
        });
        themeHost.append(lab);
      }
    }

    // colours (the same edits the app's Preview panel makes; here they are not saved anywhere)
    const editHost = $('demo-edit');
    const reset = [];
    for (const layer of E.LAYERS.filter(l => now[l.id])) {
      const id = `demo-c-${layer.id}`;
      const text = Object.assign(document.createElement('input'), { id, type: 'text', className: 'pv-hex', value: now[layer.id], autocomplete: 'off', spellcheck: false, maxLength: 7 });
      const swatch = Object.assign(document.createElement('input'), { type: 'color', className: 'look-swatch', value: now[layer.id] });
      swatch.setAttribute('aria-label', `${layer.label}: choose a colour`);
      const label = Object.assign(document.createElement('label'), { htmlFor: id, textContent: layer.label });
      const back = Object.assign(document.createElement('button'), { type: 'button', className: 'button secondary small', textContent: 'Reset' });
      back.setAttribute('aria-label', `${layer.label}: back to the original`);
      const apply = hex => {
        if (hex === null) delete edits[layer.id];
        else if (E.HEX.test(hex)) edits[layer.id] = hex.toLowerCase();
        else { text.value = edits[layer.id] || now[layer.id]; return; }
        text.value = swatch.value = edits[layer.id] || now[layer.id];
        redraw();
      };
      swatch.addEventListener('input', () => apply(swatch.value));
      text.addEventListener('change', () => apply(text.value.trim()));
      back.addEventListener('click', () => apply(null));
      const field = document.createElement('div'); field.className = 'look-field';
      const row = document.createElement('span'); row.className = 'look-colour'; row.append(text, swatch, back);
      field.append(label, row);
      editHost.append(field);
      reset.push(() => apply(null));
      rows.push({ layer, text, swatch });
    }
    editHost.hidden = !reset.length;

    if (new URLSearchParams(location.search).has('perf')) {
      const out = $('demo-perf');
      out.hidden = false;
      const drawer = window.RyagramScene;
      const times = [];
      for (let f = 0; f < baseScene.frames; f += 47) { const t0 = performance.now(); drawer.draw(baseScene, f, { parts: 'all' }); times.push(performance.now() - t0); }
      times.sort((a, b) => a - b);
      const q = p => times[Math.min(times.length - 1, Math.floor(times.length * p))].toFixed(1);
      out.textContent = `Frame draw (string only, ${times.length} frames): median ${q(0.5)} ms, 95th percentile ${q(0.95)} ms. Mode now: ${viewer.state().mode}, device class: ${viewer.state().device}.`;
    }
    window.ryagramDemo = { viewer, baseScene };      // for the check script
    return null;
  }
  main().catch(err => fail(err && err.message ? err.message : 'The film couldn’t be opened.'));
})();
