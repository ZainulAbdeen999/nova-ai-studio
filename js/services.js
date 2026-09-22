"use strict";

const Services = (() => {
  const TEXT_API = "https://text.pollinations.ai/v1/chat/completions";
  const IMG_API = "https://image.pollinations.ai/prompt/";
  const TTS_API = "https://translate.google.com/translate_tts";

  async function probeOnline() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch("https://text.pollinations.ai/", { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok || r.status === 405) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  const SYSTEM = {
    role: "system",
    content:
      "Tu NOVA ho — ek personal AI assistant. Roman Urdu + English dono mein jawab de. " +
      "Concise aur helpful raho (2-6 lines unless detail maanga jaye), do ya zyada topics par bullet points use karo. " +
      "Math, coding, writing, planning — sab kaam aata hai."
  };

  function chat(messages, history = [], name = "") {
    const msgs = [SYSTEM];
    if (name) msgs.push({ role: "system", content: "User ka naam: " + name + "." });
    for (const m of history.slice(-10)) {
      const txt = (m.text || "").trim();
      if (!txt) continue;
      msgs.push({ role: m.role === "me" ? "user" : "assistant", content: txt });
    }
    msgs.push({ role: "user", content: messages });
    const payload = { model: "openai", messages: msgs, temperature: 0.7 };
    const parse = (d) => {
      const out = ((d.choices || [{}])[0].message || {}).content || "";
      if (!out.trim()) throw new Error("empty");
      return out.trim();
    };
    return proxyLive().then((pp) =>
      pp
        ? fetch("/proxy/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))).then(parse)
        : fetch(TEXT_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          })
            .then((r) => {
              if (!r.ok) throw new Error("HTTP " + r.status);
              return r.json();
            })
            .then(parse));
  }

  function imageUrl(prompt, { width = 384, height = 384, seed = null, enhance = true } = {}) {
    const p = encodeURIComponent(prompt);
    let u = IMG_API + p + "?width=" + width + "&height=" + height + "&nologo=true";
    if (enhance) u += "&enhance=true";
    u += "&seed=" + (seed == null ? Math.floor(Math.random() * 1e6) : seed);
    return u;
  }

  function served() {
    return location.protocol === "http:" || location.protocol === "https:";
  }

  let proxyOk = null;
  async function proxyLive() {
    if (proxyOk !== null) return proxyOk;
    if (!served()) { proxyOk = false; return false; }
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 2500);
      const r = await fetch("/health", { signal: c.signal });
      clearTimeout(t);
      proxyOk = r.ok;
    } catch (e) { proxyOk = false; }
    return proxyOk;
  }

  function loadImage(url, timeout = 150000) {
    return fetchImage(url, timeout);
  }

  async function fetchImage(seedUrl, timeout = 150000, tries = 3) {
    const rawUrl = seedUrl.indexOf("nologo=") === -1 ? seedUrl + "&nologo=true" : seedUrl;
    let attempt = 0;
    while (attempt < tries) {
      attempt++;
      let url = rawUrl;
      if (attempt > 1 && url.indexOf("model=") === -1) url += "&model=turbo";
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), timeout);
      let r;
      try {
        r = await fetch(url, { signal: ctrl.signal });
      } catch (e) {
        clearTimeout(to);
        if (attempt < tries) { await waitMs(2200 * attempt); continue; }
        throw new Error("network ruk gayi — internet check karein");
      }
      clearTimeout(to);
      if (r.status === 429) {
        if (attempt < tries) { await waitMs(3000 * attempt); continue; }
        throw new Error("AI thora busy hai (rate limit) — 10-20s ruk kar dobara karein");
      }
      if (!r.ok) {
        if (attempt < tries) { await waitMs(1600 * attempt); continue; }
        throw new Error("AI ne try mehnat ka jawab nahi diya (HTTP " + r.status + ") — thora der mein dobara karein");
      }
      const blob = await r.blob();
      if (!blob.size) throw new Error("empty");
      return URL.createObjectURL(blob);
    }
    throw new Error("gave up");
  }

  function waitMs(ms) { return new Promise((res) => setTimeout(res, ms)); }

  function hashSeed(s) {
    let h = 7;
    for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) >>> 0;
    return h;
  }

  function instantArt(prompt, w, h) {
    const seed = hashSeed(prompt);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const hue = seed % 360;
    const style = seed % 6;
    const pal = (hue) => ({
      0: "hsl(" + hue + ",60%,14%)", 1: "hsl(" + ((hue + 60) % 360) + ",60%,10%)",
      2: "hsl(" + ((hue + 120) % 360) + ",60%,12%)", 3: "hsl(" + ((hue + 180) % 360) + ",70%,14%)"
    });

    if (style === 0 || style === 1) {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, pal(hue)[0]);
      bg.addColorStop(1, pal(hue)[3]);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < (style ? 110 : 70); i++) {
        ctx.fillStyle = "rgba(255,255,255," + (0.12 + rnd() * 0.6) + ")";
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h * 0.7, style ? 0.4 + rnd() * 2.6 : 0.5 + rnd() * 1.8, 0, 7);
        ctx.fill();
      }
      for (let l = 0; l < 3; l++) {
        const yy = h * (0.4 + 0.14 * l) + rnd() * 24;
        const col = pal((hue + 40 * l) % 360)[(l + 1) % 4];
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(0, h);
        const step = w / (8 + l * 2);
        for (let x = 0; x <= w + step; x += step)
          ctx.lineTo(x, yy - Math.sin(x * 0.008 + l * 3 + seed % 7) * (h * 0.07 + rnd() * 16));
        ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "hsl(" + ((hue + 180) % 360) + ",82%," + (72 + rnd() * 13) + "%)";
      ctx.beginPath();
      ctx.arc(w * (0.68 + rnd() * 0.26), h * 0.14 + rnd() * 16, 20 + rnd() * 18, 0, 7);
      ctx.fill();
    } else if (style === 2) {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, "#12041f"); bg.addColorStop(1, "#04243b");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(124,108,255,.55)";
      ctx.lineWidth = 2;
      for (let g = 0; g < 14; g++) {
        ctx.beginPath();
        const cy = h / 2 + Math.sin(g) * h * 0.16;
        for (let x = 0; x <= w; x += 8) {
          const y = cy + Math.sin(x * 0.02 + g) * h * 0.06;
          g ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = "hsl(" + ((hue + i * 5) % 360) + ",80%,60%)";
        ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 1 + rnd() * 2, 0, 7); ctx.fill();
      }
    } else if (style === 3) {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, "#10302a"); bg.addColorStop(1, "#0a1613");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      for (let d = 30; d < 15 + Math.max(w, h); d += 30) {
        ctx.strokeStyle = "hsla(" + ((hue + 150) % 360) + ",70%," + (70 - (d / 12)) + "%,.5)";
        ctx.lineWidth = 1.6;
        ctx.strokeRect(w / 2 - d / 2, h / 2 - d / 2, d, d);
        ctx.rotate(Math.PI / 180 * 12);
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    } else if (style === 4) {
      const bg = ctx.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, "#2b0a3a"); bg.addColorStop(1, "#0b1b33");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 160; i++) {
        ctx.fillStyle = "rgba(255,180,220," + (0.15 + rnd() * 0.7) + ")";
        ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 0.6 + rnd() * 3, 0, 7); ctx.fill();
      }
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = "rgba(190,120,255,.9)";
        ctx.beginPath();
        ctx.arc(rnd() * w, rnd() * h, 3 + rnd() * 7, 0, 7);
        ctx.fill();
      }
    } else {
      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, "#02101f"); bg.addColorStop(1, "#0b2a20");
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h * 0.62;
      for (let a = 0; a <= 28; a += 2) {
        ctx.strokeStyle = "hsla(" + ((hue + a * 6) % 360) + ",85%,60%,.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, a * (Math.max(w, h) / 56), a * Math.PI / 14, (a + 10) * Math.PI / 14);
        ctx.stroke();
      }
    }
    return cv.toDataURL("image/png");
  }

  function lofi() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.14;
    master.connect(ctx.destination);
    let timer = null;
    let step = 0;
    const chords = [261.6, 329.6, 392.0, 220.0, 261.6, 329.6, 349.2, 440.0, 196.0, 246.9, 293.7, 329.6];
    const playChord = () => {
      const t = ctx.currentTime;
      for (let k = 0; k < 3; k++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = k === 1 ? "triangle" : "sine";
        o.frequency.value = chords[(step * 3 + k) % chords.length];
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(k === 2 ? 0.04 : 0.09, t + 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 3.9);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + 4.2);
      }
      step = (step + 1) % 4;
      if (Math.random() < 0.8) {
        const hi = ctx.createOscillator();
        const hg = ctx.createGain();
        hi.type = "triangle";
        hi.frequency.value = 740 + Math.random() * 300;
        hg.gain.setValueAtTime(0.02, t + 1.6);
        hg.gain.exponentialRampToValueAtTime(0.0001, t + 1.85);
        hi.connect(hg); hg.connect(master);
        hi.start(t + 1.6); hi.stop(t + 1.9);
      }
    };
    playChord();
    timer = setInterval(playChord, 2000);
    return {
      stop() {
        if (timer) clearInterval(timer);
        ctx.close().catch(() => {});
      }
    };
  }

  function chime(ok = true) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      const f1 = ok ? 880 : 330;
      const f2 = ok ? 1320 : 220;
      o.frequency.setValueAtTime(f1, ctx.currentTime);
      o.frequency.exponentialRampToValueAtTime(f2, ctx.currentTime + 0.16);
      g.gain.setValueAtTime(0.12, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 0.45);
    } catch (e) { /* silent */ }
  }

  function proceduralSpr(prompt, w, h) {
    const seed = hashSeed(prompt);
    const cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const ctx = cv.getContext("2d");
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const hue = seed % 360;
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "hsl(" + hue + ",58%," + (16 + rnd() * 9) + "%)");
    bg.addColorStop(1, "hsl(" + ((hue + 70) % 360) + ",58%," + (6 + rnd() * 7) + "%)");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = "rgba(255,255,255," + (0.15 + rnd() * 0.6) + ")";
      ctx.beginPath();
      ctx.arc(rnd() * w, rnd() * h * 0.6, 0.5 + rnd() * 1.8, 0, 7);
      ctx.fill();
    }
    for (let l = 0; l < 3; l++) {
      const yy = h * (0.42 + 0.13 * l) + rnd() * 26;
      ctx.fillStyle = "hsla(" + ((hue + 40 * l) % 360) + ",55%," + (20 + 9 * l) + "%,.88)";
      ctx.beginPath();
      ctx.moveTo(0, h);
      const step = w / (8 + l * 2);
      for (let x = 0; x <= w + step; x += step) {
        ctx.lineTo(x, yy - Math.sin(x * 0.008 + l * 3 + seed % 7) * (h * 0.06 + rnd() * 18));
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = "hsl(" + ((hue + 180) % 360) + ",82%," + (70 + rnd() * 14) + "%)";
    ctx.beginPath();
    ctx.arc(w * (0.68 + rnd() * 0.24), h * 0.15 + rnd() * 18, 22 + rnd() * 20, 0, 7);
    ctx.fill();
    return cv;
  }

  async function svgArt(prompt) {
    const desc = await chat(
      "Sirf ek complete <svg> block likho — koi aur text, koi code-fence nahi. " +
      "viewBox=\"0 0 400 220\". Mashhoor soch: " + prompt + ". Sundar gradient background, " +
      "2-3 bari, simple, tasteful shapes. XML entities sahi rakho. Bas SVG.",
      [], ""
    );
    const m = String(desc || "").match(/<svg[\s\S]*?<\/svg>/i);
    return m ? m[0] : null;
  }

  async function buildSceneSrc(prompt, w = 384, h = 384, opts = {}) {
    const t0 = Date.now();
    const ms = () => Math.round((Date.now() - t0) / 1000);
    const fast = !!opts.fast;
    if (await proxyLive()) {
      try {
        const seed = Math.floor(Math.random() * 1e6);
        const u = "/proxy/img?prompt=" + encodeURIComponent(prompt) + "&w=" + w + "&h=" + h + "&seed=" + seed;
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), fast ? 35000 : 170000);
        const r = await fetch(u, { signal: ctrl.signal });
        clearTimeout(to);
        if (r.ok) {
          const b = await r.blob();
          if (b.size > 1500) return { kind: "flux", src: URL.createObjectURL(b), ms: ms() };
        }
      } catch (e) { /* next level */ }
    }
    try {
      const u = imageUrl(prompt, { width: w, height: h, seed: Math.floor(Math.random() * 1e6), enhance: false });
      const blob = await fetchImage(u, fast ? 25000 : 150000, fast ? 1 : 2);
      return { kind: "flux", src: blob, ms: ms() };
    } catch (e) { /* next level */ }
    try {
      const sv = await svgArt(prompt);
      if (sv) {
        const blob = await (await fetch("data:image/svg+xml;utf8," + encodeURIComponent(sv))).blob();
        if (blob.size > 300) return { kind: "chat-svg", src: URL.createObjectURL(blob), ms: ms() };
      }
    } catch (e) { /* next level */ }
    const cv = proceduralSpr(prompt, w, h);
    return { kind: "artist", src: cv.toDataURL("image/png"), ms: ms() };
  }

  function googleTtsUrl(text, lang = "ur", rate = 1) {
    return TTS_API + "?ie=UTF-8&q=" + encodeURIComponent(text) + "&tl=" + lang + "&client=tw-ob&ttsspeed=" + rate;
  }

  async function ttsUrlFor(text, lang = "ur", rate = 1) {
    if (await proxyLive()) return "/proxy/tts?text=" + encodeURIComponent(text) + "&lang=" + lang + "&rate=" + rate;
    return googleTtsUrl(text, lang, rate);
  }

  async function playTts(text, lang = "ur", rate = 1) {
    return new Promise((resolve, reject) => {
      if (!text.trim()) { reject(new Error("empty text")); return; }
      ttsUrlFor(text, lang, rate).then((u) => {
        const audio = new Audio(u);
        audio.onended = () => resolve(audio);
        audio.onerror = () => reject(new Error("audio failed"));
        audio.play().catch(reject);
      }).catch(reject);
    });
  }

  function speakNative(text, lang = "ur") {
    if (!("speechSynthesis" in window)) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang.startsWith("ur") ? "ur-PK" : lang.startsWith("en") ? "en-US" : lang;
    speechSynthesis.speak(u);
    return true;
  }

  function recordAudio(text, lang = "ur") {
    return new Promise((resolve, reject) => {
      ttsUrlFor(text, lang, 1).then((u) => {
        const audio = new Audio(u);
        audio.crossOrigin = "anonymous";
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = ctx.createMediaStreamDestination();
        let src;
        audio.onloadedmetadata = () => {
          try {
            src = ctx.createMediaElementSource(audio);
            src.connect(dest);
            src.connect(ctx.destination);
          } catch (e) {
            reject(e); return;
          }
          const rec = new MediaRecorder(dest.stream, { mimeType: mimeType() });
          const chunks = [];
          rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
          rec.onstop = () => {
            ctx.close().catch(() => {});
            resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
          };
          rec.start();
          audio.play().catch(reject);
          audio.onended = () => setTimeout(() => rec.state !== "inactive" && rec.stop(), 250);
        };
        audio.onerror = () => reject(new Error("tts failed"));
        audio.load();
      }).catch(reject);
    });
  }

  function mimeType(kind = "video") {
    const cands = kind === "video"
      ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
    for (const m of cands) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
    }
    return "";
  }

  function makeRecognition(lang = "ur-PK") {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    return rec;
  }

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function downloadUrl(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return { probeOnline, served, chat, imageUrl, fetchImage, loadImage, buildSceneSrc, hashSeed,
    instantArt, lofi, chime, ttsUrlFor, playTts, speakNative, recordAudio, mimeType,
    makeRecognition, download, downloadUrl };
})();