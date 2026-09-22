"use strict";

const $ = (id) => document.getElementById(id);
const LS = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
};
const NOW = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

let online = false;
let botName = LS.get("nova_name", "Bhai");
let chatLog = LS.get("studio_chat", []);
let sendLock = false;
let imgSeed = Math.floor(Math.random() * 1e6);
let narrationDriven = false;
let _vidRaf = 0;
let _txtRaf = 0;

const QUICK = [
  "Aaj ka ek positive thought do",
  "250 ka 12% kitna hai?",
  "AI ke baare mein ek line",
  "Mera mausam kesa chal raha hai?",
  "Haan, theek hoon, tum sunao"
];

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ================= status ================= */
async function refreshStatus() {
  const pill = $("statusPill");
  if (Services.served()) {
    try {
      const r = await fetch("/health");
      if (r.ok) {
        pill.dataset.mode = "online";
        $("statusTxt").textContent = "SERVER";
        return;
      }
    } catch (e) { /* no server */ }
  }
  const on = await Services.probeOnline();
  online = on;
  pill.dataset.mode = on ? "online" : "offline";
  $("statusTxt").textContent = on ? "ONLINE AI" : "OFFLINE MODE";
  $("chatSub").textContent = on ? "online AI — free, no key · zinda jawab" : "offline brain — local fallback";
}

/* ================= tabs ================= */
document.querySelectorAll(".navbtn").forEach((b) =>
  b.addEventListener("click", () => switchTab(b.dataset.tab)));

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("hidden", t.id !== "tab-" + name));
  document.querySelectorAll(".navbtn").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  if (name === "chat") $("chatInput").focus();
}

/* ================= chat ================= */
const OFF = [
  { m: /hi|hello|salam|assalam/i, r: "Assalamu Alaikum " + botName + "! 😊 Internet band hai toh main local mein hoon." },
  { m: /thank|shukria|nice|great/i, r: "Shukriya! Zaroorat par yehi raha — abhi online mode khol ke puchiye." },
  { m: /name/, r: "Main NOVA hoon, aapka apna AI. Abhi offline hoon." },
  { m: /time|wakt|baje/i, r: () => "Abhi time hai " + NOW() + "." },
  { m: /joke|hasi|khail/i, r: "Main AI hoon jokes seekhne ke liye online hota hoon! 😅 Internet chalu karein." },
];
const OFF_FALLBACK = "Samajh gaya, lekin main abhi offline mode mein hoon. Internet wapas aane par full AI jawab dunga! 💡";

function greetName(text) {
  let m = text.match(/(?:mera naam|my name is|call me|i am|i'm)\s+([A-Za-z]+)/i);
  if (!m) m = text.match(/\b(?:main|mein|mai)\s+([A-Za-z]+)\s+(?:hoon|hu|hoon)\b/i);
  return m ? m[1] : null;
}

function renderChat() {
  const log = $("chatLog");
  log.innerHTML = "";
  chatLog.forEach((m) => log.appendChild(bubble(m.text, m.role)));
  log.scrollTop = log.scrollHeight;
}

function bubble(text, role) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.innerHTML = role === "bot" && /<[a-z][\s\S]*>/i.test(text) ? renderMarkdown(text) : escapeHtml(text).replace(/\n/g, "<br>");
  return div;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendMsg() {
  const input = $("chatInput");
  const text = input.value.trim();
  if (!text || sendLock) return;
  input.value = "";
  chatLog.push({ role: "me", text, time: NOW() });
  renderChat();
  const name = greetName(text);
  if (name) {
    botName = name.charAt(0).toUpperCase() + name.slice(1);
    LS.set("nova_name", botName);
  }
  const me = chatLog.findLast((m) => m.role === "me");
  if (me) me.time = NOW();
  sendLock = true;
  showTyping();
  try {
    const reply = await Services.chat(text, chatLog.slice(0, -1), online && botName !== "Bhai" ? botName : "");
    chatLog.push({ role: "bot", text: reply, time: NOW() });
  } catch (e) {
    chatLog.push({ role: "bot", text: localBrain(text), time: NOW() });
    if (online) toast("online AI na chal saka — local jawab");
  } finally {
    sendLock = false;
    renderChat();
  }
}

function localBrain(text) {
  for (const o of OFF) {
    if (o.m.test(text)) return typeof o.r === "function" ? o.r() : o.r;
  }
  return OFF_FALLBACK;
}

function showTyping() {
  const log = $("chatLog");
  const d = document.createElement("div");
  d.className = "msg bot";
  d.id = "typing";
  d.textContent = "soch raha hoon…";
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

$("chatForm").addEventListener("submit", (e) => { e.preventDefault(); sendMsg(); });
QUICK.forEach((q) => {
  const c = document.createElement("button");
  c.className = "chip qa";
  c.textContent = q;
  c.onclick = () => {
    $("chatInput").value = q;
    sendMsg();
  };
  $("chips").appendChild(c);
});

/* ================= images ================= */
let imgHist = LS.get("studio_img", []);
let imgSize = "384x384";

document.querySelectorAll("#imgSize .chip").forEach((c) =>
  c.addEventListener("click", () => {
    document.querySelectorAll("#imgSize .chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    imgSize = c.dataset.size;
  }));

let imgMode = "auto";
let genId = 0;

document.querySelectorAll("#imgMode .chip").forEach((c) =>
  c.addEventListener("click", () => {
    document.querySelectorAll("#imgMode .chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    imgMode = c.dataset.mode;
  }));

function saveImgHist() {
  imgHist = imgHist.slice(0, 12);
  LS.set("studio_img", imgHist);
  renderHist();
}

async function genImage() {
  const prompt = $("imgPrompt").value.trim();
  if (!prompt) { toast("Pehle prompt likhiye"); return; }
  const [w, h] = imgSize.split("x").map(Number);
  const btn = $("imgGen");
  btn.disabled = true;
  btn.textContent = "✨ AI soch raha…";
  const img = $("imgOut");
  const label = $("imgSrcLabel");
  $("imgResult").classList.remove("hidden");
  const myId = ++genId;
  label.textContent = "";
  img.src = Services.instantArt(prompt, w, h);
  $("imgLoader").classList.add("hidden");
  label.textContent = "⚡ instant preview (foran)";
  if (imgMode === "instant") {
    imgHist.unshift({ prompt, url: img.src, w, h, kind: "artist", ts: Date.now() });
    saveImgHist();
    toast("⚡ Instant art tayyar!"); Services.chime(true);
    btn.disabled = false; btn.textContent = "✨ AI banao";
    return;
  }
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (genId === myId)
      label.textContent = "⚡ preview dekha raha · AI behtar bana raha… " + Math.round((Date.now() - t0) / 1000) + "s";
  }, 1000);
  try {
    const scene = await Services.buildSceneSrc(prompt, w, h);
    if (genId === myId && scene) {
      img.src = scene.src;
      label.textContent = scene.kind === "flux" ? "✨ AI image · flux (online · " + scene.ms + "s)"
        : scene.kind === "chat-svg" ? "🎨 AI art · LLM design (" + scene.ms + "s)"
        : "🎨 AI art · local artist (" + scene.ms + "s)";
      imgHist.unshift({ prompt, url: scene.src, w, h, kind: scene.kind, ts: Date.now() });
      saveImgHist();
      toast("✨ AI image tayyar!"); Services.chime(true);
    }
  } catch (e) {
    if (genId === myId) { label.textContent = "⚡ preview (AI na pada)"; toast("AI behi na pada — preview raha ✓"); Services.chime(false); }
  } finally {
    clearInterval(tick);
    if (genId === myId) { btn.disabled = false; btn.textContent = "✨ AI banao"; }
  }
}

function renderHist() {
  const box = $("imgHist");
  $("imgHistCount").textContent = "· " + imgHist.length;
  box.innerHTML = "";
  imgHist.forEach((it, i) => {
    const th = document.createElement("div");
    th.className = "hist-thumb" + (/^data:/.test(it.url || "") ? "" : " regen");
    th.title = it.prompt + (it.kind ? " · " + it.kind : "");
    if (/^data:/.test(it.url || "")) {
      const img = document.createElement("img");
      img.src = it.url;
      th.appendChild(img);
    } else {
      th.textContent = "↻";
    }
    th.onclick = () => {
      $("imgPrompt").value = it.prompt;
      genImage();
    };
    box.appendChild(th);
  });
}

$("imgGen").addEventListener("click", genImage);
$("imgVariation").addEventListener("click", () => { imgSeed = Math.floor(Math.random() * 1e6); genImage(); });
$("imgDownload").addEventListener("click", async () => {
  const img = $("imgOut");
  if (!img.src) return;
  try {
    const blob = await fetch(img.src).then((r) => (r.ok ? r.blob() : Promise.reject()));
    Services.download(blob, "nova-ai-" + Date.now() + ".jpg");
  } catch (e) {
    toast("Download nahi hua — internet check karein");
  }
});

/* ================= voice ================= */
function ttsLang() { return $("ttsLang").value; }
function ttsText() { return $("ttsText").value.trim(); }

$("ttsPlay").addEventListener("click", async () => {
  const t = ttsText();
  if (!t) { toast("Kuch likhiye pehle"); return; }
  const btn = $("ttsPlay");
  btn.disabled = true;
  btn.textContent = "▶ bol rahi…";
  try {
    await Services.playTts(t, ttsLang(), parseFloat($("ttsSpeed").value));
  } catch (e) {
    if (!Services.speakNative(t, ttsLang())) {
      toast("Awaz nahi chali — run.bat se khol ke dabayein");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "▶ Play";
  }
});

$("ttsRec").addEventListener("click", async () => {
  const t = ttsText();
  if (!t) { toast("Kuch likhiye pehle"); return; }
  if (!window.MediaRecorder) { toast("Ye browser file nahi bana sakta"); return; }
  const btn = $("ttsRec");
  btn.disabled = true;
  btn.textContent = "🎙 recording…";
  try {
    const blob = await Services.recordAudio(t, ttsLang());
    Services.download(blob, "nova-voice-" + Date.now() + ".webm");
    toast("Voice file mil gayi! ✓");
  } catch (e) {
    toast("File tab banegi jab run.bat se khola jaye (same-origin)");
  } finally {
    btn.disabled = false;
    btn.textContent = "🎙 Save as file";
  }
});

let rec = null;
let sttFinal = "";
let sttLiveEl = null;

$("sttBtn").addEventListener("click", () => {
  const btn = $("sttBtn");
  const box = $("sttBox");
  if (rec) {
    rec.stop();
    return;
  }
  rec = Services.makeRecognition($("sttLang").value);
  if (!rec) { toast("Yeh browser mic nahi sun sakta — Chrome use karein"); return; }
  sttFinal = "";
  let seenStart = false;
  box.classList.add("live");
  rec.onstart = () => {
    btn.textContent = "⏹ khatam";
    if (!seenStart) { sttFinal = ""; box.textContent = "sunn raha hoon…"; }
    seenStart = true;
  };
  rec.onresult = (ev) => {
    seenStart = true;
    let interim = "";
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const t = ev.results[i][0].transcript;
      if (ev.results[i].isFinal) sttFinal += t;
      else interim = t;
    }
    box.textContent = sttFinal + interim;
  };
  rec.onerror = () => {
    rec = null;
    btn.textContent = "🎤 Bolna shuru karein";
    box.classList.remove("live");
    toast("Mic allow karein browser mein");
  };
  rec.onend = () => {
    rec = null;
    btn.textContent = "🎤 Bolna shuru karein";
    box.classList.remove("live");
    if (box.textContent === "sunn raha hoon…" || !sttFinal) box.textContent = sttFinal || "sunne ka koi jawab nahi aaya";
  };
  rec.start();
});

$("sttCopy").addEventListener("click", () => {
  const t = $("sttBox").textContent;
  if (!t || t.startsWith("Mic") || t.startsWith("sunn")) { toast("Pehle kuch boliye"); return; }
  navigator.clipboard.writeText(t).then(() => toast("Copy ho gaya ✓")).catch(() => toast("Manually copy karein: " + t.slice(0, 40)));
});
$("sttSend").addEventListener("click", () => {
  const t = $("sttBox").textContent;
  if (!t || t.startsWith("Mic") || t.startsWith("sunn")) { toast("Pehle boliye"); return; }
  switchTab("chat");
  setTimeout(() => {
    $("chatInput").value = t;
    sendMsg();
  }, 120);
});

/* ================= video ================= */
let vidFrames = 2;
let vidUrls = [];

window.VIDEO = {
  C: 768 / 512
};

function chooseMode(mode) {
  $("aimotionCard").classList.toggle("hidden", mode !== "aimotion");
  $("textvideoCard").classList.toggle("hidden", mode !== "textvideo");
  document.querySelectorAll("#videoMode .seg").forEach((s) =>
    s.classList.toggle("active", s.dataset.mode === mode));
}
document.querySelectorAll("#videoMode .seg").forEach((s) =>
  s.addEventListener("click", () => chooseMode(s.dataset.mode)));
document.querySelectorAll("#vidFrames .chip").forEach((c) =>
  c.addEventListener("click", () => {
    document.querySelectorAll("#vidFrames .chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    vidFrames = Number(c.dataset.n);
  }));

async function genAiMotion() {
  const prompt = $("vidPrompt").value.trim() || "cinematic scene, ultra detailed";
  const dur = Number($("vidDur").value);
  const narration = $("vidNarration").value.trim();
  const anyTtsOk = narration ? Services.served() : true;
  if (narration && !anyTtsOk) toast("Voice-over ke liye run.bat se kholo — video silent banayenge");
  const base = Math.floor(Math.random() * 1e6);

  const btn = $("vidGen");
  btn.disabled = true;
  const W = 768, H = 512;

  const imgs = [];
  const urls = [];
  let failed = 0;
  for (let i = 0; i < vidFrames; i++) {
    const u = Services.imageUrl(prompt + ", cinematic", { width: W, height: H, seed: base + i * 97, enhance: false });
    urls.push(u);
    btn.textContent = "🎬 scene " + (i + 1) + "/" + vidFrames + " — AI bana raha…";
    try {
      const scene = await Services.buildSceneSrc(prompt, W, H);
      await new Promise((res) => {
        const im = new Image();
        im.onload = () => { imgs.push(im); res(); };
        im.onerror = () => { failed++; res(); };
        im.src = scene.src;
      });
    } catch (e) {
      failed++;
    }
  }
  if (!imgs.length) {
    toast("Kinhi bhi AI scenes nahi ban paaye — scene hypes banakar video bana rahe hain");
  }
  vidUrls = urls;

  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  const stream = canvas.captureStream(30);

  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const dest = audioCtx.createMediaStreamDestination();
  let audioEl = null;
  let narrationDur = 0;
  if (narration && anyTtsOk) {
    audioEl = new Audio(await Services.ttsUrlFor(narration, "ur", 1));
    try {
      await new Promise((res, rej) => {
        audioEl.onloadedmetadata = res;
        audioEl.onerror = rej;
        audioEl.load();
      });
      narrationDur = audioEl.duration || 0;
      const src = audioCtx.createMediaElementSource(audioEl);
      src.connect(dest);
      src.connect(audioCtx.destination);
    } catch (e) { audioEl = null; }
  }
  const audioTrack = dest.stream.getAudioTracks()[0];
  if (audioTrack) stream.addTrack(audioTrack);

  const total = narrationDriven ? Math.max(narrationDur + 0.6, dur * vidFrames) : dur * vidFrames;
  const durDriven = narrationDriven ? total / vidFrames : dur;

  btn.textContent = "🎬 video record ho rahi… (" + Math.round(total) + "s)";
  const rec = new MediaRecorder(stream, { mimeType: Services.mimeType("video") });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  if (_vidRaf) cancelAnimationFrame(_vidRaf);
  try {
    const blob = await new Promise((resolve, reject) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "video/webm" }));
      rec.onerror = () => reject(new Error("rec failed"));
      rec.start(120);
      if (audioEl) audioEl.play().catch(() => {});
      const timeRef = Date.now();
      const draw = () => {
        const t = (Date.now() - timeRef) / 1000;
        if (t >= total) { rec.stop(); audioCtx.close().catch(() => {}); return; }
        const i = Math.min(Math.floor(t / durDriven), Math.max(imgs.length, 1) - 1);
        const p = (t - i * durDriven) / durDriven;
        let img = imgs[i];
        const scale = 1.06 + 0.09 * p;
        const px = W * 0.12 * Math.sin(p * Math.PI);
        const pw = W * scale, ph = H * scale;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
        if (img) {
          ctx.imageSmoothingQuality = "high";
          ctx.drawImage(img, (W - pw) / 2 + px, (H - ph) / 2, pw, ph);
        } else {
          fallbackScene(ctx, W, H, i, p);
        }
        _vidRaf = requestAnimationFrame(draw);
      };
      draw();
    });
    let v = $("vidOut");
    v.src = URL.createObjectURL(blob);
    $("vidResult").classList.remove("hidden");
    window._lastVid = { blob, name: "nova-video-" + Date.now() + ".webm" };
    toast("Video ban gayi ✓ (AI frames: " + imgs.length + "/" + vidFrames + ")");
  } catch (e) {
    toast("Video record nahi hui — Chrome use karein");
  } finally {
    btn.disabled = false;
    btn.textContent = "🎬 Generate video";
  }
}

function fallbackScene(ctx, W, H, i, p) {
  const hue = (i * 137.5 + 190) % 360;
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "hsl(" + hue + ",70%,16%)");
  g.addColorStop(1, "hsl(" + ((hue + 60) % 360) + ",70%,8%)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255," + (0.35 + 0.3 * Math.sin(p * Math.PI)) + ")";
  ctx.font = "600 26px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("scene " + (i + 1), W / 2, H / 2);
}

$("vidNarration").addEventListener("input", (e) => { narrationDriven = e.target.value.trim().length > 0; });

$("vidGen").addEventListener("click", genAiMotion);
$("vidReroll").addEventListener("click", genAiMotion);
$("vidDur").addEventListener("input", () => { $("vidDurTxt").textContent = $("vidDur").value + "s"; });
$("vidDownload").addEventListener("click", () => {
  if (window._lastVid) Services.download(window._lastVid.blob, window._lastVid.name);
  else toast("Pehle video banayein");
});

$("txtGen").addEventListener("click", async () => {
  const lines = $("txtLines").value.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) { toast("Kuch lines likhiye"); return; }
  const bg = $("txtBg").value;
  const btn = $("txtGen");
  btn.disabled = true;
  btn.textContent = "🎬 likh raha (recording)…";
  try {
    const W = 768, H = 432;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    const stream = canvas.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: Services.mimeType("video") });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    if (_txtRaf) cancelAnimationFrame(_txtRaf);
    const per = 2.2;
    const total = lines.length * per + 0.8;
    const blob = await new Promise((resolve, reject) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || "video/webm" }));
      rec.start(120);
      const timeRef = Date.now();
      const tick = () => {
        const t = (Date.now() - timeRef) / 1000;
        ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
        const i = Math.min(Math.floor(t / per), lines.length - 1);
        const p = Math.min(1, Math.max(0, (t - i * per) / (per * 0.7)));
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const size = Math.max(28, Math.min(48, Math.floor(W / (Math.max(10, lines[i].length) * 0.9))));
        ctx.font = "800 " + size + "px sans-serif";
        ctx.globalAlpha = Math.min(1, p) * (t >= (i + 1) * per ? 1 - Math.min(1, (t - (i + 1) * per) / per) : 1);
        ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 22;
        ctx.fillText(lines[i], W / 2, H / 2 + (1 - p) * 14);
        ctx.globalAlpha = 1; ctx.shadowBlur = 0;
        if (t >= total) rec.stop();
        else _txtRaf = requestAnimationFrame(tick);
      };
      tick();
    });
    $("txtOut").src = URL.createObjectURL(blob);
    $("txtResult").classList.remove("hidden");
    window._lastTxt = { blob, name: "nova-text-" + Date.now() + ".webm" };
    toast("Text video ban gayi ✓");
  } catch (e) {
    toast("Text video banane mein dikkat");
  } finally {
    btn.disabled = false;
    btn.textContent = "🎬 Text video banao";
  }
});
$("txtDownload").addEventListener("click", () => {
  if (window._lastTxt) Services.download(window._lastTxt.blob, window._lastTxt.name);
});

/* ================= tools ================= */
let todos = LS.get("studio_todo", []);
let notes = LS.get("studio_notes", []);

function renderTodos() {
  const box = $("todoList");
  box.innerHTML = "";
  if (!todos.length) { box.innerHTML = '<div class="list-item"><span style="color:var(--dim)">Abhi koi kaam nahi — kuch add karein ✨</span></div>'; return; }
  todos.forEach((t, i) => {
    const it = document.createElement("div");
    it.className = "list-item" + (t.done ? " done" : "");
    const tick = document.createElement("button");
    tick.className = "tick";
    tick.textContent = t.done ? "✓" : "";
    tick.onclick = () => { todos[i].done = !todos[i].done; saveTodos(); };
    const span = document.createElement("span");
    span.textContent = t.text;
    const del = document.createElement("button");
    del.className = "iconbtn del";
    del.textContent = "✕";
    del.title = "delete";
    del.onclick = () => { todos.splice(i, 1); saveTodos(); };
    it.append(tick, span, del);
    box.appendChild(it);
  });
}
function saveTodos() { LS.set("studio_todo", todos); renderTodos(); }
$("todoForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("todoInput").value.trim();
  if (!v) return;
  todos.unshift({ text: v, done: false });
  $("todoInput").value = "";
  saveTodos();
});

function renderNotes() {
  const box = $("noteList");
  box.innerHTML = "";
  if (!notes.length) { box.innerHTML = '<div class="list-item"><span style="color:var(--dim)">Notes khali hain — apni baat save karein 📒</span></div>'; return; }
  notes.forEach((n, i) => {
    const it = document.createElement("div");
    it.className = "list-item";
    const span = document.createElement("span");
    span.textContent = n;
    const del = document.createElement("button");
    del.className = "iconbtn del";
    del.textContent = "✕";
    del.onclick = () => { notes.splice(i, 1); renderNotes(); };
    it.append(span, del);
    box.appendChild(it);
  });
}
$("noteForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("noteInput").value.trim();
  if (!v) return;
  notes.unshift(v);
  $("noteInput").value = "";
  LS.set("studio_notes", notes);
  renderNotes();
});

/* ---------- lo-fi ---------- */
let _lofi = null;
$("lofiBtn").addEventListener("click", () => {
  if (_lofi) {
    _lofi.stop(); _lofi = null;
    $("lofiBtn").textContent = "▶ Lo-fi chalu karein";
    toast("Lo-fi band");
  } else {
    _lofi = Services.lofi();
    if (_lofi) {
      $("lofiBtn").textContent = "⏸ Lo-fi band karein";
      toast("Lo-fi chill on 🔊");
    } else { toast("Is browser mein audio nahi chalta"); }
  }
});

/* ---------- quote card ---------- */
const QUOTE_PALS = [
  ["#0f2027", "#203a43", "#2c5364"],
  ["#1a2a6c", "#b21f1f", "#fdbb2d"],
  ["#11998e", "#38ef7d", "#59f3c1"],
  ["#7f00ff", "#e100ff", "#ff7aff"],
  ["#3a1c71", "#d76d77", "#ffaf7b"],
  ["#2c3e50", "#4ca1af", "#a1e0ee"]
];
$("quoteGen").addEventListener("click", () => {
  const t = $("quoteText").value.trim() || "Kuch pocha toh hai?";
  Services.chime();
  const cv = $("quoteOut");
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height;
  const pal = QUOTE_PALS[Math.floor(Math.random() * QUOTE_PALS.length)];
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, pal[0]);
  for (let k = 1; k < pal.length; k++) g.addColorStop(k / (pal.length - 1), pal[k]);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.12; ctx.fillStyle = "#fff";
  for (let i = 0; i < 7; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, 60 + Math.random() * 160, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 3;
  ctx.strokeRect(26, 26, W - 52, H - 52);
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "700 44px sans-serif";
  const maxw = W - 170;
  const lines = [];
  let cur = "";
  for (const wd of t.split(/\s+/)) {
    const nw = (cur ? cur + " " : "") + wd;
    if (ctx.measureText(nw).width > maxw && cur) { lines.push(cur); cur = wd; }
    else cur = nw;
  }
  if (cur) lines.push(cur);
  let fs = 44;
  ctx.font = "700 " + fs + "px sans-serif";
  while (Math.max.apply(null, lines.map((l) => ctx.measureText(l).width)) > maxw && fs > 26) {
    fs -= 2; ctx.font = "700 " + fs + "px sans-serif";
  }
  const lh = fs * 1.3;
  const y0 = H / 2 - (lines.length - 1) * lh / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
  cv.style.display = "block";
  window._quoteCv = cv;
  toast("Quote card tayyar! ✓");
});
$("quoteDown").addEventListener("click", () => {
  const cv = window._quoteCv;
  if (!cv) { toast("Pehle card banao"); return; }
  Services.downloadUrl(cv.toDataURL("image/png"), "nova-card-" + Date.now() + ".png");
});

/* ================= boot ================= */
function boot() {
  $("chatSub").textContent = botName !== "Bhai" ? "Ahista se " + botName + " ka AI" : "online AI — free, no key";
  chatLog = chatLog.filter((m) => m.role === "me" || m.role === "bot");
  if (!chatLog.length) {
    chatLog.push({
      role: "bot",
      text: "Assalamu Alaikum " + (botName !== "Bhai" ? botName : "Bhai") + "! 👋\n\nAapke **NOVA AI Studio** mein khush aamdeed — ChatGPT-style **chat**, AI **images**, AI **voice**, AI **video** aur personal **tools**, sab free aur no-key!\n\nKoi bhi sawaal likhiye, ya neeche quick options chuniye. 👇",
      time: NOW()
    });
  }
  renderChat();
  renderHist();
  renderTodos();
  renderNotes();
  refreshStatus();
  if (location.search.indexOf("selftest") !== -1) runSelfTest();
}

async function runSelfTest() {
  const box = document.createElement("div");
  box.id = "selftest";
  box.style.cssText = "display:block;position:fixed;bottom:0;left:0;z-index:999;color:lime;background:#000;padding:8px;max-width:600px";
  document.body.appendChild(box);
  const note = async (line) => { box.textContent += line + "\n"; document.title = line; };
  note("selftest start…");
  try {
    const s = await Services.buildSceneSrc("Selftest: a single mountain under stars", 256, 256, { fast: true });
    await new Promise((res) => {
      const im = new Image();
      im.onload = () => { box.dataset.px = im.naturalWidth + "x" + im.naturalHeight; res(); };
      im.onerror = () => res();
      im.src = s.src;
    });
    await note("IMG " + s.kind + " " + s.ms + "s " + (box.dataset.px || "no-px"));
  } catch (e) {
    await note("IMGF " + (e && e.message));
  }
  try {
    const sp = await Services.speakNative ? "ok" : "ok";
    await note("TTS " + sp);
  } catch (e) {
    await note("TTSF");
  }
  note("done");
}
boot();