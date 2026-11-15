// ==UserScript==
// @name         Touch Gamepad (PS3 / PS4 / PS5 style)
// @namespace    https://github.com/YOUR-USERNAME/touch-gamepad
// @version      0.1.0
// @description  On-screen PlayStation-style controller that sends keyboard and mouse input to a browser game.
// @match        *://CHANGE-ME.example/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
  SETUP
  1. Change the @match line above to the address of the page where your game runs,
     for example:  // @match        https://yourgamesite.com/*
  2. If no controller appears, the game may sit in an iframe on another domain.
     Add a second @match line for that domain.
  3. Tap "Edit" on the toolbar to drag the controller groups around and resize them.
*/

(() => {
  'use strict';

  /* ---------- 1. Settings you can edit ---------- */

  // What each controller button sends. Keyboard names must exist in KEYDEF below.
  // Mouse: 0 = left click, 2 = right click.
  // Defaults follow GTA V's PC keys as best I know them. Change anything that is off.
  const ACTIONS = {
    cross:    { key: 'Space' },     // jump / handbrake
    circle:   { key: 'KeyE' },
    square:   { key: 'KeyR' },      // reload
    triangle: { key: 'KeyF' },      // enter / exit vehicle
    l1:       { key: 'Tab' },       // weapon wheel
    r1:       { key: 'KeyQ' },      // cover
    l2:       { mouse: 2 },         // aim
    r2:       { mouse: 0 },         // shoot
    up:       { key: 'ArrowUp' },   // phone
    down:     { key: 'ArrowDown' },
    left:     { key: 'ArrowLeft' },
    right:    { key: 'ArrowRight' },
    sel:      { key: 'KeyV' },      // change camera view
    start:    { key: 'Escape' },    // pause
    ok:       { key: 'Enter' },     // confirm in menus
  };
  const SPRINT_KEY = 'ShiftLeft';
  const SPRINT_ON_FULL_PUSH = true; // push the left stick all the way out to sprint
  const CAMERA_SPEED = 14;          // pixels per frame at full push (also a slider in Edit mode)
  const INVERT_Y = false;
  const TRY_POINTER_LOCK = true;    // many games only read mouse movement while pointer-locked

  const KEYDEF = {
    KeyW: ['w', 87], KeyA: ['a', 65], KeyS: ['s', 83], KeyD: ['d', 68],
    KeyQ: ['q', 81], KeyE: ['e', 69], KeyR: ['r', 82], KeyF: ['f', 70],
    KeyV: ['v', 86], KeyC: ['c', 67], KeyM: ['m', 77],
    Space: [' ', 32], Tab: ['Tab', 9], Enter: ['Enter', 13], Escape: ['Escape', 27],
    ShiftLeft: ['Shift', 16], ControlLeft: ['Control', 17],
    ArrowLeft: ['ArrowLeft', 37], ArrowUp: ['ArrowUp', 38],
    ArrowRight: ['ArrowRight', 39], ArrowDown: ['ArrowDown', 40],
  };

  const SKINS = {
    ps3: { name: 'PS3', sel: 'Select', start: 'Start' },
    ps4: { name: 'PS4', sel: 'Share', start: 'Options' },
    ps5: { name: 'PS5', sel: 'Create', start: 'Options' },
  };

  // Group centres as fractions of the screen (x, y). Edit mode saves your own.
  const DEFAULT_POS = {
    shoulderL: [0.09, 0.13], shoulderR: [0.91, 0.13],
    dpad: [0.10, 0.42], face: [0.90, 0.42],
    stickL: [0.22, 0.76], stickR: [0.78, 0.76],
    center: [0.50, 0.90],
  };

  /* ---------- 2. Saved layout ---------- */

  const STORE = 'tgp:v1';
  const autoScale = Math.max(0.6, Math.min(1.1, innerHeight / 430));
  const cfg = { skin: 'ps4', scale: autoScale, cam: 1, hidden: false, pos: {} };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) {}
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(cfg)); } catch (e) {} };

  /* ---------- 3. Input: turns taps into keyboard and mouse events ---------- */

  let canvas = null;
  const getCanvas = () => {
    if (canvas && canvas.isConnected) return canvas;
    canvas = [...document.querySelectorAll('canvas')]
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
    return canvas;
  };

  const down = new Set();
  function hold(code, on) {
    const def = KEYDEF[code];
    if (!def || on === down.has(code)) return;
    if (on) down.add(code); else down.delete(code);
    const kc = def[1];
    const e = new KeyboardEvent(on ? 'keydown' : 'keyup', {
      key: def[0], code, keyCode: kc, which: kc, bubbles: true, cancelable: true, composed: true,
    });
    for (const p of ['keyCode', 'which']) {
      try { Object.defineProperty(e, p, { get: () => kc }); } catch (err) {}
    }
    (getCanvas() || document).dispatchEvent(e);
  }

  let vx = null, vy = null, mask = 0; // virtual cursor inside the canvas, held mouse buttons
  function cursor() {
    const c = getCanvas();
    if (!c) return null;
    const r = c.getBoundingClientRect();
    if (vx === null) { vx = r.width / 2; vy = r.height / 2; }
    return { c, r };
  }
  function fireMouse(type, extra) {
    const p = cursor();
    if (!p) return;
    const x = p.r.left + vx, y = p.r.top + vy;
    p.c.dispatchEvent(new MouseEvent(type, Object.assign({
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y, screenX: x, screenY: y, buttons: mask,
    }, extra)));
  }
  function mouseButton(button, on) {
    const bit = button === 2 ? 2 : 1;
    if (on) mask |= bit; else mask &= ~bit;
    fireMouse(on ? 'mousedown' : 'mouseup', { button });
  }
  function look(dx, dy) {
    const p = cursor();
    if (!p) return;
    vx += dx; vy += dy;
    if (vx < 30 || vx > p.r.width - 30 || vy < 30 || vy > p.r.height - 30) {
      vx = p.r.width / 2; vy = p.r.height / 2;
    }
    fireMouse('mousemove', { movementX: dx, movementY: dy });
  }

  function press(name, on) {
    const a = ACTIONS[name];
    if (!a) return;
    if (a.key) hold(a.key, on); else mouseButton(a.mouse, on);
  }

  const cam = { x: 0, y: 0 };
  function releaseAll() {
    [...down].forEach(k => hold(k, false));
    if (mask & 1) mouseButton(0, false);
    if (mask & 2) mouseButton(2, false);
    cam.x = cam.y = 0;
  }

  const curve = v => Math.sign(v) * Math.pow(Math.abs(v), 1.6);
  setInterval(() => {
    if (!cam.x && !cam.y) return;
    const k = CAMERA_SPEED * cfg.cam;
    look(curve(cam.x) * k, curve(cam.y) * k * (INVERT_Y ? -1 : 1));
  }, 16);

  let lockTries = 0, wake = false;
  function prime() { // needs a finished tap, so it runs on pointerup
    if (!wake) {
      wake = true;
      try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
    }
    const c = getCanvas();
    if (TRY_POINTER_LOCK && c && c.requestPointerLock && !document.pointerLockElement && lockTries < 3) {
      lockTries++;
      try { const r = c.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) {}
    }
  }

  window.addEventListener('blur', releaseAll);
  window.addEventListener('resize', () => { vx = vy = null; });
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAll(); });

  /* ---------- 4. Controller UI ---------- */

  const CSS = `
#tgp{position:fixed;inset:0;z-index:2147483647;pointer-events:none;
 font:600 13px/1 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
 --face:rgba(16,18,24,.5);--edge:rgba(255,255,255,.4);--ink:#fff;--press:rgba(255,255,255,.5);
 --tri:#41d6a0;--cir:#ff5a6a;--cro:#5aa0ff;--sqr:#ff8ad8}
#tgp[data-skin=ps5]{--face:rgba(240,243,252,.42);--edge:rgba(255,255,255,.9);--ink:#0f1320;
 --tri:var(--ink);--cir:var(--ink);--cro:var(--ink);--sqr:var(--ink)}
#tgp *{box-sizing:border-box}
#tgp .grp{position:fixed;transform:translate(-50%,-50%) scale(var(--s,1));pointer-events:none}
#tgp .ctl{pointer-events:auto;touch-action:none;user-select:none;-webkit-user-select:none;
 -webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
#tgp.edit .ctl{pointer-events:none}
#tgp.edit .grp{pointer-events:auto;outline:2px dashed #ffd54a;outline-offset:8px;cursor:move;touch-action:none}
#tgp .btn{display:flex;align-items:center;justify-content:center;color:var(--ink);
 background:var(--face);border:2px solid var(--edge);
 -webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);transition:transform .06s,background .06s}
#tgp .btn.on{background:var(--press);transform:scale(.93)}
#tgp .clu{position:relative;width:132px;height:132px}
#tgp .round{position:absolute;width:46px;height:46px;border-radius:50%;font-size:24px;font-weight:700}
#tgp .dp{position:absolute;width:44px;height:44px;border-radius:10px;font-size:16px}
#tgp .pill{width:64px;height:38px;border-radius:13px}
#tgp .small{width:70px;height:28px;border-radius:14px;font-size:11px}
#tgp .row{display:flex;gap:8px}
#tgp .tri{color:var(--tri)}#tgp .cir{color:var(--cir)}#tgp .cro{color:var(--cro)}#tgp .sqr{color:var(--sqr)}
#tgp .stick{position:relative;width:130px;height:130px;border-radius:50%;background:var(--face);
 border:2px solid var(--edge);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
#tgp .knob{position:absolute;left:35px;top:35px;width:56px;height:56px;border-radius:50%;
 background:var(--edge);pointer-events:none}
#tgp .bar{position:fixed;top:max(6px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);
 display:flex;gap:6px;pointer-events:auto}
#tgp .bar button,#tgp .panel button{font:inherit;color:#fff;background:rgba(14,16,22,.7);
 border:1px solid rgba(255,255,255,.3);border-radius:14px;padding:7px 11px;touch-action:manipulation}
#tgp .panel{position:fixed;top:48px;left:50%;transform:translateX(-50%);display:none;gap:14px;
 align-items:center;padding:8px 12px;border-radius:14px;background:rgba(14,16,22,.85);
 color:#fff;pointer-events:auto}
#tgp.edit .panel{display:flex}
#tgp .panel label{display:flex;gap:6px;align-items:center}
#tgp .panel input{width:90px}
#tgp.hid .grp,#tgp.hid .panel,#tgp.hid .bar button:not(.keep){display:none}
`;

  const $ = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };

  const root = $('div');
  root.id = 'tgp';
  root.addEventListener('contextmenu', e => e.preventDefault());
  const groups = {};

  function btn(name, label, cls) {
    const b = $('div', 'ctl btn ' + cls, label);
    const off = () => {
      if (!b._on) return;
      b._on = false;
      b.classList.remove('on');
      press(name, false);
    };
    b.addEventListener('pointerdown', e => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b._on = true;
      b.classList.add('on');
      press(name, true);
      if (navigator.vibrate) navigator.vibrate(8);
    });
    b.addEventListener('pointerup', prime);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => b.addEventListener(t, off));
    return b;
  }

  function stick(onMove) {
    const base = $('div', 'ctl stick'), knob = $('div', 'knob');
    base.append(knob);
    let id = null;
    const set = (nx, ny) => {
      knob.style.transform = `translate(${nx * 40}px,${ny * 40}px)`;
      onMove(nx, ny);
    };
    const track = e => {
      const r = base.getBoundingClientRect();
      let nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(nx, ny);
      if (m > 1) { nx /= m; ny /= m; }
      set(nx, ny);
    };
    base.addEventListener('pointerdown', e => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      base.setPointerCapture(id);
      track(e);
    });
    base.addEventListener('pointermove', e => { if (e.pointerId === id) track(e); });
    base.addEventListener('pointerup', prime);
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t =>
      base.addEventListener(t, e => { if (e.pointerId === id) { id = null; set(0, 0); } }));
    return base;
  }

  function place(name) {
    const g = groups[name], p = cfg.pos[name] || DEFAULT_POS[name];
    g.style.left = p[0] * 100 + 'vw';
    g.style.top = p[1] * 100 + 'vh';
    g.style.setProperty('--s', cfg.scale);
  }
  const placeAll = () => Object.keys(groups).forEach(place);

  function group(name, ...kids) {
    const g = $('div', 'grp');
    g.append(...kids);
    groups[name] = g;
    place(name);
    g.addEventListener('pointerdown', e => { // dragging, Edit mode only
      if (!root.classList.contains('edit')) return;
      e.preventDefault();
      g.setPointerCapture(e.pointerId);
      const mv = ev => { cfg.pos[name] = [ev.clientX / innerWidth, ev.clientY / innerHeight]; place(name); };
      const end = () => { g.removeEventListener('pointermove', mv); save(); };
      g.addEventListener('pointermove', mv);
      g.addEventListener('pointerup', end, { once: true });
      g.addEventListener('pointercancel', end, { once: true });
    });
    root.append(g);
  }

  const row = (...kids) => { const r = $('div', 'row'); r.append(...kids); return r; };

  async function fullscreen() {
    try {
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
      await document.documentElement.requestFullscreen();
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (e) {}
  }

  function build() {
    const style = $('style');
    style.textContent = CSS;
    document.head.append(style);

    // D-pad and face buttons
    const dpad = $('div', 'clu');
    [['up', '▲', 44, 0], ['left', '◀', 0, 44], ['right', '▶', 88, 44], ['down', '▼', 44, 88]]
      .forEach(([n, glyph, x, y]) => {
        const b = btn(n, glyph + '\uFE0E', 'dp');
        b.style.left = x + 'px'; b.style.top = y + 'px';
        dpad.append(b);
      });
    const face = $('div', 'clu');
    [['triangle', '△', 'tri', 43, 0], ['square', '□', 'sqr', 0, 43],
     ['circle', '○', 'cir', 86, 43], ['cross', '✕', 'cro', 43, 86]]
      .forEach(([n, glyph, c, x, y]) => {
        const b = btn(n, glyph, 'round ' + c);
        b.style.left = x + 'px'; b.style.top = y + 'px';
        face.append(b);
      });

    const selB = btn('sel', '', 'small'), startB = btn('start', '', 'small');

    group('shoulderL', row(btn('l2', 'L2', 'pill'), btn('l1', 'L1', 'pill')));
    group('shoulderR', row(btn('r1', 'R1', 'pill'), btn('r2', 'R2', 'pill')));
    group('dpad', dpad);
    group('face', face);
    group('center', row(selB, btn('ok', 'OK', 'small'), startB));
    group('stickL', stick((x, y) => {
      const T = 0.35;
      hold('KeyA', x < -T); hold('KeyD', x > T);
      hold('KeyW', y < -T); hold('KeyS', y > T);
      hold(SPRINT_KEY, SPRINT_ON_FULL_PUSH && Math.hypot(x, y) > 0.95);
    }));
    group('stickR', stick((x, y) => {
      cam.x = Math.abs(x) < 0.12 ? 0 : x;
      cam.y = Math.abs(y) < 0.12 ? 0 : y;
    }));

    // Toolbar
    const bar = $('div', 'bar');
    const mk = (txt, fn, cls) => {
      const b = $('button', cls, txt);
      b.addEventListener('click', fn);
      bar.append(b);
      return b;
    };
    const skinB = mk('', () => {
      const keys = Object.keys(SKINS);
      cfg.skin = keys[(keys.indexOf(cfg.skin) + 1) % keys.length];
      applySkin(); save();
    });
    const editB = mk('Edit', () => {
      releaseAll();
      root.classList.toggle('edit');
      editB.textContent = root.classList.contains('edit') ? 'Done' : 'Edit';
    });
    mk('Full screen', fullscreen);
    const hideB = mk('', () => { cfg.hidden = !cfg.hidden; applyHidden(); save(); }, 'keep');

    // Edit panel
    const panel = $('div', 'panel');
    panel.innerHTML = '<label>Size <input type="range" min="0.5" max="1.6" step="0.05"></label>' +
      '<label>Camera speed <input type="range" min="0.3" max="3" step="0.1"></label>';
    const [sizeIn, camIn] = panel.querySelectorAll('input');
    sizeIn.value = cfg.scale;
    camIn.value = cfg.cam;
    sizeIn.oninput = () => { cfg.scale = +sizeIn.value; placeAll(); save(); };
    camIn.oninput = () => { cfg.cam = +camIn.value; save(); };
    const reset = $('button', '', 'Reset layout');
    reset.onclick = () => {
      cfg.pos = {}; cfg.scale = autoScale; cfg.cam = 1;
      sizeIn.value = cfg.scale; camIn.value = cfg.cam;
      placeAll(); save();
    };
    panel.append(reset);

    function applySkin() {
      const s = SKINS[cfg.skin] || SKINS.ps4;
      root.dataset.skin = SKINS[cfg.skin] ? cfg.skin : 'ps4';
      selB.textContent = s.sel;
      startB.textContent = s.start;
      skinB.textContent = 'Skin: ' + s.name;
    }
    function applyHidden() {
      releaseAll();
      root.classList.toggle('hid', cfg.hidden);
      if (cfg.hidden) { root.classList.remove('edit'); editB.textContent = 'Edit'; }
      hideB.textContent = cfg.hidden ? 'Show controller' : 'Hide';
    }

    root.append(bar, panel);
    document.body.append(root);
    applySkin();
    applyHidden();

    // If the page makes a container fullscreen, move the controller inside it so it stays visible.
    document.addEventListener('fullscreenchange', () => {
      const f = document.fullscreenElement;
      const ok = f && f !== document.documentElement && !['CANVAS', 'VIDEO', 'IFRAME'].includes(f.tagName);
      const host = ok ? f : document.body;
      if (root.parentNode !== host) host.append(root);
    });
  }

  /* ---------- 5. Start once the game's canvas shows up ---------- */

  const wait = setInterval(() => {
    const c = getCanvas();
    if (c && c.clientWidth > 300 && c.clientHeight > 200) {
      clearInterval(wait);
      build();
    }
  }, 700);
})();
  
