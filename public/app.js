"use strict";

// ============ Estado ============
const KEY_STORAGE = "mm_api_key";
let apiKey = sessionStorage.getItem(KEY_STORAGE) || null;
let currentPhone = null;
const LIST_LIMIT = 100;

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
  if (d.length === 11 && d.startsWith("34")) {
    const n = d.slice(2);
    return `+34 ${n.slice(0, 3)} ${n.slice(3, 5)} ${n.slice(5, 7)} ${n.slice(7)}`;
  }
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
// Inicio y fin del día en la hora local del navegador, enviados con zona horaria
// (toISOString) para que "el día 22" sea el 22 de aquí y no el de Londres.
function dayStart(v) { return v ? new Date(`${v}T00:00:00`).toISOString() : ""; }
function dayEnd(v) { return v ? new Date(`${v}T23:59:59.999`).toISOString() : ""; }

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
    let res;
    try {
      res = await fetch("/api/validate", { cache: "no-store", headers: { "x-api-key": val } });
    } catch {
      throw new Error("No se ha podido conectar con el servidor. Revisa la conexión o la VPN.");
    }
    if (res.status === 401) throw new Error("La API key no es válida");
    if (res.status === 429) throw new Error("Demasiados intentos. Espera un minuto y vuelve a probar.");
    if (!res.ok) throw new Error(`El servidor ha respondido con un error (${res.status}). Inténtalo de nuevo en un momento.`);
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
// Cada búsqueda nueva invalida las respuestas de las anteriores que aún no
// hayan llegado, para que no se mezclen resultados de filtros distintos.
let listSeq = 0;
let listLoaded = 0;

async function loadSessions({ more = false } = {}) {
  const seq = more ? listSeq : ++listSeq;
  const params = new URLSearchParams();
  params.set("limit", LIST_LIMIT);
  params.set("offset", more ? listLoaded : 0);
  const q = $("#f-q").value.trim();
  const from = dayStart($("#f-from").value);
  const to = dayEnd($("#f-to").value);
  if (q) params.set("q", q);
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const list = $("#list");
  $("#list-more")?.remove();
  if (!more) {
    listLoaded = 0;
    list.innerHTML = "";
  }
  const loading = loadingState();
  list.appendChild(loading);

  try {
    const data = await api(`/api/conversaciones?${params}`);
    if (seq !== listSeq) return;
    loading.remove();
    $("#list-count").textContent =
      `${data.total} ${data.total === 1 ? "conversación" : "conversaciones"}`;
    if (!more && !data.data.length) {
      list.appendChild(emptyState(
        $("#f-from").value || $("#f-to").value
          ? "Sin resultados en estas fechas. Prueba a ampliarlas o pulsa Limpiar."
          : "Sin resultados"
      ));
      return;
    }
    for (const s of data.data) list.appendChild(sessionCard(s));
    listLoaded += data.data.length;
    if (listLoaded < data.total) {
      const btn = el("button", "btn-ghost list-more", `Cargar más (${data.total - listLoaded} restantes)`);
      btn.id = "list-more";
      btn.addEventListener("click", () => loadSessions({ more: true }));
      list.appendChild(btn);
    }
  } catch (ex) {
    if (seq !== listSeq) return;
    loading.remove();
    if (!more) list.innerHTML = "";
    list.appendChild(emptyState(ex.message));
    toast(ex.message);
  }
}

function sessionCard(s) {
  const card = el("div", "session");
  card.dataset.phone = s.phone || "";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `Conversación con ${formatPhone(s.phone)}`);
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); }
  });
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

$("#search-btn").addEventListener("click", () => loadSessions());
$("#refresh-btn").addEventListener("click", () => loadSessions());
$("#f-q").addEventListener("keydown", (e) => { if (e.key === "Enter") loadSessions(); });
// Limpiar quita la búsqueda y las fechas: se ve todo el historial.
$("#clear-btn").addEventListener("click", () => {
  $("#f-q").value = "";
  $("#f-from").value = "";
  $("#f-to").value = "";
  loadSessions();
});

// ============ Detalle de conversación ============
// Si se abre otra conversación mientras carga la anterior (o su resumen), la
// respuesta que llegue tarde se descarta para no mezclar conversaciones.
let detailSeq = 0;

async function openDetail(phone) {
  const seq = ++detailSeq;
  currentPhone = phone;
  $("#view-conversaciones").classList.add("detail-open");
  hide($("#detail-empty"));
  show($("#detail"));
  hide($("#summary-box"));
  const summaryBtn = $("#summary-btn");
  summaryBtn.disabled = false;
  summaryBtn.textContent = "Resumen IA";

  const av = $("#detail-avatar");
  av.textContent = avatarText(null, phone);
  av.style.background = avatarColor(phone);
  $("#detail-phone").textContent = formatPhone(phone);
  $("#detail-meta").textContent = "";

  const box = $("#messages");
  box.innerHTML = "";
  box.appendChild(loadingState());

  // La conversación se muestra entera: las fechas del filtro sirven para
  // encontrarla en la lista, no para recortarla.
  try {
    const data = await api(`/api/conversaciones/${encodeURIComponent(phone)}`);
    if (seq !== detailSeq) return;
    box.innerHTML = "";
    $("#detail-meta").textContent = `${data.message_count} mensaje${data.message_count === 1 ? "" : "s"}`;
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
    if (seq !== detailSeq) return;
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
  const seq = detailSeq;
  const btn = $("#summary-btn");
  const box = $("#summary-box");
  btn.disabled = true;
  btn.textContent = "Generando…";
  show(box);
  box.innerHTML = "";
  box.appendChild(loadingState());

  // Resume los últimos 100 mensajes de la conversación entera, igual que el detalle.
  try {
    const data = await api(`/api/conversaciones/${encodeURIComponent(currentPhone)}/resumen`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (seq !== detailSeq) return;
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
    if (seq !== detailSeq) return;
    box.innerHTML = "";
    box.appendChild(el("div", "summary-text", "No se pudo generar el resumen: " + ex.message));
    toast(ex.message);
  } finally {
    if (seq === detailSeq) {
      btn.disabled = false;
      btn.textContent = "Resumen IA";
    }
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
  // Si la semana cruza de año (29 dic – 4 ene) se pone el año en los dos extremos
  const inicio = a.toLocaleDateString("es-ES", opt) + (ya !== yb ? ` ${ya}` : "");
  return `${inicio} – ${b.toLocaleDateString("es-ES", opt)} ${yb}`;
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
  return { from: dayStart(ymd(monday)), to: dayEnd(ymd(sunday)) };
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

// Al cambiar de semana rápido, solo cuenta la respuesta de la última pedida.
let weekSeq = 0;

async function loadSavedAnalyses() {
  const seq = ++weekSeq;
  const { from, to } = currentWeekParams();
  const summary = $("#week-summary");
  $("#week-history").innerHTML = "";
  $("#week-stats").innerHTML = "";
  summary.innerHTML = "";
  summary.appendChild(loadingState());
  try {
    const params = new URLSearchParams({ from, to });
    const data = await api(`/api/resumenes-semanales?${params}`);
    if (seq !== weekSeq) return;
    savedAnalyses = data.data || [];
    if (savedAnalyses.length) {
      selectAnalysis(savedAnalyses[0].id);
    } else {
      renderHistory();
      summary.innerHTML = "";
      summary.appendChild(emptyPrompt());
    }
  } catch (ex) {
    if (seq !== weekSeq) return;
    summary.innerHTML = "";
    summary.appendChild(emptyState(ex.message));
    toast(ex.message);
  }
}

async function deleteAnalysis(id) {
  if (!confirm("¿Borrar este análisis? No se puede deshacer.")) return;
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
  const seq = ++weekSeq;
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
    // Si mientras tanto se ha cambiado de semana, el análisis queda guardado
    // pero no se pinta encima de la otra semana.
    if (seq !== weekSeq) { toast("Análisis guardado en su semana."); return; }
    savedAnalyses.unshift(data);
    selectAnalysis(data.id);
    if (data.truncado) toast("Semana con mucho volumen: análisis sobre una muestra de los mensajes.");
  } catch (ex) {
    if (seq !== weekSeq) return;
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
