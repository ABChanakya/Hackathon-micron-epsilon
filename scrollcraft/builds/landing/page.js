/* Page logic for the landing page. Runs before ScrollCraft.mount (translations must be in place before the engine
   reads the markup), then start() drives the bespoke parts every frame from the acts' --sc-p. Engine untouched. */
(function () {
  'use strict';
  var D = window.LANDING_DATA, I = window.LANDING_I18N;
  var params = new URLSearchParams(location.search);
  var stored = null;
  try { stored = localStorage.getItem('landing-lang'); } catch (e) {}
  var code = params.get('lang') || stored || (navigator.language || 'de').slice(0, 2).toLowerCase();
  if (!I[code]) code = 'de';
  try { localStorage.setItem('landing-lang', code); } catch (e) {}
  window.addEventListener('storage', function (event) {
    if (event.key !== 'landing-lang' || !I[event.newValue] || event.newValue === code) return;
    var url = new URL(location.href);
    url.searchParams.set('lang', event.newValue);
    location.replace(url.toString());
  });
  var T = I[code];
  // The unified /pitch/ page uses its own origin; standalone previews fall back to the backend on port 8000.
  var HOST = location.hostname || 'localhost';
  var UNIFIED = /^\/pitch(?:\/|$)/.test(location.pathname) || location.port === '8000';
  var BACKEND_ORIGIN = UNIFIED ? location.origin : (location.protocol === 'https:' ? 'https://' : 'http://') + HOST + ':8000';
  var WS_URL = params.get('ws') || BACKEND_ORIGIN.replace(/^http/, 'ws') + '/ws/bridge';
  var MONITOR_URL = params.get('monitor') || (UNIFIED ? '/' : BACKEND_ORIGIN + '/');

  var fmt = function (v, d) {
    return new Intl.NumberFormat(T._locale, { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }).format(v);
  };
  var tot = D.totals;
  var vars = {
    rate: fmt(4000), pdfs: fmt(tot.pdfs), pages: fmt(tot.medaqlib_pages), samples: fmt(tot.samples),
    pct: fmt(100 * (1 - tot.dropped / (tot.samples + tot.dropped)), 2), model: D.sensor.model,
  };
  var fill = function (s, extra) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return (extra && extra[k] != null) ? extra[k] : (vars[k] != null ? vars[k] : m); });
  };
  var t = function (k, extra) { return fill(T[k] != null ? T[k] : I.en[k] != null ? I.en[k] : k, extra); };
  var $ = function (s) { return document.querySelector(s); };

  /* ---------------------------------------------------------------- translate (before the engine mounts) */
  document.documentElement.lang = T._html;
  document.title = t('title');
  var meta = $('meta[name="description"]'); if (meta) meta.setAttribute('content', t('desc'));
  Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-alt]'), function (el) { el.alt = t(el.getAttribute('data-i18n-alt')); });
  Array.prototype.forEach.call(document.querySelectorAll('.side--raw'), function (el) { el.setAttribute('data-side', t('side_raw')); });
  Array.prototype.forEach.call(document.querySelectorAll('.side--hum'), function (el) { el.setAttribute('data-side', t('side_human')); });
  $('.empty').setAttribute('aria-label', t('t_empty'));
  $('#trace').setAttribute('aria-label', t('peak_raw_cap'));
  $('#cta').href = MONITOR_URL;

  var sel = $('#lang');
  sel.setAttribute('aria-label', t('lang'));
  Object.keys(I).forEach(function (k) {
    var o = document.createElement('option'); o.value = k; o.textContent = I[k]._name; if (k === code) o.selected = true; sel.appendChild(o);
  });
  sel.addEventListener('change', function () {
    try { localStorage.setItem('landing-lang', sel.value); } catch (e) {}
    var u = new URL(location.href); u.searchParams.set('lang', sel.value); location.href = u.toString();
  });

  /* ---------------------------------------------------------------- the wire format (ILD1900 manual p.79) */
  // A reading is an 18-bit word x with d [mm from range start] = (x - 98232) / 65536 * 10, sent as three bytes whose top
  // two bits mark L (00), M (01) and H (10). These are the bytes the sensor sends for exactly these readings.
  var RANGE = D.sensor.range_mm, START = D.sensor.range_start_mm;
  var encode = function (face) {
    var x = Math.round((face - START) / RANGE * 65536 + 98232);
    return [x & 63, 64 | ((x >> 6) & 63), 128 | ((x >> 12) & 63)];
  };
  var decode = function (b) { var x = (b[0] & 63) | ((b[1] & 63) << 6) | ((b[2] & 63) << 12); return (x - 98232) / 65536 * RANGE + START; };
  var hex = function (b) { return b.map(function (v) { return v.toString(16).toUpperCase().padStart(2, '0'); }).join(' '); };

  var mats = {}; D.materials.forEach(function (m) { mats[m.key] = m; });
  var metal = mats.metal_stairs, HI = metal.trace_hi;

  // 2: the wall of bytes behind the argument
  var wall = $('#wall');
  if (wall) wall.textContent = HI.slice(0, 900).map(function (v) { return hex(encode(v)); }).join('  ');

  // 3: three real bytes become the first readable number
  var oneVal = mats.white_plastic.mean_face_mm, oneBytes = encode(oneVal);
  $('#one-bytes').innerHTML = oneBytes.map(function (v) { return '<b>' + hex([v]) + '</b>'; }).join('') +
    '<span class="to">→</span><span>' + fmt(decode(oneBytes), 3) + ' mm</span>';
  $('#one-number').innerHTML = fmt(decode(oneBytes), 3) + '<small>mm</small>';

  // 5: the materials table, built from the real recordings
  var order = ['white_plastic', 'black_metal', 'paper', 'white_stairs', 'grey_stairs', 'metal_stairs'];
  var tbody = $('#mats tbody');
  order.forEach(function (k) {
    var m = mats[k]; if (!m) return;
    var steps = /stairs/.test(k);
    var measured = m.std_um < 50 ? t('var_noise', { v: fmt(m.std_um, 1) })
      : t(steps ? 'var_profile' : 'var_span', { v: fmt(m.p2p_um / 1000, 1) });
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + t('mat_' + k) + '</td><td class="n">' + fmt(m.mean_face_mm, 2) + ' mm</td><td class="n">' + measured +
      '</td><td><canvas width="220" height="60" aria-hidden="true"></canvas></td>';
    tbody.appendChild(tr);
    spark(tr.querySelector('canvas'), m.trace);
  });
  function spark(cv, arr) {
    var c = cv.getContext('2d'), w = cv.width, h = cv.height, lo = Math.min.apply(null, arr), hi = Math.max.apply(null, arr);
    var span = Math.max(hi - lo, 0.002);
    c.strokeStyle = '#c4141f'; c.lineWidth = 3; c.lineJoin = 'round'; c.beginPath();
    arr.forEach(function (v, i) { var x = i / (arr.length - 1) * (w - 4) + 2, y = h - 4 - (v - lo) / span * (h - 8); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.stroke();
  }

  /* ---------------------------------------------------------------- counters, formatted per locale */
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var counters = document.querySelectorAll('.js-count');
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return; io.unobserve(e.target);
      var el = e.target, to = parseFloat(el.dataset.to), d = parseInt(el.dataset.dec || '0', 10);
      if (reduce) { el.textContent = fmt(to, d); return; }
      var t0 = null;
      (function step(now) {
        if (t0 === null) t0 = now;
        var k = Math.min((now - t0) / 1100, 1), ease = 1 - Math.pow(1 - k, 3);
        el.textContent = fmt(to * ease, d);
        if (k < 1) requestAnimationFrame(step);
      })(performance.now());
    });
  }, { threshold: 0.6 });
  Array.prototype.forEach.call(counters, function (el) { el.textContent = fmt(0, parseInt(el.dataset.dec || '0', 10)); io.observe(el); });

  /* ---------------------------------------------------------------- the signature move: scroll plays the recording, one button goes live */
  var peak = $('#peak'), closeAct = $('#close'), cv = $('#trace'), readout = $('#readout'), badge = $('#badge');
  var stream = $('#stream'), status = $('#status'), liveBtn = $('#live');
  var live = { on: false, ws: null, buf: [], got: false, info: null, timer: null };
  var actP = function (el) { return el ? (parseFloat(el.style.getPropertyValue('--sc-p')) || 0) : 0; };
  var lastKey = '';

  function setBadge() {
    if (live.on && live.got) {
      var model = (live.info && live.info.model) || D.sensor.model;
      var notLive = !!(live.info && (live.info.source === 'replay' || live.info.source === 'sim'));   // never call a replay or the simulator live
      badge.textContent = t(notLive ? 'badge_replay' : 'badge_live', { model: model });
      badge.classList.toggle('is-live', !notLive);
    } else {
      badge.textContent = t('badge_rec', { name: t('mat_metal_stairs') });
      badge.classList.remove('is-live');
    }
    liveBtn.textContent = t(live.on ? 'live_off' : 'live_on');
  }

  function stopLive(msg) {
    live.on = false; live.got = false; live.buf = []; clearTimeout(live.timer);
    if (live.ws) { live.ws.onclose = live.ws.onerror = live.ws.onmessage = null; try { live.ws.close(); } catch (e) {} live.ws = null; }
    status.textContent = msg || ''; setBadge(); lastKey = '';
  }

  function startLive() {
    live.on = true; live.got = false; live.buf = []; status.textContent = t('live_wait'); setBadge();
    try { live.ws = new WebSocket(WS_URL); } catch (e) { stopLive(t('live_fail')); return; }
    live.timer = setTimeout(function () { if (!live.got) stopLive(t('live_fail')); }, 3000);
    live.ws.onmessage = function (ev) {
      var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.unit && m.unit !== 'mm') { stopLive(t('live_other', { unit: m.unit })); return; }
      if (m.unit !== 'mm') return;
      if (!live.got) { live.got = true; clearTimeout(live.timer); status.textContent = ''; }
      live.info = { model: m.sensor, source: m.source };
      live.buf.push({ t: performance.now(), v: (typeof m.value === 'number' && isFinite(m.value)) ? m.value : null, err: m.error });
      var cut = performance.now() - 10000; while (live.buf.length && live.buf[0].t < cut) live.buf.shift();
      setBadge();
    };
    live.ws.onerror = live.ws.onclose = function () { stopLive(live.got ? '' : t('live_fail')); };
  }
  liveBtn.addEventListener('click', function () { live.on ? stopLive('') : startLive(); });

  function draw(points, lo, hi, playhead) {
    var r = cv.getBoundingClientRect(); if (r.width < 2) return;
    var dpr = Math.min(devicePixelRatio || 1, 2), w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    var W = r.width, H = r.height, left = 0, right = 62, top = 8, bottom = 8, pw = W - left - right, ph = H - top - bottom;
    c.clearRect(0, 0, W, H);
    var y = function (v) { return top + ph - (v - lo) / (hi - lo) * ph; };
    c.font = '500 11px "JetBrains Mono", ui-monospace, monospace'; c.textBaseline = 'middle'; c.textAlign = 'left';
    for (var g = 0; g <= 4; g++) {                         // recessive grid with labelled values the scale really reaches
      var v = lo + (hi - lo) * g / 4, yy = y(v);
      c.strokeStyle = 'rgba(17,21,26,0.08)'; c.lineWidth = 1; c.beginPath(); c.moveTo(left, yy); c.lineTo(left + pw, yy); c.stroke();
      c.fillStyle = '#4f5a66'; c.fillText(fmt(v, 2), left + pw + 8, yy);
    }
    var n = points.length; if (n < 2) return;
    var x = function (i) { return left + i / (n - 1) * pw; };
    if (playhead != null) {                                // the whole recording as a ghost, the played part in the accent
      c.strokeStyle = 'rgba(17,21,26,0.13)'; c.lineWidth = 2; c.beginPath(); var on = false;
      for (var i = 0; i < n; i++) { if (points[i] == null) { on = false; continue; } on ? c.lineTo(x(i), y(points[i])) : c.moveTo(x(i), y(points[i])); on = true; }
      c.stroke();
    }
    var end = playhead != null ? playhead : n - 1;
    c.strokeStyle = '#c4141f'; c.lineWidth = 2; c.lineJoin = 'round'; c.beginPath(); var drawing = false, lastI = -1;
    for (var j = 0; j <= end; j++) {
      if (points[j] == null) { drawing = false; continue; }         // invalid readings are gaps, never zeros
      drawing ? c.lineTo(x(j), y(points[j])) : c.moveTo(x(j), y(points[j])); drawing = true; lastI = j;
    }
    c.stroke();
    if (lastI >= 0) { c.fillStyle = '#c4141f'; c.beginPath(); c.arc(x(lastI), y(points[lastI]), 4.5, 0, Math.PI * 2); c.fill(); }
  }

  var HLO = Math.min.apply(null, HI), HHI = Math.max.apply(null, HI), HPAD = (HHI - HLO) * 0.12;

  function frame() {
    var wide = matchMedia('(min-width: 761px)').matches, root = document.documentElement;
    // divider: page progress dot, and the collapse in the close act
    var max = document.documentElement.scrollHeight - innerHeight;
    root.style.setProperty('--page-p', max > 0 ? Math.min(scrollY / max, 1).toFixed(4) : '0');
    var pc = actP(closeAct), ease = pc * pc * (3 - 2 * pc);
    root.style.setProperty('--divx', wide ? (50 * (1 - ease)).toFixed(3) + '%' : '50%');

    var values, playhead = null, lo, hi, current = null;
    if (live.on && live.got) {
      values = live.buf.map(function (p) { return p.v; });
      var ok = values.filter(function (v) { return v != null; });
      if (ok.length) { lo = Math.min.apply(null, ok); hi = Math.max.apply(null, ok); var pad = Math.max((hi - lo) * 0.2, 0.02); lo -= pad; hi += pad; }
      else { lo = START; hi = START + RANGE; }
      current = values.length ? values[values.length - 1] : null;
      if (current == null && live.buf.length) status.textContent = t('live_none') + (live.buf[live.buf.length - 1].err ? ' (' + live.buf[live.buf.length - 1].err + ')' : '');
      else if (status.textContent === t('live_none') || /^\S.*\(/.test(status.textContent)) status.textContent = '';
    } else {
      var p = Math.min(Math.max((actP(peak) - 0.04) / 0.78, 0), 1);    // finish the curve before the last cue
      playhead = Math.round(p * (HI.length - 1));
      values = HI; lo = HLO - HPAD; hi = HHI + HPAD; current = HI[playhead];
    }
    var key = (live.on ? 'L' + live.buf.length + ':' + current : 'R' + playhead) + ':' + innerWidth;
    if (key !== lastKey) {
      lastKey = key;
      draw(values, lo, hi, playhead);
      readout.textContent = current == null ? '–' : fmt(current, 3);
      // the cable side: the same readings as raw bytes, newest at the bottom
      var recent = [];
      if (playhead != null) { for (var i = Math.max(0, playhead - 8); i <= playhead; i++) recent.push(HI[i]); }
      else { recent = values.filter(function (v) { return v != null; }).slice(-9); }
      stream.innerHTML = recent.map(function (v) {
        return '<li><span>' + hex(encode(v)) + '</span><span class="stream__mm">' + fmt(decode(encode(v)), 3) + ' mm</span></li>';
      }).join('');
    }
    requestAnimationFrame(frame);
  }

  window.LandingPage = { start: function () { setBadge(); requestAnimationFrame(frame); } };
})();
