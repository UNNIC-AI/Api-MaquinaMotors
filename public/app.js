"use strict";

// ============ Estado ============
const KEY_STORAGE = "mm_api_key";
let apiKey = sessionStorage.getItem(KEY_STORAGE) || null;
let currentPhone = null;
const LIST_LIMIT = 200;

// ============ Helpers DOM ============
function $(sel) { return document.querySelector(sel); }
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function show(node) { node.hidden = false; }
function hide(node) { node.hidden = true; }

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 3500);
}

// ============ Formato ============
function formatPhone(p) {
  if (!p) return "Desconocido";
  const d = String(p).replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("34")) return `+34 ${d.slice(2)}`;
  return "+" + d;
}
function avatarText(name, phone) {
  if (name) {
    const w = name.trim().split(/\s+/);
    return (w.length >= 2 ? w[0][0] + w[1][0] : name.trim().slice(0, 2)).toUpperCase();
  }
  const d = String(phone || "").replace(/\D/g, "");
  return d ? d.slice(-2) : "?";
}
const AVATAR_COLORS = ["#c94b5a", "#4b7bc9", "#4bac8f", "#c99a4b", "#8f5ac9", "#4b94c9", "#c96b4b"];
function avatarColor(p) {
  const d = String(p || "");
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (h * 31 + d.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function makeAvatar(phone, name) {
  const a = el("div", "avatar", avatarText(name, phone));
  a.style.background = avatarColor(phone);
  return a;
}
function relativeTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  if (s < 172800) return "ayer";
  if (s < 604800) return `hace ${Math.floor(s / 86400)} d`;
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
}
function timeOfDay(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
function dayLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  if (diff === 0) return "Hoy";
  if (diff === 1) return "Ayer";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" });
}

// ============ API ============
async function api(path, opts = {}) {
  const res = await fetch(path, {
    cache: "no-store",
    ...opts,
    headers: {
      "x-api-key": apiKey,
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(opts.headers || {}),
    },
  });
  if (res.status === 401) {
    logout();
    throw new Error("Sesión no válida. Vuelve a introducir la API key.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.message || data.error || `Error ${res.status}`);
  }
  return data;
}
function dayStart(v) { return v ? `${v}T00:00:00` : ""; }
function dayEnd(v) { return v ? `${v}T23:59:59` : ""; }

// Formatea Date -> "YYYY-MM-DD" (para los <input type=date>)
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Rango por defecto: de hace 7 días a hoy
function setDefaultDates() {
  const now = new Date();
  const week = new Date();
  week.setDate(now.getDate() - 7);
  $("#f-from").value = ymd(week);
  $("#f-to").value = ymd(now);
}

// ============ Login ============
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#login-btn");
  const err = $("#login-error");
  hide(err);
  const val = $("#login-key").value.trim();
  if (!val) return;
  btn.disabled = true;
  btn.textContent = "Comprobando…";
  try {
    const res = await fetch("/api/validate", { cache: "no-store", headers: { "x-api-key": val } });
    if (!res.ok) throw new Error("La API key no es válida");
    apiKey = val;
    sessionStorage.setItem(KEY_STORAGE, val);
    enterApp();
  } catch (ex) {
    err.textContent = ex.message;
    show(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
});

function logout() {
  apiKey = null;
  sessionStorage.removeItem(KEY_STORAGE);
  currentPhone = null;
  hide($("#app"));
  show($("#login-screen"));
  $("#login-key").value = "";
}
$("#logout-btn").addEventListener("click", logout);

function enterApp() {
  hide($("#login-screen"));
  show($("#app"));
  setDefaultDates();
  loadSessions();
}

// ============ Navegación entre menús ============
document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    $("#view-conversaciones").hidden = view !== "conversaciones";
    $("#view-resumenes").hidden = view !== "resumenes";
    if (view === "resumenes") loadSavedAnalyses();
  });
});

// ============ Lista de conversaciones ============
async function loadSessions() {
  const params = new URLSearchParams();
  params.set("limit", LIST_LIMIT);
  const q = $("#f-q").value.trim();
  const from = dayStart($("#f-from").value);
  const to = dayEnd($("#f-to").value);
  if (q) params.set("q", q);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const list = $("#list");
  list.innerHTML = "";
  list.appendChild(loadingState());

  try {
    const data = await api(`/api/conversaciones?${params}`);
    list.innerHTML = "";
    $("#list-count").textContent =
      `${data.total} ${data.total === 1 ? "conversación" : "conversaciones"}`;
    if (!data.data.length) {
      list.appendChild(emptyState("Sin resultados con estos filtros"));
      return;
    }
    for (const s of data.data) list.appendChild(sessionCard(s));
  } catch (ex) {
    list.innerHTML = "";
    list.appendChild(emptyState(ex.message));
    toast(ex.message);
  }
}

function sessionCard(s) {
  const card = el("div", "session");
  card.dataset.phone = s.phone || "";
  card.appendChild(makeAvatar(s.phone));

  const body = el("div", "session-body");
  const top = el("div", "session-top");
  top.appendChild(el("span", "session-phone", formatPhone(s.phone)));
  top.appendChild(el("span", "session-time", relativeTime(s.last_message_at)));
  body.appendChild(top);
  if (s.preview) body.appendChild(el("div", "session-preview", s.preview));
  body.appendChild(el("span", "session-badge", `${s.message_count} mensaje${s.message_count === 1 ? "" : "s"}`));
  card.appendChild(body);

  card.addEventListener("click", () => {
    document.querySelectorAll(".session.active").forEach((n) => n.classList.remove("active"));
    card.classList.add("active");
    openDetail(s.phone);
  });
  return card;
}

$("#search-btn").addEventListener("click", loadSessions);
$("#refresh-btn").addEventListener("click", loadSessions);
$("#f-q").addEventListener("keydown", (e) => { if (e.key === "Enter") loadSessions(); });
$("#clear-btn").addEventListener("click", () => {
  $("#f-q").value = "";
  setDefaultDates();
  loadSessions();
});

// ============ Detalle de conversación ============
async function openDetail(phone) {
  currentPhone = phone;
  $("#view-conversaciones").classList.add("detail-open");
  hide($("#detail-empty"));
  show($("#detail"));
  hide($("#summary-box"));

  const av = $("#detail-avatar");
  av.textContent = avatarText(null, phone);
  av.style.background = avatarColor(phone);
  $("#detail-phone").textContent = formatPhone(phone);
  $("#detail-meta").textContent = "";

  const box = $("#messages");
  box.innerHTML = "";
  box.appendChild(loadingState());

  const params = new URLSearchParams();
  const from = dayStart($("#f-from").value);
  const to = dayEnd($("#f-to").value);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  try {
    const data = await api(`/api/conversaciones/${encodeURIComponent(phone)}?${params}`);
    box.innerHTML = "";
    $("#detail-meta").textContent = `${data.message_count} mensajes`;
    if (!data.messages.length) {
      box.appendChild(emptyState("Sin mensajes"));
      return;
    }
    let lastDay = null;
    for (const m of data.messages) {
      const d = dayLabel(m.timestamp);
      if (d && d !== lastDay) {
        const sep = el("div", "day-sep");
        sep.appendChild(el("span", null, d));
        box.appendChild(sep);
        lastDay = d;
      }
      box.appendChild(messageBubble(m));
    }
    box.scrollTop = 0;
  } catch (ex) {
    box.innerHTML = "";
    box.appendChild(emptyState(ex.message));
    toast(ex.message);
  }
}

function messageBubble(m) {
  const isUser = m.role === "user";
  const wrap = el("div", `msg ${isUser ? "msg-user" : "msg-assistant"}`);
  wrap.appendChild(el("div", "msg-role", isUser ? "Cliente" : m.role === "assistant" ? "Agente" : m.role));
  const text = typeof m.message === "string" ? m.message : JSON.stringify(m.message);
  const body = el("div", "msg-text", text);
  if (text === "[mensaje no descifrable]") body.classList.add("msg-undecrypt");
  wrap.appendChild(body);
  wrap.appendChild(el("div", "msg-time", timeOfDay(m.timestamp)));
  return wrap;
}

$("#detail-back").addEventListener("click", () => {
  $("#view-conversaciones").classList.remove("detail-open");
});

// ============ Resumen IA ============
$("#summary-btn").addEventListener("click", async () => {
  if (!currentPhone) return;
  const btn = $("#summary-btn");
  const box = $("#summary-box");
  btn.disabled = true;
  btn.textContent = "Generando…";
  show(box);
  box.innerHTML = "";
  box.appendChild(loadingState());

  const body = {};
  const from = dayStart($("#f-from").value);
  const to = dayEnd($("#f-to").value);
  if (from) body.from = from;
  if (to) body.to = to;

  try {
    const data = await api(`/api/conversaciones/${encodeURIComponent(currentPhone)}/resumen`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    box.innerHTML = "";
    const title = el("div", "summary-title");
    title.appendChild(el("span", null, "Resumen IA"));
    const copy = el("button", "summary-copy", "Copiar");
    copy.addEventListener("click", () => {
      navigator.clipboard?.writeText(data.resumen).then(
        () => { copy.textContent = "Copiado ✓"; setTimeout(() => (copy.textContent = "Copiar"), 1500); },
        () => toast("No se pudo copiar")
      );
    });
    title.appendChild(copy);
    box.appendChild(title);
    box.appendChild(el("div", "summary-text", data.resumen));
  } catch (ex) {
    box.innerHTML = "";
    box.appendChild(el("div", "summary-text", "No se pudo generar el resumen: " + ex.message));
    toast(ex.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Resumen IA";
  }
});

// ============ Estados visuales ============
function loadingState() {
  const s = el("div", "state");
  s.appendChild(el("div", "spinner"));
  s.appendChild(document.createTextNode("Cargando…"));
  return s;
}
function emptyState(msg) {
  return el("div", "state", msg);
}

// ============ Resúmenes semanales ============
let weekOffset = 0; // 0 = semana actual, -1 = anterior…

function weekRange(offset) {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // 0 = lunes
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { monday, sunday };
}
function fmtRange(a, b) {
  const opt = { day: "numeric", month: "short" };
  const ya = a.getFullYear(), yb = b.getFullYear();
  return `${a.toLocaleDateString("es-ES", opt)} – ${b.toLocaleDateString("es-ES", opt)} ${yb}${ya !== yb ? "" : ""}`;
}
function updateWeekLabel() {
  const { monday, sunday } = weekRange(weekOffset);
  $("#week-label").textContent = fmtRange(monday, sunday);
  $("#week-next").disabled = weekOffset >= 0;
}
function statCard(num, label) {
  const c = el("div", "stat-card");
  c.appendChild(el("div", "stat-num", String(num)));
  c.appendChild(el("div", "stat-label", label));
  return c;
}
function currentWeekParams() {
  const { monday, sunday } = weekRange(weekOffset);
  return { from: `${ymd(monday)}T00:00:00`, to: `${ymd(sunday)}T23:59:59` };
}
function emptyPrompt(msg) {
  const d = el("div", "placeholder");
  const mark = el("div", "detail-empty-mark", "MM");
  const p = el("p");
  p.innerHTML = msg || 'No hay análisis de esta semana. Pulsa <strong>Generar análisis</strong>.';
  d.appendChild(mark);
  d.appendChild(p);
  return d;
}

let savedAnalyses = [];
let selectedAnalysisId = null;

function renderStats(s) {
  const stats = $("#week-stats");
  stats.innerHTML = "";
  if (!s) return;
  stats.appendChild(statCard(s.conversaciones ?? 0, "Conversaciones"));
  stats.appendChild(statCard(s.mensajes ?? 0, "Mensajes"));
  stats.appendChild(statCard(s.mensajes_cliente ?? 0, "Del cliente"));
  stats.appendChild(statCard(s.mensajes_agente ?? 0, "Del agente"));
}

function renderHistory() {
  const history = $("#week-history");
  history.innerHTML = "";
  if (!savedAnalyses.length) return;
  history.appendChild(el("div", "history-label", `Análisis guardados (${savedAnalyses.length})`));
  const chips = el("div", "history-chips");
  savedAnalyses.forEach((a) => {
    const chip = el("div", "chip" + (a.id === selectedAnalysisId ? " active" : ""));
    const t = new Date(a.created_at);
    chip.appendChild(el("span", "chip-label", t.toLocaleString("es-ES", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    })));
    const del = el("button", "chip-del", "×");
    del.title = "Borrar este análisis";
    del.addEventListener("click", (e) => { e.stopPropagation(); deleteAnalysis(a.id); });
    chip.appendChild(del);
    chip.addEventListener("click", () => selectAnalysis(a.id));
    chips.appendChild(chip);
  });
  history.appendChild(chips);
}

function selectAnalysis(id) {
  selectedAnalysisId = id;
  const a = savedAnalyses.find((x) => x.id === id);
  renderHistory();
  renderStats(a ? a.stats : null);
  const summary = $("#week-summary");
  summary.innerHTML = "";
  if (!a) { summary.appendChild(emptyPrompt()); return; }
  const wrap = el("div", "summary-box");
  const title = el("div", "summary-title");
  title.appendChild(el("span", null, "Análisis de la semana"));
  const copy = el("button", "summary-copy", "Copiar");
  copy.addEventListener("click", () => {
    navigator.clipboard?.writeText(a.resumen).then(
      () => { copy.textContent = "Copiado ✓"; setTimeout(() => (copy.textContent = "Copiar"), 1500); },
      () => toast("No se pudo copiar")
    );
  });
  title.appendChild(copy);
  wrap.appendChild(title);
  const body = el("div", "summary-text");
  renderResumenText(body, a.resumen);
  wrap.appendChild(body);
  summary.appendChild(wrap);
}

// ¿La línea parece un título de apartado? (toda en mayúsculas y corta)
function isHeading(line) {
  const t = line.trim();
  if (t.length < 3 || t.length > 60) return false;
  if (!/[A-ZÁÉÍÓÚÜÑ]/.test(t)) return false;
  return t === t.toUpperCase();
}
// Renderiza el informe: títulos destacados + párrafos
function renderResumenText(container, text) {
  container.innerHTML = "";
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (isHeading(line)) container.appendChild(el("div", "summary-h", line));
    else container.appendChild(el("p", "summary-p", line));
  }
}

async function loadSavedAnalyses() {
  const { from, to } = currentWeekParams();
  const summary = $("#week-summary");
  $("#week-history").innerHTML = "";
  $("#week-stats").innerHTML = "";
  summary.innerHTML = "";
  summary.appendChild(loadingState());
  try {
    const params = new URLSearchParams({ from, to });
    const data = await api(`/api/resumenes-semanales?${params}`);
    savedAnalyses = data.data || [];
    if (savedAnalyses.length) {
      selectAnalysis(savedAnalyses[0].id);
    } else {
      renderHistory();
      summary.innerHTML = "";
      summary.appendChild(emptyPrompt());
    }
  } catch (ex) {
    summary.innerHTML = "";
    summary.appendChild(emptyState(ex.message));
    toast(ex.message);
  }
}

async function deleteAnalysis(id) {
  try {
    await api(`/api/resumenes-semanales/${id}`, { method: "DELETE" });
    savedAnalyses = savedAnalyses.filter((a) => a.id !== id);
    if (selectedAnalysisId === id) selectedAnalysisId = savedAnalyses[0] ? savedAnalyses[0].id : null;
    if (selectedAnalysisId) {
      selectAnalysis(selectedAnalysisId);
    } else {
      renderHistory();
      renderStats(null);
      $("#week-summary").innerHTML = "";
      $("#week-summary").appendChild(emptyPrompt());
    }
    toast("Análisis borrado");
  } catch (ex) {
    toast(ex.message);
  }
}

$("#week-prev").addEventListener("click", () => { weekOffset -= 1; updateWeekLabel(); loadSavedAnalyses(); });
$("#week-next").addEventListener("click", () => { if (weekOffset < 0) { weekOffset += 1; updateWeekLabel(); loadSavedAnalyses(); } });

$("#week-gen").addEventListener("click", async () => {
  const btn = $("#week-gen");
  const summary = $("#week-summary");
  btn.disabled = true;
  btn.textContent = "Generando…";
  $("#week-stats").innerHTML = "";
  summary.innerHTML = "";
  summary.appendChild(loadingState());
  try {
    const { from, to } = currentWeekParams();
    const data = await api(`/api/resumenes-semanales`, {
      method: "POST",
      body: JSON.stringify({ from, to }),
    });
    savedAnalyses.unshift(data);
    selectAnalysis(data.id);
    if (data.truncado) toast("Semana con mucho volumen: análisis sobre una muestra de los mensajes.");
  } catch (ex) {
    summary.innerHTML = "";
    summary.appendChild(emptyState(ex.message));
    toast(ex.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Generar análisis";
  }
});

updateWeekLabel();

// ============ Arranque ============
if (apiKey) enterApp(); else show($("#login-screen"));
