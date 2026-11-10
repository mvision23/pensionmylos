/* ============================================================================
   scroll-world — scroll-scrubbed camera-flight engine
   Adapted for Pension Mylos from the scroll-world skill's portable engine
   (references/scrub-engine.js). Changes vs. the reference:
     - styles live in src/styles/scroll-world.css (cascade layer `sw`), not injected
     - per-scene copy is server-rendered by Astro (SEO / no-JS) and adopted here:
       any `.sw-copy` articles already inside the container are reused in order
     - no built-in topbar (the site header is an Astro component)
     - `sw-past` class on the container once the page content has fully covered
       the film, so the fixed layers stop compositing underneath it
     - clips download one at a time, nearest scene first (see "clip loading"),
       with progress shown in a small loading indicator
   Everything else (blob playback, seam crossfade, linger easing,
   seek-coalescing, iOS priming, reduced motion) is the reference behaviour.

   mountScrollWorld(container, {
     diveScroll, crossfade, hint,
     sections: [{ id, label, still, stillMobile, clip, clipMobile, accent,
                  scroll, linger, eyebrow, title, body, tags, cta }],
     connectors: [], connectorsMobile: [],
   })
   ========================================================================== */

export function mountScrollWorld(container, config) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DEBUG = /[?&]debug\b/.test(location.search);   // ?debug → diagnostics panel
  const coarse = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const smallMQ = window.matchMedia('(max-width: 860px)');
  const isMobile = () => coarse || smallMQ.matches;
  const SECTIONS = config.sections || [];
  const CONNECTORS = config.connectors || [];
  const CONNECTORS_M = config.connectorsMobile || [];
  const DIVE_W = config.diveScroll || 1.3;
  const CONN_W = config.connScroll || 0.9;
  const CROSSFADE = config.crossfade != null ? config.crossfade : 0.12;
  const N = SECTIONS.length;
  if (!N) return null;

  container.classList.add('sw-root');

  // ---- segment chain: dive0, conn0, dive1, … (connectors optional) ----
  const SEGMENTS = [];
  SECTIONS.forEach((s, i) => {
    const dive = { kind: 'dive', si: i, clip: s.clip, clipM: s.clipMobile, clipAv1: s.clipAv1, clipMAv1: s.clipMobileAv1,
                   still: s.still, stillM: s.stillMobile,
                   accent: s.accent, w: s.scroll || DIVE_W, linger: s.linger || 0 };
    SEGMENTS.push(dive);
    s._seg = dive;
    if (i < N - 1 && CONNECTORS[i]) {
      SEGMENTS.push({ kind: 'conn', si: i, clip: CONNECTORS[i], clipM: CONNECTORS_M[i],
                      still: SECTIONS[i + 1].still, stillM: SECTIONS[i + 1].stillMobile,
                      accent: SECTIONS[i + 1].accent, w: CONN_W });
    }
  });
  const NSEG = SEGMENTS.length;

  // ---- DOM ----
  const sky = el('div', 'sw-sky');
  const scrollbar = el('div', 'sw-scrollbar');
  const scrollbarFill = el('span'); scrollbar.appendChild(scrollbarFill);
  const stage = el('div', 'sw-stage'); stage.setAttribute('aria-hidden', 'true');
  const copylayer = container.querySelector('.sw-copylayer') || el('div', 'sw-copylayer');
  const route = el('nav', 'sw-route'); route.setAttribute('aria-label', config.routeLabel || 'Scenes');
  const hint = el('div', 'sw-hint'); hint.setAttribute('aria-hidden', 'true');
  const hintText = el('span'); hintText.textContent = config.hint || 'scroll'; hint.appendChild(hintText);
  hint.appendChild(el('i'));
  // Loading indicator for the clip on screen (shown only while it downloads).
  const loader = el('div', 'sw-loader'); loader.setAttribute('aria-hidden', 'true');
  loader.innerHTML = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8"/><circle class="sw-loader__arc" cx="10" cy="10" r="8" pathLength="100"/></svg>' +
    `<span>${esc(config.loadingLabel || 'Loading video')}</span><b></b>`;
  const loaderArc = loader.querySelector('.sw-loader__arc');
  const loaderPct = loader.querySelector('b');
  const track = container.querySelector('.sw-track') || el('div', 'sw-track');   // may be server-rendered

  [sky, scrollbar, stage, copylayer, route, hint, loader, track].forEach(n => container.appendChild(n));

  SEGMENTS.forEach(s => {
    const scene = el('div', 'sw-scene');
    if (s.accent) scene.style.setProperty('--sw-accent', s.accent);
    const img = el('img', 'sw-scene__still'); img.alt = ''; img.decoding = 'async';
    // The first scene is the LCP element — load it eagerly; the rest lazily.
    img.loading = s === SEGMENTS[0] ? 'eager' : 'lazy';
    if (s === SEGMENTS[0]) img.fetchPriority = 'high';
    const poster = (isMobile() && s.stillM) ? s.stillM : s.still;
    if (poster) img.src = poster;
    scene.appendChild(img); stage.appendChild(scene);
    s.el = scene; s.img = img; s.video = null; s.hasClip = false;
    s.loading = false; s.ready = false; s.cur = 0; s.target = 0; s.visible = false;
    s.progress = 0; s.fails = 0; s.ctrl = null;
  });

  // Server-rendered first poster (shown before this script ran): drop it once
  // the engine's own first scene has an image painted, so it never shows
  // through the crossfades further down the film.
  const prestage = container.querySelector('.sw-prestage');
  if (prestage) {
    const first = SEGMENTS[0].img;
    const drop = () => requestAnimationFrame(() => prestage.remove());
    if (first.complete && first.naturalWidth) drop();
    else { first.addEventListener('load', drop, { once: true }); first.addEventListener('error', drop, { once: true }); }
  }

  // ---- per-section copy (adopt server-rendered articles when present) + route ----
  const existing = Array.from(copylayer.querySelectorAll('.sw-copy'));
  const copies = [], dots = [];
  SECTIONS.forEach((s, i) => {
    let c = existing[i];
    if (!c) {
      c = el('article', 'sw-copy');
      c.innerHTML =
        `<span class="sw-copy__num">${pad(i + 1)} / ${pad(N)}</span>` +
        (s.eyebrow ? `<p class="sw-copy__eyebrow">${esc(s.eyebrow)}</p>` : '') +
        (s.title ? `<h2 class="sw-copy__title">${esc(s.title)}</h2>` : '') +
        (s.body ? `<p class="sw-copy__body">${esc(s.body)}</p>` : '') +
        (s.tags && s.tags.length ? `<ul class="sw-copy__tags">${s.tags.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : '');
      copylayer.appendChild(c);
    }
    if (s.accent) c.style.setProperty('--sw-accent', s.accent);
    copies.push(c);

    const dot = el('button', 'sw-route__dot'); dot.type = 'button';
    if (s.accent) dot.style.setProperty('--sw-accent', s.accent);
    dot.innerHTML = `<span class="sw-route__label">${esc(s.label || '')}</span><i></i>`;
    dot.addEventListener('click', () => jumpTo(i)); route.appendChild(dot); dots.push(dot);
  });

  // ---- math ----
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const smooth = x => { x = clamp(x); return x * x * (3 - 2 * x); };
  const lingerEase = (x, L) => { L = clamp(L); const c = x - 0.5; return (1 - L) * x + L * (4 * c * c * c + 0.5); };
  let vh = window.innerHeight, stageX = 0, totalW = 0, activeIndex = -1, ticking = false, top0 = 0;
  let laidOutW = window.innerWidth;

  function layout() {
    vh = window.innerHeight;
    laidOutW = window.innerWidth;
    stageX = 0;
    let off = 0;
    SEGMENTS.forEach(s => { s.start = off * vh; off += s.w; s.end = off * vh; });
    totalW = off;
    track.style.height = (totalW * vh + vh) + 'px';   // +1vh so the last flight completes
    top0 = container.getBoundingClientRect().top + (window.scrollY || 0);
    read();
  }

  function jumpTo(i) {
    const seg = SECTIONS[i]._seg;
    const y = i === 0 ? 0 : seg.start + (seg.end - seg.start) * 0.5;
    window.scrollTo({ top: top0 + y, behavior: reduce ? 'auto' : 'smooth' });
  }

  // ---- codec: AV1 only where the browser decodes it in hardware, else H.264 ----
  // AV1 files are ~35-45% smaller, but scrubbing seeks constantly and software
  // AV1 seeks are slower than H.264, so AV1 needs mediaCapabilities to report
  // supported + smooth + powerEfficient (= hardware). `?codec=av1|h264` forces one.
  const AV1_TYPE = 'video/mp4; codecs="av01.0.08M.08"';
  const H264_TYPE = 'video/mp4; codecs="avc1.640028"';
  const forced = (location.search.match(/[?&]codec=(av1|h264)/) || [])[1];
  let useAv1 = false, formatKnown = false, caps = {};
  async function probe(type) {
    try {
      if (!navigator.mediaCapabilities) return null;
      const m = isMobile();
      return await navigator.mediaCapabilities.decodingInfo({ type: 'file',
        video: { contentType: type, width: m ? 1280 : 1920, height: m ? 720 : 1080, bitrate: 5e6, framerate: 30 } });
    } catch (e) { return null; }
  }
  (async () => {
    if (!reduce && SEGMENTS.some(s => s.clipAv1)) {
      const [a, h] = await Promise.all([probe(AV1_TYPE), probe(H264_TYPE)]);
      caps = { av1: a, h264: h };
      useAv1 = forced ? forced === 'av1' : !!(a && a.supported && a.smooth && a.powerEfficient);
    }
    formatKnown = true;
    pump(currentY());
  })();
  function clipSource(s) {
    const m = isMobile();
    const av1 = useAv1 && !s.noAv1 ? (m ? s.clipMAv1 : s.clipAv1) : null;
    return av1 ? { url: av1, av1: true } : { url: (m && s.clipM) ? s.clipM : s.clip, av1: false };
  }

  // ---- clip loading: one download at a time, nearest scene first ----
  // Each clip must be fully downloaded (blob = always seekable) before it can
  // scrub. Downloading several in parallel splits the bandwidth and delays the
  // clip on screen, so clips are queued: the scene in view first, then the next
  // ones ahead, then the one just behind. A download for a scene the visitor
  // has jumped far away from is aborted in favour of the one in view.
  const LOOK_AHEAD = () => (isMobile() ? 3 : 6);   // viewport-heights ahead to prefetch
  const LOOK_BEHIND = 1.2;
  let activeLoad = null;

  function distance(s, y) {
    if (y >= s.start && y <= s.end) return 0;
    if (s.start > y) return (s.start - y) / vh;
    return 1.5 * (y - s.end) / vh;               // behind the visitor: lower priority
  }
  function nextToLoad(y) {
    let best = null, bestD = Infinity;
    for (const s of SEGMENTS) {
      if (s.hasClip || s.loading || !s.clip || s.fails >= 3) continue;
      const d = distance(s, y);
      const inWindow = s.start > y ? d <= LOOK_AHEAD() : d <= 1.5 * LOOK_BEHIND;
      if (inWindow && d < bestD) { best = s; bestD = d; }
    }
    return best;
  }
  // Pre-empt the running download when the visitor has settled (250 ms without
  // scrolling — smooth scrolls and flicks pass through scenes they don't stop
  // at) on a scene whose clip isn't loaded, and the running one is for another
  // scene and not mostly done (an aborted download restarts from zero).
  let preemptTimer = 0;
  function maybePreempt() {
    const y = currentY();
    const best = nextToLoad(y);
    const a = activeLoad;
    if (a && best && distance(best, y) === 0 && distance(a, y) > 0 && a.progress < 0.6) a.ctrl.abort();
  }
  function pump(y) {
    if (reduce || !formatKnown) return;
    if (activeLoad) {
      clearTimeout(preemptTimer);
      preemptTimer = setTimeout(maybePreempt, 250);
      return;
    }
    const best = nextToLoad(y);
    if (best) loadClip(best);
  }

  async function fetchWithProgress(url, s) {
    const res = await fetch(url, { signal: s.ctrl.signal });
    if (!res.ok) throw new Error(String(res.status));
    const total = Number(res.headers.get('content-length')) || 0;
    if (!res.body || !total) return res.blob();
    const reader = res.body.getReader();
    const chunks = []; let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      s.progress = Math.min(1, got / total);
      updateLoader();
    }
    return new Blob(chunks, { type: res.headers.get('content-type') || 'video/mp4' });
  }

  function loadClip(s) {
    if (reduce || s.loading || !s.clip) return;
    s.loading = true; s.progress = 0;
    s.ctrl = new AbortController();
    activeLoad = s;
    const src = clipSource(s);
    const url = src.url;
    s.src = url; s.srcAv1 = src.av1;
    const done = () => { if (activeLoad === s) activeLoad = null; s.ctrl = null; updateLoader(); pump(currentY()); };
    fetchWithProgress(url, s)
      .then(blob => {
        const v = document.createElement('video');
        v.className = 'sw-scene__video';
        v.muted = true; v.playsInline = true; v.preload = 'auto';
        v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
        v.src = URL.createObjectURL(blob);
        v.addEventListener('loadedmetadata', () => { s.ready = true; read(); });
        // Hide the still poster only once a real frame has painted (iOS quirk).
        v.addEventListener('seeked', () => { s.el.classList.add('has-clip'); }, { once: true });
        v.addEventListener('loadeddata', () => { try { v.pause(); } catch (e) {} if (userReady) primeVideo(v); });
        // The file downloaded but this browser can't decode it: retry the scene in
        // H.264 if it was AV1 (and stop using AV1), otherwise keep the still poster.
        v.addEventListener('error', () => {
          s.lastError = v.error ? `code ${v.error.code}` : 'error';
          v.remove(); s.video = null; s.hasClip = false; s.ready = false; s.loading = false; s.progress = 0;
          s.el.classList.remove('has-clip');
          if (s.srcAv1) { s.noAv1 = true; useAv1 = false; } else { s.fails = 3; }
          updateLoader(); pump(currentY());
        }, { once: true });
        if (DEBUG) v.addEventListener('seeked', () => {
          if (!s.seekT0) return;
          const dt = performance.now() - s.seekT0; s.seekT0 = 0;
          s.seekN = (s.seekN || 0) + 1; s.seekSum = (s.seekSum || 0) + dt; s.seekMax = Math.max(s.seekMax || 0, dt);
        });
        s.el.appendChild(v); s.video = v; s.hasClip = true;
        done();
      }).catch(err => {
        s.loading = false; s.progress = 0;
        if (!(err && err.name === 'AbortError')) s.lastError = String(err && err.message || err);
        if (!(err && err.name === 'AbortError')) s.fails += 1;   // aborted = re-queued, not failed
        done();
      });
  }

  let curSeg = null;
  function currentY() { return (window.scrollY || window.pageYOffset) - top0; }
  function updateLoader() {
    const s = curSeg;
    const waiting = !reduce && s && s.clip && !s.ready && s.fails < 3 && !container.classList.contains('sw-past');
    loader.classList.toggle('is-on', !!waiting);
    if (waiting) {
      const p = Math.round((s.progress || 0) * 100);
      loaderArc.style.strokeDashoffset = String(100 - p);
      loaderPct.textContent = p ? `${p}%` : '';
    }
  }

  function read() {
    const y = currentY();
    const fade = CROSSFADE * vh;
    let ci = 0;
    for (let i = 0; i < NSEG; i++) if (y >= SEGMENTS[i].start) ci = i;
    curSeg = SEGMENTS[ci];
    pump(y);

    for (let i = 0; i < NSEG; i++) {
      const s = SEGMENTS[i];
      const local = clamp((y - s.start) / (s.end - s.start), 0, 1);
      s.target = s.linger ? lingerEase(local, s.linger) : local;
      let outside = 0;
      if (y < s.start) outside = s.start - y; else if (y > s.end) outside = y - s.end;
      // The last segment stays up after its band so the page content slides over it.
      const op = (i === NSEG - 1 && y > s.end) ? 1 : smooth(1 - outside / fade);
      s.el.style.opacity = op; s.visible = op > 0.001;
      s.el.style.zIndex = (i === ci) ? '120' : String(100 + Math.round(op * 10));
      if (!s.hasClip || !s.ready) {
        const sc = reduce ? 1 : 1.03 + local * 0.14;
        s.img.style.transform = `translateX(${stageX}vw) scale(${sc.toFixed(3)})`;
      }
    }

    for (let i = 0; i < N; i++) {
      const seg = SECTIONS[i]._seg;
      const pr = clamp((y - seg.start) / (seg.end - seg.start), 0, 1);
      const before = y < seg.start, after = y > seg.end;
      let cop;
      if (i === 0) cop = after ? 0 : smooth(1 - pr / 0.62);            // greets on landing
      else if (i === N - 1) cop = before ? 0 : smooth(pr / 0.4);       // holds CTA at the end
      else cop = (before || after) ? 0 : smooth(1 - Math.abs(pr - 0.5) / 0.5);
      const c = copies[i];
      c.style.opacity = cop;
      c.style.transform = reduce ? 'none' : `translateY(${((0.5 - pr) * 4).toFixed(2)}vh)`;
      c.style.pointerEvents = cop > 0.5 ? 'auto' : 'none';
      c.style.visibility = cop > 0.01 ? 'visible' : 'hidden';   // keeps hidden CTAs out of the tab order
    }

    const cur = SEGMENTS[ci];
    const near = clamp(cur.kind === 'dive' ? cur.si
      : (((y - cur.start) / (cur.end - cur.start)) > 0.5 ? cur.si + 1 : cur.si), 0, N - 1);
    if (near !== activeIndex) {
      activeIndex = near;
      dots.forEach((d, k) => {
        d.classList.toggle('is-active', k === near);
        if (k === near) d.setAttribute('aria-current', 'step'); else d.removeAttribute('aria-current');
      });
      if (SECTIONS[near].accent) container.style.setProperty('--sw-accent', SECTIONS[near].accent);
    }
    scrollbarFill.style.transform = `scaleX(${clamp(y / (totalW * vh))})`;
    hint.style.opacity = clamp(1 - y / (0.5 * vh));
    container.classList.toggle('sw-past', y > totalW * vh + vh - 2);
    container.classList.toggle('sw-leaving', y > totalW * vh + 0.15 * vh);
    updateLoader();
    ticking = false;
  }

  function raf() {
    const eps = isMobile() ? 0.02 : 0.008;
    for (let i = 0; i < NSEG; i++) {
      const s = SEGMENTS[i];
      if (!s.hasClip || !s.ready || !s.video) continue;
      if (s.video.seeking) continue;   // coalesce seeks (phones freeze otherwise)
      if (!s.visible && Math.abs(s.cur - s.target) < 0.002) continue;
      s.cur += (s.target - s.cur) * (reduce ? 1 : 0.18);
      const dur = s.video.duration || 1;
      const t = clamp(s.cur, 0, 0.999) * dur;
      if (Math.abs(s.video.currentTime - t) > eps) { try { if (DEBUG) s.seekT0 = performance.now(); s.video.currentTime = t; } catch (e) {} }
    }
    requestAnimationFrame(raf);
  }

  // iOS: prime every loaded clip (muted play→pause) on the first touch.
  let userReady = false;
  function primeVideo(v) {
    if (!isMobile() || !v) return;
    try { const p = v.play(); if (p && p.then) p.then(() => { try { v.pause(); } catch (e) {} }).catch(() => {}); }
    catch (e) {}
  }
  function onFirstGesture() {
    if (userReady) return;
    userReady = true;
    SEGMENTS.forEach(s => primeVideo(s.video));
  }
  window.addEventListener('pointerdown', onFirstGesture, { once: true, passive: true });
  window.addEventListener('touchstart', onFirstGesture, { once: true, passive: true });

  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(read); } }, { passive: true });
  // Ignore URL-bar-only (height) resizes on touch so the page doesn't jump.
  function onResize() {
    if (coarse && window.innerWidth === laidOutW) return;
    layout();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', layout);
  window.addEventListener('load', layout);
  layout();
  requestAnimationFrame(raf);

  if (DEBUG) mountDebugPanel();
  function mountDebugPanel() {
    const box = el('pre', 'sw-debug');
    document.body.appendChild(box);
    const errs = [];
    window.addEventListener('error', e => errs.push(String(e.message)));
    window.addEventListener('unhandledrejection', e => errs.push(String(e.reason)));
    const cp = t => document.createElement('video').canPlayType(t) || 'no';
    const c = x => x ? `${x.supported ? 'S' : '-'}${x.smooth ? 'M' : '-'}${x.powerEfficient ? 'P' : '-'}` : 'n/a';
    setInterval(() => {
      box.textContent = [
        navigator.userAgent,
        `viewport ${innerWidth}x${innerHeight} dpr ${devicePixelRatio} mobile=${isMobile()} reducedMotion=${reduce}`,
        `canPlayType h264=${cp(H264_TYPE)} av1=${cp(AV1_TYPE)} | caps h264=${c(caps.h264)} av1=${c(caps.av1)} (S supported, M smooth, P powerEfficient)`,
        `format: ${formatKnown ? (useAv1 ? 'AV1' : 'H.264') : 'probing…'}${forced ? ' (forced)' : ''}   y=${Math.round(currentY())}`,
        'scene      file                  dl   ready rs  error       seeks avg/max ms',
        ...SEGMENTS.map(s => [
          String(SECTIONS[s.si].id || s.si).padEnd(10), (s.src || '-').split('/').pop().padEnd(21),
          `${Math.round((s.progress || 0) * 100)}%`.padStart(4), (s.ready ? 'yes' : 'no').padEnd(5),
          String(s.video ? s.video.readyState : '-').padEnd(3), (s.lastError || '-').slice(0, 11).padEnd(11),
          String(s.seekN || 0).padStart(5), s.seekN ? ` ${Math.round(s.seekSum / s.seekN)}/${Math.round(s.seekMax)}` : '',
        ].join(' ')),
        `errors: ${errs.length ? errs.slice(-3).join(' | ') : 'none'}`,
      ].join('\n');
    }, 500);
  }

  return { jumpTo, sections: SECTIONS.map(s => s.id) };

  // ---- helpers ----
  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
}
