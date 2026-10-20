// ============================================
// MERCADO LIMPIO - PWA v4
// Navegación de meses · Overlay NC · iPhone 14 Pro
// ============================================

const BASE = (window.ML_CONFIG && window.ML_CONFIG.BASE) || "https://api-mercadolimpio.onrender.com";

// Ícono SVG del sprite de index.html
const ico = (name, cls = "") => `<svg class="ic ${cls}"><use href="#i-${name}"/></svg>`;
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Objeto JSON seguro para un atributo onclick='…'
const attrJson = (o) => JSON.stringify(o).replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
const letraDeComprobante = (comp) => {
  const s = String(comp || "").toUpperCase();
  if (s.startsWith("NC-")) return "NC";
  return (s.match(/^(?:FA-)?([ABM])-/) || [])[1] || "";
};

let itemsGlobal = [];
let domicilioRemitoGlobal = "";
let subtotalBrutoGlobal = 0;
let descuentoPctGlobal = 0;
let descuentoImporteGlobal = 0;
let totalFinalGlobal = 0;
let previewTimer = null;
let parteActual = 1;
let totalPartes = 1;
let serverAwake = false;
let facturaAAnular = null;

// Estado del mes seleccionado en el panel resumen
let resumenAnio = new Date().getFullYear();
let resumenMes  = new Date().getMonth() + 1; // 1-12

// ============================================
// DESPERTADOR SILENCIOSO
// ============================================
setTimeout(() => {
  ['https://api-mercadolimpio.onrender.com/health', 'https://afip-worker.onrender.com/health']
    .forEach(url => fetch(url, { method: 'GET', mode: 'no-cors' }).catch(() => {}));
  fetch('https://gjeyvbidomxzofcdycya.supabase.co/rest/v1/', { method: 'HEAD', mode: 'no-cors' }).catch(() => {});
}, 50);

// ============================================
// BASE DE DATOS EMAIL ↔ CUIT (localStorage)
// ============================================
function getEmailDB() {
  try { return JSON.parse(localStorage.getItem("ml_emails_cuit") || "{}"); } catch { return {}; }
}
function saveEmailCuit(cuit, email) {
  if (!cuit || String(cuit).length !== 11 || !email || !String(email).includes("@")) return;
  const db = getEmailDB();
  if (db[cuit] === email) return;
  db[cuit] = email;
  try { localStorage.setItem("ml_emails_cuit", JSON.stringify(db)); } catch {}
}
function getEmailForCuit(cuit) {
  if (!cuit || String(cuit).length !== 11) return "";
  return getEmailDB()[cuit] || "";
}
function autoFillEmailSiVacio(cuit) {
  const emailInput = document.getElementById("email");
  if (!emailInput || emailInput.value.trim()) return;
  const saved = getEmailForCuit(cuit);
  if (saved) {
    emailInput.value = saved;
    showToast(`📧 Email cargado automáticamente`, "success");
  }
}

// Pre-poblar DB de emails desde el historial ya guardado en este dispositivo
(function seedEmailDBFromHistory() {
  try {
    const hist = JSON.parse(localStorage.getItem("ml_historial") || "{}");
    for (const mes of Object.values(hist)) {
      if (!Array.isArray(mes)) continue;
      for (const f of mes) {
        const emailTo = f.emailTo || f.email_to || "";
        if (f.cuit && emailTo) saveEmailCuit(f.cuit, emailTo);
      }
    }
  } catch {}
})();

// ============================================
// UTILIDADES
// ============================================
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

const formatMoneyAR = (n) => {
  try { return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0)); }
  catch { return String(n); }
};

const parseMontoInput = () => {
  const s = String(montoInput.value).trim().replace(/\./g, "").replace(",", ".");
  const m = Number(s);
  return (Number.isFinite(m) && m > 0) ? round2(m) : 0;
};

const haptic = (type = "light") => {
  if (!navigator.vibrate) return;
  if (type === "light")   navigator.vibrate(15);
  if (type === "success") navigator.vibrate([30, 50, 30]);
  if (type === "error")   navigator.vibrate([50, 50, 50]);
};

const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function getMesKey(anio, mes) {
  const a = anio ?? new Date().getFullYear();
  const m = mes  ?? (new Date().getMonth() + 1);
  return `${a}-${String(m).padStart(2, "0")}`;
}

function extraerPVDesdeComprobante(comp) {
  const match = String(comp || "").match(/-(\d{5})-(\d{8})$/);
  return match ? Number(match[1]) : 0;
}
function extraerNroDesdeComprobante(comp) {
  const match = String(comp || "").match(/-(\d{5})-(\d{8})$/);
  return match ? Number(match[2]) : 0;
}

// ============================================
// TOAST
// ============================================
function showToast(msg, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  // Los mensajes traen emojis históricos al inicio: se reemplazan por un ícono uniforme
  const limpio = String(msg).replace(/^[\p{Extended_Pictographic}️‍⚠️✅❌⏳⏱🔄\s]+/u, "");
  t.innerHTML = ico(type === "error" ? "alert" : "check-circle") + `<span>${escHtml(limpio)}</span>`;
  container.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 4000);
  type === "error" ? haptic("error") : haptic("light");
}

// ============================================
// NC LOADING OVERLAY
// ============================================
function showNcLoading(text, sub) {
  document.getElementById("ncLoadingText").textContent    = text || "Emitiendo Nota de Crédito...";
  document.getElementById("ncLoadingSubtext").textContent = sub  || "Comunicando con ARCA · no cierres la app";
  document.getElementById("ncLoadingOverlay").classList.add("active");
}
function hideNcLoading() {
  document.getElementById("ncLoadingOverlay").classList.remove("active");
}

// ============================================
// FETCH CON RETRY
// ============================================
async function fetchWithRetry(url, options = {}, { maxRetries = 3, timeoutMs = 90000, onRetry } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const r     = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      return r;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        if (onRetry) onRetry(attempt);
        await new Promise(res => setTimeout(res, attempt * 4000));
      }
    }
  }
  throw lastErr;
}

// ============================================
// KEEP-ALIVE
// ============================================
function setServerStatus(estado) {
  const txt = { online: ["Servidor activo", "Sistema ARCA conectado"], offline: ["Sin conexión", "El servidor no responde"], waking: ["Conectando…", "Despertando el servidor"] }[estado];
  document.querySelectorAll("[data-status-dot]").forEach(d => { d.className = `status-dot ${estado}`; });
  document.querySelectorAll("[data-status-label]").forEach(l => { l.textContent = txt[0]; });
  document.querySelectorAll("[data-status-sub]").forEach(l => { l.textContent = txt[1]; });
}
async function pingServer() {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      serverAwake = true;
      setServerStatus("online");
    } else throw new Error();
  } catch {
    serverAwake = false;
    setServerStatus("offline");
  }
}
pingServer();
setInterval(pingServer, 9 * 60 * 1000);

// Despierta el servidor (Render free se duerme a los 15 min) ANTES de subir un
// archivo. Si se sube con el server frío, el arranque supera el timeout, la
// conexión se corta a mitad del multipart y el backend tira "Unexpected end of
// form". Esto reintenta /health hasta ~75s antes de dar por muerto el intento.
async function wakeServer(onWait) {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(5000) });
    if (r.ok) { serverAwake = true; return true; }
  } catch {}
  if (onWait) onWait();
  for (let i = 0; i < 14; i++) {
    await new Promise(res => setTimeout(res, 5000));
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) { serverAwake = true; pingServer(); return true; }
    } catch {}
  }
  return false;
}

// ============================================
// REFERENCIAS AL DOM
// ============================================
const fileInput      = document.getElementById("fileRemito");
const cuitInput      = document.getElementById("cuit");
const montoInput     = document.getElementById("monto");
const detalleInput   = document.getElementById("detalle");
const btnEmitir      = document.getElementById("btnEmitir");
const btnOpenPreview = document.getElementById("btnOpenPreview");

// ============================================
// PASOS DE PROGRESO — animación durante emisión
// ============================================
const PASOS = [
  { text: "Conectando con el servidor",    sub: "Verificando disponibilidad" },
  { text: "Preparando el comprobante",     sub: "Validando ítems y totales" },
  { text: "Enviando a ARCA",               sub: "Transmitiendo datos fiscales" },
  { text: "ARCA está procesando",          sub: "Puede tardar unos segundos" },
  { text: "Solicitando el CAE",            sub: "Esperando la autorización" },
  { text: "Generando el PDF",              sub: "Armando el comprobante" },
  { text: "Enviando por email",            sub: "Casi listo" },
];
const BTN_EMITIR_HTML = `${ico("zap")}Emitir factura`;

let _pasoInterval = null;
let _pasoActual   = 0;
let _pasoTs       = 0;

function startEmisionProgress() {
  _pasoActual = 0; _pasoTs = Date.now();
  renderPaso(0);
  _pasoInterval = setInterval(() => {
    const s = (Date.now() - _pasoTs) / 1000;
    if (s >  5 && _pasoActual < 1) renderPaso(1);
    if (s > 12 && _pasoActual < 2) renderPaso(2);
    if (s > 22 && _pasoActual < 3) renderPaso(3);
    if (s > 35 && _pasoActual < 4) renderPaso(4);
    if (s > 55 && _pasoActual < 5) renderPaso(5);
    if (s > 75 && _pasoActual < 6) renderPaso(6);
  }, 600);
}

function renderPaso(idx) {
  _pasoActual = idx;
  const p = PASOS[Math.min(idx, PASOS.length - 1)];
  btnEmitir.innerHTML = `
    <span class="spinner"></span>
    <span class="paso"><span>${p.text}</span><small>${p.sub} · paso ${idx+1} de ${PASOS.length}</small></span>
  `;
}

function stopEmisionProgress() {
  clearInterval(_pasoInterval); _pasoInterval = null;
}

function setBtnState(state, text) {
  stopEmisionProgress();
  btnEmitir.className = "main-btn";
  btnEmitir.disabled  = true;
  const limpio = String(text || "").replace(/^[\p{Extended_Pictographic}️\s]+/u, "");
  if (state === "loading") {
    btnEmitir.classList.add("btn-loading");
    btnEmitir.innerHTML = `<span class="spinner"></span>${escHtml(limpio || "Procesando…")}`;
  } else if (state === "success") {
    btnEmitir.classList.add("btn-success");
    btnEmitir.innerHTML = `${ico("check-circle")}${escHtml(limpio || "Completado")}`;
    btnEmitir.disabled = false;
  } else {
    btnEmitir.innerHTML = /reintentar/i.test(limpio) ? `${ico("refresh")}Reintentar emisión` : BTN_EMITIR_HTML;
    btnEmitir.disabled = false;
  }
}

window.presetDetalle = function (txt) { haptic(); detalleInput.value = txt; triggerPreviewNow(); };

// ============================================
// INPUTS → PREVIEW
// ============================================
[cuitInput, montoInput, detalleInput, document.getElementById("condicionVenta")].forEach(el => {
  if (!el) return;
  el.addEventListener("input", () => { clearTimeout(previewTimer); previewTimer = setTimeout(generarVistaPrevia, 1500); });
  el.addEventListener("blur", triggerPreviewNow);
});
function triggerPreviewNow() { clearTimeout(previewTimer); generarVistaPrevia(); }

// Autofill email cuando el CUIT llega a 11 dígitos
cuitInput.addEventListener("input", () => {
  if (cuitInput.value.trim().length === 11) autoFillEmailSiVacio(cuitInput.value.trim());
});

// Guardar email en DB cuando el usuario sale del campo con CUIT válido
document.getElementById("email").addEventListener("blur", () => {
  const emailVal = document.getElementById("email").value.trim();
  const cuitVal  = cuitInput.value.trim();
  if (cuitVal.length === 11 && emailVal.includes("@")) saveEmailCuit(cuitVal, emailVal);
});

function computeTotalPartes() {
  totalPartes = Math.max(1, Math.ceil((itemsGlobal.length || 0) / 25));
  if (parteActual > totalPartes) parteActual = totalPartes;
  if (parteActual < 1) parteActual = 1;
  const pill = document.getElementById("pillParte");
  if (pill) pill.textContent = `${parteActual}/${totalPartes}`;
  const bp = document.getElementById("btnPrev");
  const bn = document.getElementById("btnNext");
  if (bp) bp.disabled = parteActual <= 1;
  if (bn) bn.disabled = parteActual >= totalPartes;
}
window.cambiarParte = function (dir) {
  haptic();
  if (dir === -1 && parteActual > 1) parteActual--;
  if (dir ===  1 && parteActual < totalPartes) parteActual++;
  triggerPreviewNow();
};

// ============================================
// CARGA PDF
// ============================================
fileInput.addEventListener("change", leerPDF);
async function leerPDF(event) {
  const files = event?.target?.files || fileInput.files;
  if (!files || files.length === 0) return;
  haptic();
  const fileBadge = document.getElementById("file-badge");
  if (fileBadge) { fileBadge.style.display = "flex"; fileBadge.innerHTML = `${ico("file", "ic-sm")}${files.length} archivo${files.length !== 1 ? "s" : ""} cargado${files.length !== 1 ? "s" : ""}`; }
  setBtnState("loading", "Analizando PDF con IA...");
  const formData = new FormData();
  for (let i = 0; i < files.length; i++) formData.append("remito", files[i]);
  try {
    const r = await fetchWithRetry(
      `${BASE}/leer-remito`, { method: "POST", body: formData },
      { maxRetries: 3, timeoutMs: 120000, onRetry: (a) => showToast(`⏳ Reintentando análisis (${a}/3)...`) }
    );
    const res = await r.json();
    if (!r.ok) throw new Error(res.detail || res.message || "Error al leer PDF.");
    domicilioRemitoGlobal  = res.domicilioRemito || "";
    subtotalBrutoGlobal    = Number(res.subtotalBruto || 0);
    descuentoPctGlobal     = Number(res.descuentoPct || 0);
    descuentoImporteGlobal = Number(res.descuentoImporte || 0);
    totalFinalGlobal       = Number(res.total || 0);
    itemsGlobal            = Array.isArray(res.items) ? res.items : [];
    parteActual            = 1;
    if (cuitInput)  cuitInput.value  = res.cuit || "";
    if (cuitInput && res.cuit) autoFillEmailSiVacio(res.cuit);
    if (montoInput) montoInput.value = res.total ? String(res.total).replace(".", ",") : "";
    mostrarResumenExtraccion(res);
    showToast(`✅ ${itemsGlobal.length} ítems · $${formatMoneyAR(totalFinalGlobal)}`, "success");
    haptic("success");
    setBtnState("ready", "⚡ EMITIR FACTURA");
    triggerPreviewNow();
  } catch (e) {
    showToast("❌ " + (e.message || "Error de conexión"), "error");
    setBtnState("ready", "⚡ EMITIR FACTURA");
    if (fileBadge) fileBadge.style.display = "none";
  }
}

function mostrarResumenExtraccion(res) {
  const box = document.getElementById("resumenExtraccion");
  if (!box) return;
  const items = Array.isArray(res.items) ? res.items : [];
  let html = `<strong>Datos leídos del remito</strong><br>`;
  if (res.cuit) html += `CUIT: <strong>${escHtml(res.cuit)}</strong><br>`;
  html += `Ítems: <strong>${items.length}</strong>`;
  if (subtotalBrutoGlobal > 0 && descuentoImporteGlobal > 0)
    html += ` · Subtotal: <strong>$${formatMoneyAR(subtotalBrutoGlobal)}</strong> · Descuento: <strong>-$${formatMoneyAR(descuentoImporteGlobal)}</strong>`;
  if (totalFinalGlobal > 0) html += `<div class="summary-total">Total: $${formatMoneyAR(totalFinalGlobal)}</div>`;
  if (res.domicilioRemito) html += `<div class="muted">Entrega: ${escHtml(res.domicilioRemito)}</div>`;
  box.innerHTML = html;
  box.style.display = "block";
}

// ============================================
// VISTA PREVIA
// ============================================
async function generarVistaPrevia() {
  const cuit = cuitInput.value.trim();
  const detalleManual = detalleInput.value.trim();
  let items = itemsGlobal.map(it => {
    const d = String(it.descripcion || "").trim();
    const q = Number(it.cantidad || 0);
    const p = round2(Number(it.precioConIva || 0));
    const s = round2(Number(it.subtotalConIva || (q * p) || 0));
    return { descripcion: d, cantidad: q, precioConIva: p, subtotalConIva: s };
  }).filter(it => it.cantidad > 0 && it.precioConIva > 0 && it.subtotalConIva > 0);

  if (items.length === 0) {
    const m = parseMontoInput();
    if (m > 0) items = [{ descripcion: detalleManual || "Artículos varios", cantidad: 1, precioConIva: round2(m), subtotalConIva: round2(m) }];
  }
  const totalComputed = round2(items.reduce((a, x) => a + Number(x.subtotalConIva || 0), 0));
  const totalToSend   = totalFinalGlobal > 0 ? totalFinalGlobal : totalComputed;
  if (window.UI?.resumenPrevia) window.UI.resumenPrevia({ cuit, items, total: totalToSend });
  if (items.length === 0 && (!cuit || cuit.length < 11)) { btnOpenPreview.disabled = true; return; }

  computeTotalPartes();
  btnOpenPreview.disabled = false;
  btnOpenPreview.innerHTML = `${ico("eye", "ic-sm")}Ver PDF de vista previa${totalPartes > 1 ? ` (parte ${parteActual} de ${totalPartes})` : ""}`;

  try {
    const r = await fetchWithRetry(
      `${BASE}/debug/preview`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        cuitCliente: cuit, domicilioRemito: domicilioRemitoGlobal,
        condicionVenta: document.getElementById("condicionVenta").value,
        items, subtotalBruto: subtotalBrutoGlobal || 0,
        descuentoPct: descuentoPctGlobal || 0, descuentoImporte: descuentoImporteGlobal || 0,
        total: totalToSend, previewParte: parteActual
      })},
      { maxRetries: 2, timeoutMs: 30000 }
    );
    if (r.ok) {
      const html = await r.text();
      const doc  = document.getElementById("previewFrame").contentWindow.document;
      doc.open(); doc.write(html); doc.close();
      ajustarPreview();
    }
  } catch (e) { console.warn("Preview:", e.message); }
}

// Muestra la hoja A4 real (820 px) escalada al ancho disponible
function ajustarPreview() {
  const frame = document.getElementById("previewFrame");
  const doc = frame?.contentWindow?.document;
  if (!doc || !doc.body) return;
  let st = doc.getElementById("ml-fit");
  if (!st) { st = doc.createElement("style"); st.id = "ml-fit"; doc.head.appendChild(st); }
  const w = frame.clientWidth || 820;
  const k = Math.min(1, (w - 8) / 880);
  st.textContent = `html,body{overflow-x:hidden} .page{width:880px!important;padding:30px!important;zoom:${k}!important;margin:0!important}`;
}
window.addEventListener("resize", ajustarPreview);

window.openPreview = function () {
  haptic();
  document.getElementById("previewBackdrop").classList.add("active");
  document.getElementById("previewSheet").classList.add("active");
  setTimeout(ajustarPreview, 320);
};
window.closePreview = function () {
  haptic();
  document.getElementById("previewBackdrop").classList.remove("active");
  document.getElementById("previewSheet").classList.remove("active");
};
btnOpenPreview.addEventListener("click", window.openPreview);

// ============================================
// EMISIÓN ARCA
// ============================================
window.emitir = async function () {
  haptic();
  const cuit = cuitInput.value.trim();
  if (!cuit || cuit.length !== 11) return showToast("CUIT debe tener 11 dígitos", "error");

  let items = itemsGlobal.map(it => {
    const d = String(it.descripcion || "").trim();
    const q = Number(it.cantidad || 0);
    const p = round2(Number(it.precioConIva || 0));
    const s = round2(Number(it.subtotalConIva || (q * p) || 0));
    return { descripcion: d, cantidad: q, precioConIva: p, subtotalConIva: s };
  }).filter(it => it.cantidad > 0 && it.precioConIva > 0 && it.subtotalConIva > 0);

  if (items.length === 0) {
    const m = parseMontoInput();
    if (!m || m <= 0) return showToast("Ingresá monto o subí un PDF", "error");
    items = [{ descripcion: detalleInput.value || "Artículos Varios", cantidad: 1, precioConIva: round2(m), subtotalConIva: round2(m) }];
    domicilioRemitoGlobal = ""; subtotalBrutoGlobal = 0; descuentoPctGlobal = 0;
    descuentoImporteGlobal = 0; totalFinalGlobal = round2(m); itemsGlobal = items;
  }

  const totalComputed = round2(items.reduce((a, x) => a + Number(x.subtotalConIva || 0), 0));
  const totalToSend   = totalFinalGlobal > 0 ? totalFinalGlobal : totalComputed;
  const payload = {
    cuitCliente: cuit, domicilioRemito: domicilioRemitoGlobal,
    condicionVenta: document.getElementById("condicionVenta").value,
    items, subtotalBruto: subtotalBrutoGlobal || 0,
    descuentoPct: descuentoPctGlobal || 0, descuentoImporte: descuentoImporteGlobal || 0,
    total: totalToSend
  };
  const emailObj = document.getElementById("email").value.trim();
  if (emailObj) payload.emailCliente = emailObj;

  try { localStorage.setItem("ml_pending_emission", JSON.stringify({ payload, ts: Date.now() })); } catch {}

  btnEmitir.disabled = true;
  btnEmitir.className = "main-btn btn-loading";
  startEmisionProgress();

  try {
    const r = await fetchWithRetry(
      `${BASE}/facturar`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { maxRetries: 1, timeoutMs: 180000 }
    );
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || "Error al facturar");
    if (!j.ok)  throw new Error(j.message || "Respuesta inválida");

    try { localStorage.setItem("ml_last_result", JSON.stringify({ result: j, payload, ts: Date.now() })); } catch {}
    try { localStorage.removeItem("ml_pending_emission"); } catch {}

    haptic("success");
    stopEmisionProgress();
    setBtnState("success", "¡Factura Autorizada por ARCA!");
    guardarEnHistorialLocal(j, payload);
    if (payload.emailCliente) saveEmailCuit(payload.cuitCliente, payload.emailCliente);
    showSuccessModal(j);

  } catch (e) {
    stopEmisionProgress();
    setBtnState("ready", "🔄 REINTENTAR EMISIÓN");
    const msg = e.name === "AbortError"
      ? "⏱ Timeout — AFIP tardó demasiado. Verificá en ARCA si se generó la factura antes de reintentar."
      : "❌ " + (e.message || "Error de conexión");
    showToast(msg, "error");
  }
};

// ============================================
// RECUPERAR EMISIÓN PENDIENTE
// ============================================
(async function checkPending() {
  try {
    const raw = localStorage.getItem("ml_pending_emission");
    if (!raw) return;
    const { payload, ts } = JSON.parse(raw);
    if (Date.now() - ts > 10 * 60 * 1000) { localStorage.removeItem("ml_pending_emission"); return; }

    const ok = confirm(
      `⚠️ Emisión pendiente (CUIT: ${payload.cuitCliente})\n¿Reintentar ahora?\n\n⚠️ Si la factura YA se emitió, tocá Cancelar para no duplicar.`
    );
    if (!ok) { localStorage.removeItem("ml_pending_emission"); return; }

    btnEmitir.disabled = true;
    btnEmitir.className = "main-btn btn-loading";
    startEmisionProgress();

    const r = await fetchWithRetry(
      `${BASE}/facturar`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { maxRetries: 1, timeoutMs: 180000 }
    );
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || "Error");
    if (!j.ok)  throw new Error(j.message || "Respuesta inválida");

    try { localStorage.setItem("ml_last_result", JSON.stringify({ result: j, payload, ts: Date.now() })); } catch {}
    localStorage.removeItem("ml_pending_emission");
    stopEmisionProgress();
    setBtnState("success", "¡Factura Autorizada!");
    guardarEnHistorialLocal(j, payload);
    showSuccessModal(j);
  } catch (e) {
    stopEmisionProgress();
    setBtnState("ready", "⚡ EMITIR FACTURA");
    showToast("❌ " + (e.message || "Error"), "error");
  }
})();

// ============================================
// RECUPERAR ÚLTIMO RESULTADO EXITOSO
// ============================================
(function checkLastResult() {
  try {
    const raw = localStorage.getItem("ml_last_result");
    if (!raw) return;
    const { result, payload, ts } = JSON.parse(raw);
    if (Date.now() - ts > 30 * 60 * 1000) { localStorage.removeItem("ml_last_result"); return; }
    const modal = document.getElementById("successModal");
    if (modal && !modal.classList.contains("active")) {
      const ok = confirm(
        `✅ Hay una factura emitida recientemente.\nCUIT: ${payload?.cuitCliente || "?"}\n\n¿Querés volver a ver el resultado y descargar el PDF?`
      );
      if (ok) { guardarEnHistorialLocal(result, payload); showSuccessModal(result); setBtnState("success", "¡Factura Recuperada!"); }
      localStorage.removeItem("ml_last_result");
    }
  } catch { try { localStorage.removeItem("ml_last_result"); } catch {} }
})();

// ============================================
// HISTORIAL LOCAL
// ============================================
function guardarEnHistorialLocal(responseData, payload) {
  try {
    const facturas = Array.isArray(responseData.facturas) ? responseData.facturas : [];
    const hoy = new Date();
    const mesKey = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    const raw = localStorage.getItem("ml_historial") || "{}";
    const hist = JSON.parse(raw);
    if (!hist[mesKey]) hist[mesKey] = [];

    for (const f of facturas) {
      const pv  = Number(f.puntoVenta || f.pv || extraerPVDesdeComprobante(f.comprobante));
      const nro = Number(f.nroFactura || f.nro || extraerNroDesdeComprobante(f.comprobante));
      const comprobante = f.comprobante || `A-${String(pv).padStart(5, "0")}-${String(nro).padStart(8, "0")}`;
      const tipoCbte = f.tipoCbte || (String(comprobante).startsWith("NC-") ? "NC" : "FA");
      if (hist[mesKey].some(x => String(x.comprobante || "") === String(comprobante))) continue;
      hist[mesKey].push({
        fecha: f.fecha || hoy.toISOString().split("T")[0],
        comprobante, tipoCbte, puntoVenta: pv, nroFactura: nro, nro,
        cae: f.cae || "",
        cuit: payload?.cuitCliente || responseData?.receptor?.cuit || "",
        nombre: responseData?.receptor?.nombre || `CUIT ${payload?.cuitCliente || ""}`,
        total: Number(f.total || 0),
        pdfUrl: f.pdfUrl || "",
      });
    }
    localStorage.setItem("ml_historial", JSON.stringify(hist));
  } catch (e) { console.warn("guardarEnHistorialLocal:", e?.message || e); }
}

// ============================================
// PANEL RESUMEN — NAVEGACIÓN DE MESES
// ============================================
function actualizarNavMes() {
  const hoy = new Date();
  const esPresente = resumenAnio === hoy.getFullYear() && resumenMes === (hoy.getMonth() + 1);
  document.getElementById("mesNavLabel").textContent = `${MESES[resumenMes]} ${resumenAnio}`;
  document.getElementById("btnMesNext").disabled = esPresente;
  // No ir más de 24 meses atrás
  const limite  = new Date(hoy.getFullYear(), hoy.getMonth() - 23, 1);
  const selDate = new Date(resumenAnio, resumenMes - 1, 1);
  document.getElementById("btnMesPrev").disabled = selDate <= limite;
}

window.navegarMes = function(dir) {
  haptic();
  resumenMes += dir;
  if (resumenMes > 12) { resumenMes = 1;  resumenAnio++; }
  if (resumenMes < 1)  { resumenMes = 12; resumenAnio--; }
  actualizarNavMes();
  renderResumen();
};

window.abrirResumen = async function () {
  haptic();
  const hoy = new Date();
  resumenAnio = hoy.getFullYear();
  resumenMes  = hoy.getMonth() + 1;
  actualizarNavMes();
  document.getElementById("resumenBackdrop")?.classList.add("active");
  document.getElementById("resumenModal").classList.add("active");
  await renderResumen();
};

window.cerrarResumen = function () {
  haptic();
  document.getElementById("resumenBackdrop")?.classList.remove("active");
  document.getElementById("resumenModal").classList.remove("active");
};

async function renderResumen() {
  const contenido = document.getElementById("resumenContenido");
  if (!contenido) return;

  // Skeleton loader mientras carga
  contenido.innerHTML = `
    <div class="res-kpis">${[1,2,3].map(() => `<div class="skeleton" style="height:64px;"></div>`).join("")}</div>
    ${[1,2,3,4].map(() => `<div class="skeleton" style="height:70px;margin-bottom:8px;"></div>`).join("")}
  `;

  const mesKey = getMesKey(resumenAnio, resumenMes);
  let facturas = [];
  let origen = "server";

  try {
    const r = await fetchWithRetry(
      `${BASE}/admin/facturas-mes?anio=${resumenAnio}&mes=${resumenMes}`,
      { method: "GET" },
      { maxRetries: 1, timeoutMs: 30000 }
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "Sin datos");
    facturas = Array.isArray(j.facturas) ? j.facturas : [];

    // Refrescar cache local
    try {
      const raw  = localStorage.getItem("ml_historial") || "{}";
      const hist = JSON.parse(raw);
      hist[mesKey] = facturas.map(f => {
        const pv  = Number(f.puntoVenta || f.punto_venta || 0);
        const nro = Number(f.nroFactura || f.nro_factura || 0);
        const comprobante = f.comprobante || `A-${String(pv).padStart(5,"0")}-${String(nro).padStart(8,"0")}`;
        const tipoCbte = f.tipoCbte || f.tipo_cbte || (String(comprobante).startsWith("NC-") ? "NC" : "FA");
        return {
          fecha: f.fecha || "", comprobante, tipoCbte, puntoVenta: pv, nroFactura: nro, nro,
          cae: f.cae || "",
          cuit: f.cuit || f.cuitCliente || f.cuit_cliente || "",
          nombre: f.nombre || f.nombreCliente || f.nombre_cliente || "Sin nombre",
          total: Number(f.total || 0),
          pdfUrl: f.pdfUrl || f.pdf_url || "",
          emailTo: f.emailTo || f.email_to || "",
          anulado: !!(f.anulado || f.estado === "anulado")
        };
      });
      localStorage.setItem("ml_historial", JSON.stringify(hist));
    } catch {}

  } catch (e) {
    console.warn("Resumen servidor no disponible, uso localStorage:", e?.message);
    origen = "local";
    try {
      const raw  = localStorage.getItem("ml_historial") || "{}";
      const hist = JSON.parse(raw);
      facturas = Array.isArray(hist[mesKey]) ? hist[mesKey] : [];
    } catch { facturas = []; }
  }

  const totalMes = round2(facturas.reduce((a, f) => a + Number(f.total || 0), 0));
  const cuitsSet = new Set(facturas.map(f => f.cuit || f.cuitCliente || "").filter(Boolean));

  const porCliente = {};
  for (const f of facturas) {
    const cuit   = f.cuit || f.cuitCliente || f.cuit_cliente || "";
    const nombre = f.nombre || f.nombreCliente || f.nombre_cliente || "Sin nombre";
    const key    = cuit || nombre;
    if (!porCliente[key]) porCliente[key] = { nombre, cuit, total: 0, cant: 0 };
    porCliente[key].total = round2(porCliente[key].total + Number(f.total || 0));
    porCliente[key].cant++;
  }
  const clientes = Object.values(porCliente).sort((a, b) => b.total - a.total);

  if (facturas.length === 0) {
    contenido.innerHTML = `
      <div class="vacio">${ico("file")}
        <p>Sin comprobantes en ${MESES[resumenMes]} ${resumenAnio}</p>
        <small>${origen === "local" ? "Sin datos en el servidor ni en este dispositivo" : "No hay comprobantes registrados para este mes"}</small>
      </div>`;
    return;
  }

  let html = `
    <div class="res-kpis">
      <div class="kpi"><div class="kpi-body"><div class="kpi-num">${facturas.length}</div><div class="kpi-label">Comprobantes</div></div></div>
      <div class="kpi"><div class="kpi-body"><div class="kpi-num">$${formatMoneyAR(totalMes)}</div><div class="kpi-label">Total del mes</div></div></div>
      <div class="kpi"><div class="kpi-body"><div class="kpi-num">${cuitsSet.size}</div><div class="kpi-label">Clientes</div></div></div>
    </div>
    <div class="sec-tit">Comprobantes · ${origen === "server" ? "sincronizado" : "guardado en este dispositivo"}</div>
  `;

  for (const f of [...facturas].reverse()) {
    const pv  = Number(f.puntoVenta || f.punto_venta || 0);
    const nro = Number(f.nroFactura || f.nro_factura || f.nro || 0);
    const comprobante = f.comprobante || `A-${String(pv).padStart(5,"0")}-${String(nro).padStart(8,"0")}`;
    const esNC        = String(f.tipoCbte || f.tipo_cbte || "").toUpperCase() === "NC" || String(comprobante).startsWith("NC-");
    const estaAnulado = !!(f.anulado || f.estado === "anulado");
    const totalNum    = Number(f.total || 0);
    const pdfUrl      = f.pdfUrl || f.pdf_url || "";
    const nombre      = f.nombre || f.nombreCliente || f.nombre_cliente || "Sin nombre";
    const cuit        = f.cuit || f.cuitCliente || f.cuit_cliente || "";
    const letra       = letraDeComprobante(comprobante);

    const emailTo   = f.emailTo || f.email_to || "";
    const factData = attrJson({ comprobante, nombre, total: totalNum, nro, nroFactura: nro, puntoVenta: pv, cuit, emailTo });

    html += `
      <div class="fact-row${estaAnulado ? " anulada" : ""}">
        <span class="letra-badge letra-${letra || "M"}">${letra || "—"}</span>
        <div style="flex:1;min-width:0;">
          <div class="fr-nombre"><span>${escHtml(nombre)}</span>${estaAnulado ? `<span class="tag tag-red">Anulada</span>` : ""}</div>
          <div class="fr-sub">${escHtml(String(f.fecha || "").split("-").reverse().join("/"))} · ${escHtml(comprobante)}</div>
          <div class="fr-cae">CAE ${escHtml(f.cae || "—")}</div>
          <div class="fact-actions">
            ${pdfUrl ? `<a class="mini-btn" href="${escHtml(pdfUrl)}" target="_blank" rel="noopener">${ico("download")}PDF</a>` : ""}
            ${!estaAnulado ? `<button class="mini-btn" onclick='abrirModalReenviarEmail(${factData})'>${ico("mail")}Email</button>` : ""}
            ${!esNC && !estaAnulado && totalNum > 0 ? `<button class="mini-btn danger" onclick='abrirModalAnular(${factData})'>${ico("file-minus")}Nota de crédito</button>` : ""}
          </div>
        </div>
        <div class="fr-monto${totalNum < 0 ? " neg" : ""}">${totalNum < 0 ? "−" : ""}$${formatMoneyAR(Math.abs(totalNum))}</div>
      </div>`;
  }

  if (clientes.length > 1) {
    html += `<div class="sec-tit">Por cliente</div>`;
    for (const c of clientes) {
      const pct = totalMes > 0 ? Math.round((c.total / totalMes) * 100) : 0;
      html += `
        <div class="rank">
          <div class="rank-top"><span>${escHtml(c.nombre)}</span><strong>$${formatMoneyAR(c.total)}</strong></div>
          <div class="rank-bar"><div style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
          <div class="rank-sub">${c.cant} comprobante${c.cant !== 1 ? "s" : ""} · ${pct}% del total</div>
        </div>`;
    }
  }

  contenido.innerHTML = html;
}

// ============================================
// CONFIRMACIÓN DE EMISIÓN
// ============================================
function showSuccessModal(data) {
  const modal      = document.getElementById("successModal");
  const actionsBox = document.getElementById("successActions");
  const simulado   = !!data.simulado;
  modal.classList.toggle("sim", simulado);
  document.getElementById("successTitulo").textContent = simulado ? "Simulación: no se emitió en ARCA" : "Factura autorizada por ARCA";
  document.getElementById("successMsgText").innerText =
    data.mensaje || "Factura emitida correctamente. Podés descargar el PDF aunque el email falle.";

  const cuitUsado   = document.getElementById("cuit")?.value?.trim()  || data.receptor?.cuit  || "";
  const emailUsado  = document.getElementById("email")?.value?.trim() || "";
  const nombreUsado = data.receptor?.nombre || (cuitUsado ? `CUIT ${cuitUsado}` : "");
  const facturas = Array.isArray(data.facturas) ? data.facturas : [];

  // La factura queda autorizada aunque el email falle: se muestran por separado
  const estadoEmail = data.emailEnviado
    ? `<span class="tag tag-green tag-dot">Enviado${emailUsado ? " a " + escHtml(emailUsado) : ""}</span>`
    : `<span class="tag tag-amber tag-dot">No enviado${data.emailError ? ": " + escHtml(data.emailError) : ""}</span>`;

  let html = "";
  facturas.forEach((f, idx) => {
    const letra = letraDeComprobante(f.comprobante);
    html += `
      <div class="comp-card">
        <div class="comp-card-head">
          <div style="display:flex;align-items:center;gap:8px;min-width:0;"><span class="letra-badge letra-${letra || "A"}">${letra || "—"}</span><strong>${escHtml(f.comprobante || "")}</strong></div>
          ${simulado ? `<span class="tag tag-amber">Simulada</span>` : `<span class="tag tag-green tag-dot">Autorizada</span>`}
        </div>
        <dl class="comp-rows">
          ${facturas.length > 1 ? `<div><dt>Parte</dt><dd>${idx + 1} de ${facturas.length}</dd></div>` : ""}
          <div><dt>Cliente</dt><dd>${escHtml(nombreUsado)}</dd></div>
          <div><dt>CUIT</dt><dd>${escHtml(cuitUsado)}</dd></div>
          <div><dt>Monto</dt><dd>$${formatMoneyAR(f.total)}</dd></div>
          <div><dt>CAE</dt><dd class="mono">${escHtml(f.cae || "—")}</dd></div>
          <div><dt>Email</dt><dd>${estadoEmail}</dd></div>
        </dl>
      </div>`;
  });
  html += `<div class="success-actions" id="successBtns"></div>`;
  actionsBox.innerHTML = html;
  const btns = actionsBox.querySelector("#successBtns");
  const mk = (tag, cls, icon, text, attrs = {}) => {
    const el = document.createElement(tag);
    el.className = cls;
    el.innerHTML = ico(icon, "ic-sm") + escHtml(text);
    Object.assign(el, attrs);
    btns.appendChild(el);
    return el;
  };

  facturas.forEach((f, idx) => {
    if (!f.pdfUrl) return;
    const sufijo = facturas.length > 1 ? ` (parte ${idx + 1})` : "";
    mk("a", "btn btn-secondary", "download", `Abrir PDF${sufijo}`, { href: f.pdfUrl, target: "_blank", download: `Factura_${f.nroFactura || idx + 1}.pdf` });
    if (navigator.share) {
      mk("button", "btn btn-secondary", "share", `Compartir${sufijo}`).onclick = async () => {
        haptic();
        try {
          const resp = await fetch(f.pdfUrl);
          const blob = await resp.blob();
          const file = new File([blob], `Factura_${f.nroFactura||idx+1}.pdf`, { type: "application/pdf" });
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: "Factura Mercado Limpio", text: `$${formatMoneyAR(f.total)} · CAE: ${f.cae}` });
          } else {
            await navigator.share({ title: "Factura Mercado Limpio", url: f.pdfUrl });
          }
        } catch (e) { if (e.name !== "AbortError") window.open(f.pdfUrl, "_blank"); }
      };
    }
    mk("a", "btn btn-wa", "chat", `Link del PDF por WhatsApp${sufijo}`, { href: `https://wa.me/?text=${encodeURIComponent(`Factura Mercado Limpio\nTotal: $${formatMoneyAR(f.total)}\nCAE: ${f.cae}\nPDF: ${f.pdfUrl}`)}`, target: "_blank" });
  });

  if (facturas.length > 0 && !simulado) {
    const f0 = facturas[0];
    mk("button", "btn btn-secondary", "mail", "Reenviar email").onclick = () => {
      abrirModalReenviarEmail({ comprobante: f0.comprobante, nombre: nombreUsado, total: f0.total, cuit: cuitUsado, emailTo: emailUsado });
    };
  }
  if (data.waLink) mk("a", "btn btn-wa", "chat", "Resumen por WhatsApp", { href: data.waLink, target: "_blank" });

  if (facturas.length > 0 && !simulado) {
    const factLines = facturas.map(f => `• ${f.comprobante || ""} · $${formatMoneyAR(f.total)}`).join("\n");
    const msgOficina =
      `*Factura emitida - Mercado Limpio*\n` +
      `Cliente: ${nombreUsado}\n` +
      `CUIT: ${cuitUsado}\n` +
      `${factLines}\n` +
      (emailUsado ? `Email: ${emailUsado}` : `Sin email registrado`);
    const oficina = (window.ML_CONFIG && window.ML_CONFIG.OFICINA_WA) || "5491133395487";
    mk("a", "btn btn-wa full", "phone", "Avisar a Oficina", { href: `https://wa.me/${oficina}?text=${encodeURIComponent(msgOficina)}`, target: "_blank" });
  }

  mk("button", "main-btn full", "plus", "Emitir otra factura").onclick = () => { haptic(); window.location.reload(); };

  document.getElementById("successBackdrop")?.classList.add("active");
  modal.classList.add("active");
}

// ============================================
// ANULACIÓN DESDE HISTORIAL
// ============================================
window.abrirModalAnular = function(factura) {
  haptic();
  facturaAAnular = factura;
  document.getElementById("anularMotivo").value = "Factura emitida por error";
  document.getElementById("anularTextoInfo").innerHTML =
    `Se va a anular <strong>${factura.comprobante || `A-${String(factura.puntoVenta||"").padStart(5,"0")}-${String(factura.nro||"").padStart(8,"0")}`}</strong><br>` +
    `Cliente: <strong>${factura.nombre || "Sin nombre"}</strong><br>` +
    `Total: <strong>$${formatMoneyAR(factura.total || 0)}</strong>`;
  document.getElementById("anularModal").classList.add("active");
};

window.cerrarModalAnular = function() {
  haptic();
  facturaAAnular = null;
  document.getElementById("anularModal").classList.remove("active");
};

window.confirmarAnulacion = async function() {
  if (!facturaAAnular) return;
  const motivo = document.getElementById("anularMotivo").value.trim() || "Factura emitida por error";
  const facturaRef = { ...facturaAAnular };
  cerrarModalAnular();

  showNcLoading(
    `Anulando ${facturaRef.comprobante || "comprobante"}...`,
    "Emitiendo Nota de Crédito en ARCA · no cierres la app"
  );

  try {
    const payload = {
      comprobante: facturaRef.comprobante,
      puntoVenta: facturaRef.puntoVenta || extraerPVDesdeComprobante(facturaRef.comprobante),
      nroFactura: facturaRef.nro || facturaRef.nroFactura || extraerNroDesdeComprobante(facturaRef.comprobante),
      motivo
    };
    const r = await fetchWithRetry(
      `${BASE}/anular-comprobante`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { maxRetries: 1, timeoutMs: 180000 }
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "No se pudo anular");

    // Actualizar historial local
    try {
      const raw  = localStorage.getItem("ml_historial") || "{}";
      const hist = JSON.parse(raw);
      const mesKey = getMesKey(resumenAnio, resumenMes);
      if (!hist[mesKey]) hist[mesKey] = [];
      hist[mesKey] = hist[mesKey].map(x =>
        String(x.comprobante || "") === String(facturaRef.comprobante || "") ? { ...x, anulado: true } : x
      );
      if (j.notaCredito) {
        const nc = j.notaCredito;
        const compNC = nc.comprobante || `NC-${String(nc.puntoVenta||0).padStart(5,"0")}-${String(nc.nroFactura||0).padStart(8,"0")}`;
        if (!hist[mesKey].some(x => String(x.comprobante||"") === compNC)) {
          hist[mesKey].push({
            fecha: nc.fecha || new Date().toISOString().split("T")[0],
            comprobante: compNC, tipoCbte: "NC",
            puntoVenta: Number(nc.puntoVenta||0), nroFactura: Number(nc.nroFactura||0), nro: Number(nc.nroFactura||0),
            cae: nc.cae || "", cuit: facturaRef.cuit || "", nombre: facturaRef.nombre || "Sin nombre",
            total: Number(nc.total||0) * -1, pdfUrl: nc.pdfUrl || "",
          });
        }
      }
      localStorage.setItem("ml_historial", JSON.stringify(hist));
    } catch (e) { console.warn("historial NC:", e?.message); }

    hideNcLoading();
    haptic("success");
    showToast("✅ Nota de Crédito emitida con éxito", "success");
    histMesCargado = "";
    if (document.getElementById("tabHistorial").classList.contains("active")) histCargar();

    if (j.notaCredito?.pdfUrl) setTimeout(() => window.open(j.notaCredito.pdfUrl, "_blank"), 400);

    await renderResumen();

  } catch (e) {
    hideNcLoading();
    showToast("❌ " + (e.message || "Error al anular"), "error");
  }
};

// ============================================
// ANULACIÓN MANUAL (FACTURA ANTIGUA)
// ============================================
window.abrirAnulacionManual = function() {
  haptic();
  document.getElementById("manualNro").value   = "";
  document.getElementById("manualCUIT").value  = "";
  document.getElementById("manualMonto").value = "";
  document.getElementById("fechaNC").valueAsDate = new Date();
  document.getElementById("anularManualModal").classList.add("active");
};

window.cerrarAnulacionManual = function() {
  haptic();
  document.getElementById("anularManualModal").classList.remove("active");
};

window.confirmarAnulacionManual = async function() {
  const tipo  = Number(document.getElementById("manualTipo").value || 1);
  const pv    = document.getElementById("manualPV").value;
  const nro   = document.getElementById("manualNro").value;
  const cuit  = document.getElementById("manualCUIT").value.trim();
  const monto = document.getElementById("manualMonto").value.trim().replace(",", ".");
  const fechaElegida = document.getElementById("fechaNC").value;
  const motivo = document.getElementById("manualMotivo").value.trim() || "Factura emitida por error";

  if (!pv || !nro || !monto || !cuit) return showToast("⚠️ Completá CUIT, Nro y Monto para anular", "error");

  cerrarAnulacionManual();
  showNcLoading("Procesando en ARCA...", `Anulando Factura ${nro} · PV ${pv}`);

  try {
    const r = await fetchWithRetry(
      `${BASE}/anular-comprobante`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cbteTipo: tipo, puntoVenta: Number(pv), nroFactura: Number(nro),
          cuitCliente: cuit, montoTotal: Number(monto),
          fechaNC: fechaElegida, motivo
        })
      },
      { maxRetries: 1, timeoutMs: 180000 }
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "No se pudo anular");

    hideNcLoading();
    haptic("success");
    showToast("✅ Nota de Crédito generada con éxito", "success");
    histMesCargado = "";

    if (j.notaCredito?.pdfUrl) setTimeout(() => window.open(j.notaCredito.pdfUrl, "_blank"), 400);
    if (typeof renderResumen === "function") renderResumen();

  } catch (e) {
    hideNcLoading();
    showToast("❌ " + (e.message || "Error al anular"), "error");
  }
};

// ============================================
// TAB NAVIGATION
// ============================================
window.switchTab = function(tab) {
  haptic();
  const isFacturar  = tab === "facturar";
  const isExtracto  = tab === "extracto";
  const isHistorial = tab === "historial";
  const isEmail     = tab === "email";

  document.getElementById("tabFacturar").classList.toggle("active",  isFacturar);
  document.getElementById("tabExtracto").classList.toggle("active",  isExtracto);
  document.getElementById("tabHistorial").classList.toggle("active", isHistorial);
  document.getElementById("tabEmail").classList.toggle("active",     isEmail);
  document.querySelectorAll(".side-link[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  const TITULOS = {
    facturar:  ["Facturación", "Sistema de facturación ARCA"],
    extracto:  ["Extracto bancario", "Subí el extracto y la IA detecta las transferencias"],
    historial: ["Historial de facturas", "Consultá, descargá y gestioná los comprobantes emitidos"],
    email:     ["Emails y resumen", "Enviá el resumen mensual de facturación"],
  };
  const [tit, sub] = TITULOS[tab] || TITULOS.facturar;
  document.getElementById("pageTitle").textContent = tit;
  document.getElementById("pageSub").textContent = sub;
  window.scrollTo({ top: 0 });

  document.getElementById("tabBtnFacturar").classList.toggle("active",  isFacturar);
  document.getElementById("tabBtnExtracto").classList.toggle("active",  isExtracto);
  document.getElementById("tabBtnHistorial").classList.toggle("active", isHistorial);
  document.getElementById("tabBtnEmail").classList.toggle("active",     isEmail);

  if (isHistorial && document.getElementById("histList").children.length === 0) histCargar();
  if (isEmail) emailInicializar();
};

// ============================================
// MÓDULO EXTRACTO BANCARIO
// ============================================
let extTransferencias = []; // transferencias detectadas con estado (sólo chinos)
let extTodasTransferencias = []; // todas las transferencias del extracto (para conciliación)

// ── Archivo seleccionado ──────────────────────────────────────
document.getElementById("extFileInput").addEventListener("change", function() {
  const f = this.files[0];
  if (!f) return;
  haptic();
  const badge = document.getElementById("extFileBadge");
  badge.style.display = "flex";
  badge.innerHTML = `${ico("file", "ic-sm")}${escHtml(f.name)} · ${(f.size / 1024).toFixed(0)} KB`;
  document.getElementById("extBtnProcesar").disabled = false;
  document.getElementById("extBtnProcesar").style.opacity = "1";
});

// ── Paso 1: Analizar extracto (fire-and-forget con polling) ──────
window.extProcesar = async function() {
  const file = document.getElementById("extFileInput").files[0];
  if (!file) return showToast("Seleccioná un archivo primero", "error");

  haptic();
  const btn = document.getElementById("extBtnProcesar");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner spinner-sm"></span>Subiendo...`;

  try {
    // Despertar el server antes de subir — evita "Unexpected end of form"
    const despierto = await wakeServer(() => {
      btn.innerHTML = `<span class="spinner spinner-sm"></span>Despertando servidor...`;
      showToast("⏳ Despertando el servidor, aguantá unos segundos...", "success");
    });
    if (!despierto) throw new Error("El servidor no responde. Probá de nuevo en un minuto.");

    btn.innerHTML = `<span class="spinner spinner-sm"></span>Subiendo...`;
    const formData = new FormData();
    formData.append("extracto", file);

    // Solo sube el archivo — el servidor responde con jobId al instante
    const r = await fetchWithRetry(
      `${BASE}/procesar-extracto`,
      { method: "POST", body: formData },
      { maxRetries: 3, timeoutMs: 60000 }
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "Error al subir");

    // Mostrar pantalla de análisis con polling
    btn.innerHTML = `<span class="spinner spinner-sm"></span>Analizando...`;
    await extEsperarAnalisis(j.jobId, btn);

  } catch (e) {
    showToast("❌ " + (e.message || "Error"), "error");
    btn.disabled = false;
    btn.innerHTML = `${ico("sparkles", "ic-sm")}Analizar con IA`;
  }
};

async function extEsperarAnalisis(jobId, btn) {
  // Mostrar mensaje de que puede guardar el celu
  showToast("📱 Analizando en servidor — podés guardar el celular", "success");

  let fallos = 0;
  while (true) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const resp = await fetch(`${BASE}/estado-procesar/${jobId}`);
      const estado = await resp.json();

      if (estado.estado === "error") {
        throw new Error(estado.message || "Error en análisis");
      }

      if (estado.estado === "terminado") {
        extTodasTransferencias = estado.todas || [];
        extTransferencias = (estado.transferencias || []).map((t, i) => ({
          ...t,
          id: i,
          incluida: !t.yaFacturado,
          cuitEdit: t.cuit || ""
        }));

        if (estado.detectados === 0) {
          const conCuit = extTodasTransferencias.filter(t =>
            String(t.cuit || "").replace(/\D/g, "").length === 11 && !t.yaFacturado && Number(t.monto) > 0
          );
          if (conCuit.length === 0) {
            showToast(`Se encontraron ${estado.total} movimientos pero ninguno tiene CUIT para facturar`, "error");
            btn.disabled = false;
            btn.innerHTML = `${ico("sparkles", "ic-sm")}Analizar con IA`;
            return;
          }
          showToast(`Sin chinos detectados · ${conCuit.length} transferencia${conCuit.length !== 1 ? "s" : ""} con CUIT disponible${conCuit.length !== 1 ? "s" : ""}`, "success");
        }

        haptic("success");
        const yaFact    = estado.transferencias.filter(t => t.yaFacturado).length;
        const pendientes = estado.transferencias.filter(t => !t.yaFacturado).length;
        const msg = yaFact > 0
          ? `✅ ${estado.detectados} detectadas · ${yaFact} ya facturadas · ${pendientes} pendientes`
          : `✅ ${estado.detectados} transferencias detectadas`;
        showToast(msg, "success");
        extRenderStep2();
        return;
      }

      fallos = 0;
    } catch (e) {
      fallos++;
      if (fallos >= 4) {
        showToast("❌ " + (e.message || "Error en análisis"), "error");
        btn.disabled = false;
        btn.innerHTML = `${ico("sparkles", "ic-sm")}Analizar con IA`;
        return;
      }
    }
  }
}

// ── Renderizar paso 2: lista de transferencias ────────────────
function extRenderStep2() {
  document.getElementById("extStep1").classList.remove("active");
  document.getElementById("extStep2").classList.add("active");
  extRenderList();
}

function extRenderList() {
  const list = document.getElementById("extTransferList");
  list.innerHTML = "";

  const incluidas = extTransferencias.filter(t => t.incluida);
  const total = incluidas.reduce((s, t) => s + t.monto, 0);

  document.getElementById("extCountLabel").textContent = incluidas.length;
  document.getElementById("extTotalLabel").textContent = `$${formatMoneyAR(total)}`;

  const extBtn = document.getElementById("extBtnFacturar");
  extBtn.disabled = incluidas.length === 0 || incluidas.some(t => t.incluida && !t.cuitEdit);

  const btnTodo = document.getElementById("extBtnFacturarTodo");
  if (btnTodo) {
    const candidatasTodo = extTodasTransferencias.filter(t =>
      String(t.cuit || "").replace(/\D/g, "").length === 11 && !t.yaFacturado && Number(t.monto) > 0
    );
    btnTodo.style.display = "flex";
    btnTodo.disabled = candidatasTodo.length === 0;
    btnTodo.innerHTML = candidatasTodo.length > 0
      ? `${ico("bank", "ic-sm")}Facturar todo (${candidatasTodo.length})`
      : `${ico("bank", "ic-sm")}Facturar todo con CUIT`;
  }

  // Total visible en el dock del celular
  const bottomBar = document.getElementById("extBottomTotalBar");
  const bottomCount = document.getElementById("extBottomCount");
  const bottomTotal = document.getElementById("extBottomTotal");
  if (bottomBar) {
    bottomBar.style.display = incluidas.length > 0 ? "flex" : "none";
    if (bottomCount) bottomCount.textContent = `${incluidas.length} transferencia${incluidas.length !== 1 ? "s" : ""}`;
    if (bottomTotal) bottomTotal.textContent = `$${formatMoneyAR(total)}`;
  }
  document.getElementById("tabExtracto").classList.add("ext-dock-on");

  extTransferencias.forEach(t => {
    const div = document.createElement("div");
    const sinCuit = !t.cuitEdit;
    const emailGuardado = t.cuitEdit.length === 11 ? getEmailForCuit(t.cuitEdit) : "";
    div.className = `tr-row transfer-card${sinCuit ? " sin-cuit" : ""}${!t.incluida ? " excluida" : ""}`;

    let estado;
    if (t.yaFacturado) estado = `<span class="tag tag-green tag-dot">Ya facturada</span>`;
    else if (sinCuit) estado = `<span class="tag tag-red tag-dot">Falta CUIT</span>`;
    else if (!t.incluida) estado = `<span class="tag">Excluida</span>`;
    else estado = `<span class="tag tag-blue tag-dot">Sin facturar</span>`;

    div.innerHTML = `
      <div class="tr-check-cell"><button class="tr-check${t.incluida ? " on" : ""}" onclick="extToggleTransfer(${t.id})" aria-label="${t.incluida ? "Excluir" : "Incluir"}">${t.incluida ? ico("check") : ""}</button></div>
      <div class="tr-fecha">${escHtml(t.fecha || "—")}</div>
      <div class="tr-main">
        <div class="tr-nombre">${escHtml(t.nombre)}</div>
        <div class="tr-meta">${escHtml(t.fecha || "Sin fecha")}${t.descripcion ? " · " + escHtml(t.descripcion) : ""}${t.referencia ? " · Ref. " + escHtml(t.referencia) : ""}</div>
      </div>
      <div class="tr-cuit">
        <input class="transfer-cuit-input" type="tel" inputmode="numeric" maxlength="11" aria-label="CUIT"
          placeholder="CUIT (11 dígitos)" value="${escHtml(t.cuitEdit)}"
          onchange="extUpdateCuit(${t.id}, this.value)"
          oninput="extUpdateCuit(${t.id}, this.value)" />
      </div>
      <div class="tr-monto">$${formatMoneyAR(t.monto)}</div>
      <div class="tr-estado">${estado}${emailGuardado ? `<span class="tc-email" title="${escHtml(emailGuardado)}">${ico("mail", "ic-sm")}<span class="tc-email-txt">${escHtml(emailGuardado)}</span></span>` : ""}</div>
    `;
    list.appendChild(div);
  });
}
window.extUpdateCuit = function(id, val) {
  const t = extTransferencias.find(x => x.id === id);
  if (t) {
    t.cuitEdit = val.replace(/\D/g, "").slice(0, 11);
    // Re-evaluar estado del botón
    const incluidas = extTransferencias.filter(x => x.incluida);
    const btn = document.getElementById("extBtnFacturar");
    btn.disabled = incluidas.length === 0 || incluidas.some(x => x.incluida && x.cuitEdit.length !== 11);
    btn.style.opacity = btn.disabled ? "0.55" : "1";
    // Actualizar badge de sin-cuit en la card
    const cards = document.querySelectorAll(".transfer-card");
    cards.forEach((card, i) => {
      if (extTransferencias[i]?.id === id) {
        const falta = t.cuitEdit.length !== 11;
        card.classList.toggle("sin-cuit", falta);
        const tag = card.querySelector(".tr-estado .tag");
        if (tag && !t.yaFacturado) {
          tag.className = falta ? "tag tag-red tag-dot" : (t.incluida ? "tag tag-blue tag-dot" : "tag");
          tag.textContent = falta ? "Falta CUIT" : (t.incluida ? "Sin facturar" : "Excluida");
        }
      }
    });
  }
};

window.extToggleTransfer = function(id) {
  haptic();
  const t = extTransferencias.find(x => x.id === id);
  if (t) { t.incluida = !t.incluida; extRenderList(); }
};

window.extVolver = function() {
  haptic();
  extTransferencias = [];
  document.getElementById("tabExtracto").classList.remove("ext-dock-on");
  document.getElementById("extStep2").classList.remove("active");
  document.getElementById("extStep1").classList.add("active");
  document.getElementById("extFileBadge").style.display = "none";
  document.getElementById("extFileInput").value = "";
  const bottomBar = document.getElementById("extBottomTotalBar");
  if (bottomBar) bottomBar.style.display = "none";
  const btn = document.getElementById("extBtnProcesar");
  btn.disabled = true;
  btn.innerHTML = `${ico("sparkles", "ic-sm")}Analizar con IA`;
};

// ── Paso 3: Facturar (fire-and-forget con job polling) ────────
window.extFacturar = async function() {
  const incluidas = extTransferencias.filter(t => t.incluida && t.cuitEdit.length === 11 && t.monto > 0);
  if (incluidas.length === 0) return showToast("No hay transferencias válidas para facturar", "error");

  haptic();
  const btn = document.getElementById("extBtnFacturar");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner spinner-sm"></span>Iniciando...`;

  try {
    const payload = {
      transferencias: incluidas.map(t => {
        const savedEmail = getEmailForCuit(t.cuitEdit);
        const obj = { cuit: t.cuitEdit, monto: t.monto, nombre: t.nombre, fecha: t.fecha || "", referencia: t.referencia || "" };
        if (savedEmail) obj.email = savedEmail;
        return obj;
      }),
      todasTransferencias: extTodasTransferencias.map(t => ({
        cuit:   t.cuit   || "",
        monto:  t.monto  || 0,
        nombre: t.nombre || "",
        fecha:  t.fecha  || "",
        referencia: t.referencia || ""
      })),
      condicionVenta: "Transferencia Bancaria",
      emailReporte: "santamariapablodaniel@gmail.com"
    };

    const despierto = await wakeServer(() => {
      btn.innerHTML = `<span class="spinner spinner-sm"></span>Despertando servidor...`;
    });
    if (!despierto) throw new Error("El servidor no responde. Probá de nuevo en un minuto.");

    // El servidor responde con jobId inmediatamente.
    // maxRetries:1 a propósito: si el POST llegó pero se perdió la respuesta,
    // reintentar dispararía DOS jobs sobre las mismas transferencias.
    const r = await fetchWithRetry(
      `${BASE}/facturar-extracto`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { maxRetries: 1, timeoutMs: 30000 }
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "Error al iniciar");

    haptic("success");
    await extMostrarProgreso(j.jobId, j.total);

  } catch (e) {
    showToast("❌ " + (e.message || "Error"), "error");
    btn.disabled = false;
    btn.innerHTML = `${ico("zap")}Facturar seleccionadas`;
  }
};

// ── Facturar TODO con CUIT — muestra revisión antes de emitir ─
let extCandidatasTodo = [];

window.extFacturarTodo = function() {
  extCandidatasTodo = extTodasTransferencias
    .filter(t => String(t.cuit || "").replace(/\D/g, "").length === 11 && !t.yaFacturado && Number(t.monto) > 0)
    .map((t, i) => ({ ...t, _id: i, cuit: String(t.cuit || "").replace(/\D/g, "") }));

  if (extCandidatasTodo.length === 0) return showToast("No hay transferencias con CUIT para facturar", "error");

  haptic();
  extRenderRevisionTodo();
  document.getElementById("revisionTodoBackdrop").classList.add("active");
  document.getElementById("revisionTodoSheet").classList.add("active");
};

function extRenderRevisionTodo() {
  const lista    = document.getElementById("revisionTodoLista");
  const count    = document.getElementById("revisionTodoCount");
  const totalEl  = document.getElementById("revisionTodoTotal");
  const confirmar = document.getElementById("revisionTodoConfirmar");

  const total = extCandidatasTodo.reduce((s, t) => s + Number(t.monto), 0);
  count.textContent = `${extCandidatasTodo.length} transferencia${extCandidatasTodo.length !== 1 ? "s" : ""}`;
  totalEl.textContent = `$${formatMoneyAR(total)}`;
  confirmar.disabled = extCandidatasTodo.length === 0;

  lista.innerHTML = (extCandidatasTodo.length ? extCandidatasTodo.map(t => `
    <div class="res-row">
      <span class="avatar">${escHtml((t.nombre || "?").trim().charAt(0).toUpperCase())}</span>
      <div class="grow">
        <div class="nm">${escHtml(t.nombre)}</div>
        <div class="sub">${escHtml(t.fecha || "")} · CUIT ${escHtml(t.cuit)}${t.referencia ? " · Ref. " + escHtml(t.referencia) : ""}</div>
      </div>
      <div class="amt">$${formatMoneyAR(t.monto)}</div>
      <button class="icon-btn" onclick="extQuitarCandidataTodo(${t._id})" aria-label="Quitar">${ico("x", "ic-sm")}</button>
    </div>
  `).join("") : `<div class="vacio">${ico("info")}<p>Sin transferencias para facturar</p></div>`);
}
window.extQuitarCandidataTodo = function(id) {
  haptic();
  extCandidatasTodo = extCandidatasTodo.filter(t => t._id !== id);
  extRenderRevisionTodo();
};

window.cerrarRevisionTodo = function() {
  haptic();
  document.getElementById("revisionTodoBackdrop").classList.remove("active");
  document.getElementById("revisionTodoSheet").classList.remove("active");
};

window.extConfirmarTodo = async function() {
  if (extCandidatasTodo.length === 0) return;

  cerrarRevisionTodo();

  const btn = document.getElementById("extBtnFacturarTodo");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner spinner-sm"></span>Iniciando...`;

  try {
    const payload = {
      transferencias: extCandidatasTodo.map(t => {
        const savedEmail = getEmailForCuit(t.cuit);
        const obj = { cuit: t.cuit, monto: t.monto, nombre: t.nombre, fecha: t.fecha || "", referencia: t.referencia || "" };
        if (savedEmail) obj.email = savedEmail;
        return obj;
      }),
      todasTransferencias: extTodasTransferencias.map(t => ({
        cuit: t.cuit || "", monto: t.monto || 0, nombre: t.nombre || "", fecha: t.fecha || "", referencia: t.referencia || ""
      })),
      condicionVenta: "Transferencia Bancaria",
      emailReporte: "santamariapablodaniel@gmail.com"
    };

    const despierto = await wakeServer(() => {
      btn.innerHTML = `<span class="spinner spinner-sm"></span>Despertando servidor...`;
    });
    if (!despierto) throw new Error("El servidor no responde. Probá de nuevo en un minuto.");

    // maxRetries:1 a propósito (ver nota en extFacturar): un reintento podría
    // disparar dos jobs sobre las mismas transferencias.
    const r = await fetchWithRetry(
      `${BASE}/facturar-extracto`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { maxRetries: 1, timeoutMs: 30000 }
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "Error al iniciar");

    haptic("success");
    await extMostrarProgreso(j.jobId, j.total);
  } catch (e) {
    showToast("❌ " + (e.message || "Error"), "error");
    btn.disabled = false;
    const n = extCandidatasTodo.length;
    btn.innerHTML = `${ico("bank", "ic-sm")}Facturar todo (${n})`;
  }
};

// ── Pantalla de progreso con polling ──────────────────────────
async function extMostrarProgreso(jobId, total) {
  document.getElementById("extStep2").classList.remove("active");
  document.getElementById("extStep3").classList.add("active");
  document.getElementById("tabExtracto").classList.remove("ext-dock-on");
  document.getElementById("extBtnFacturar").style.display = "none";
  const btnTodoP = document.getElementById("extBtnFacturarTodo");
  if (btnTodoP) btnTodoP.style.display = "none";

  const container = document.getElementById("extResultados");
  container.innerHTML = `
    <div class="progreso">
      <span class="spinner spinner-dark spinner-lg"></span>
      <div class="progreso-tit" id="extProgresoTexto">Iniciando proceso…</div>
      <div class="progreso-count" id="extProgresoCount">0 / ${total}</div>
      <div class="barra"><div id="extProgresoBar"></div></div>
      <div class="progreso-det" id="extProgresoDetalle"></div>
      <div class="aviso aviso-ok" style="margin-top:16px;text-align:left;">${ico("phone", "ic-sm")}<span>Podés guardar el celular: el servidor sigue procesando.</span></div>
    </div>
  `;

  let fallos = 0;
  while (true) {
    await new Promise(r => setTimeout(r, 5000));
    try {
      const resp = await fetch(`${BASE}/estado-extracto/${jobId}`);
      const estado = await resp.json();
      if (!estado.ok) throw new Error(estado.message);

      const pct = estado.porcentaje || 0;
      const barEl   = document.getElementById("extProgresoBar");
      const txtEl   = document.getElementById("extProgresoTexto");
      const cntEl   = document.getElementById("extProgresoCount");
      const detEl   = document.getElementById("extProgresoDetalle");
      if (barEl) barEl.style.width = pct + "%";
      if (txtEl) txtEl.textContent =
        estado.estado === "terminado"   ? "Proceso completado" :
        estado.estado === "interrumpido" ? "Proceso interrumpido" :
        `Procesando… ${pct}%`;
      if (cntEl) cntEl.textContent = `${estado.progreso} / ${estado.total}`;
      if (detEl) detEl.textContent =
        `${estado.facturasEmitidas || 0} emitidas · ${estado.omitidas || 0} ya facturadas · ${estado.errores || 0} errores`;

      fallos = 0;

      if (estado.estado === "terminado" || estado.estado === "error" || estado.estado === "interrumpido") {
        haptic(estado.estado === "terminado" ? "success" : "warning");
        if (estado.estado === "interrumpido") {
          showToast("El servidor se reinició a mitad de proceso. Volvé a facturar el extracto: lo ya emitido se omite automáticamente.", "error");
        }
        extRenderResultados(estado);
        return;
      }
    } catch (e) {
      fallos++;
      if (fallos >= 3) {
        const detEl = document.getElementById("extProgresoDetalle");
        if (detEl) detEl.textContent = "Sin conexión: el proceso sigue en el servidor. Cuando vuelvas a abrir la app vas a ver el resultado.";
      }
    }
  }
}

function extRenderResultados(data) {
  document.getElementById("extStep2").classList.remove("active");
  document.getElementById("extStep3").classList.add("active");
  document.getElementById("tabExtracto").classList.remove("ext-dock-on");
  document.getElementById("extBtnFacturar").style.display = "none";
  const btnTodoR = document.getElementById("extBtnFacturarTodo");
  if (btnTodoR) btnTodoR.style.display = "none";

  const container = document.getElementById("extResultados");
  const emitidas = (data.resultados || []).filter(r => r.ok && !r.skipped);
  const omitidas = (data.resultados || []).filter(r => r.skipped);
  const errores  = (data.resultados || []).filter(r => !r.ok);

  // Para el centro de pendientes: solo si hubo errores o se cortó
  try {
    if (errores.length || data.interrumpido) {
      localStorage.setItem("ml_ultimo_extracto", JSON.stringify({
        ts: Date.now(), interrumpido: !!data.interrumpido,
        errores: errores.map(r => ({ nombre: r.nombre, cuit: r.cuit, monto: r.monto, error: r.error })),
      }));
    } else {
      localStorage.removeItem("ml_ultimo_extracto");
    }
  } catch {}

  let html = `
    <div class="res-head">
      <div class="kpi"><div class="kpi-body"><div class="kpi-num">${emitidas.length}</div><div class="kpi-label">Facturas emitidas</div></div></div>
      <div class="kpi"><div class="kpi-body"><div class="kpi-num">$${formatMoneyAR(data.totalFacturado || 0)}</div><div class="kpi-label">Total facturado</div></div></div>
    </div>
    ${data.simulado ? `<div class="aviso aviso-warn">${ico("info", "ic-sm")}<span>Simulación: no se emitió nada en ARCA.</span></div>` : ""}
    ${data.interrumpido ? `<div class="aviso aviso-warn">${ico("alert", "ic-sm")}<span>El proceso se cortó a mitad. Volvé a facturar el extracto: lo ya emitido se omite solo.</span></div>` : ""}
    ${data.avisoSecuencia ? `<div class="aviso aviso-err">${ico("alert", "ic-sm")}<span>${escHtml(data.avisoSecuencia)}</span></div>` : ""}
    ${omitidas.length > 0 ? `<div class="aviso aviso-info">${ico("check-circle", "ic-sm")}<span>${omitidas.length} ya facturada${omitidas.length !== 1 ? "s" : ""}: se omitieron para no duplicar.</span></div>` : ""}
    <div class="sec-tit">Comprobantes emitidos</div>
  `;

  emitidas.forEach(r => {
    const ini = escHtml((r.nombre || "?").trim().charAt(0).toUpperCase());
    html += `
      <div class="res-row">
        <span class="avatar ok">${ini}</span>
        <div class="grow">
          <div class="nm">${escHtml(r.nombre)}</div>
          <div class="sub">${escHtml(r.comprobante)} · CAE ${escHtml(r.cae)}</div>
        </div>
        <div class="amt">$${formatMoneyAR(r.total)}</div>
        ${r.pdfUrl ? `<a class="mini-btn" href="${escHtml(r.pdfUrl)}" target="_blank" rel="noopener">${ico("download")}PDF</a>` : ""}
      </div>`;
  });
  if (!emitidas.length) html += `<div class="muted" style="padding:8px 0;">No se emitieron comprobantes nuevos.</div>`;

  if (errores.length > 0) {
    html += `<div class="sec-tit" style="color:var(--red)">Con error (${errores.length})</div>`;
    errores.forEach(r => {
      const ini = escHtml((r.nombre || "?").trim().charAt(0).toUpperCase());
      html += `
        <div class="res-row">
          <span class="avatar bad">${ini}</span>
          <div class="grow">
            <div class="nm">${escHtml(r.nombre)}</div>
            <div class="sub">CUIT ${escHtml(r.cuit)}</div>
            <div class="err">${escHtml(r.error)}</div>
          </div>
        </div>`;
    });
  }

  if (!data.simulado) html += `<div class="aviso aviso-ok" style="margin-top:14px;">${ico("mail", "ic-sm")}<span>Se envió el reporte de conciliación por email.</span></div>`;

  container.innerHTML = html;
  window.UI?.actualizarPendientes?.();
}
window.extReset = function() {
  haptic();
  extTransferencias = [];
  document.getElementById("extStep3").classList.remove("active");
  document.getElementById("extStep2").classList.remove("active");
  document.getElementById("extStep1").classList.add("active");
  document.getElementById("extFileBadge").style.display = "none";
  document.getElementById("extFileInput").value = "";
  document.getElementById("extResultados").innerHTML = "";
  const bottomBar = document.getElementById("extBottomTotalBar");
  if (bottomBar) bottomBar.style.display = "none";
  const btn = document.getElementById("extBtnFacturar");
  btn.disabled = true;
  btn.style.display = "flex";
  btn.innerHTML = `${ico("zap")}Facturar seleccionadas`;
  const btnTodoReset = document.getElementById("extBtnFacturarTodo");
  if (btnTodoReset) { btnTodoReset.disabled = true; btnTodoReset.style.display = "none"; btnTodoReset.innerHTML = `${ico("bank", "ic-sm")}Facturar todo con CUIT`; }
  extCandidatasTodo = [];
  document.getElementById("revisionTodoBackdrop")?.classList.remove("active");
  document.getElementById("revisionTodoSheet")?.classList.remove("active");
  const procBtn = document.getElementById("extBtnProcesar");
  procBtn.disabled = true;
  procBtn.innerHTML = `${ico("sparkles", "ic-sm")}Analizar con IA`;
};

// ============================================
// REENVIAR EMAIL DESDE HISTORIAL
// ============================================
let facturaAReenviar = null;

window.abrirModalReenviarEmail = function(factura) {
  haptic();
  facturaAReenviar = factura;
  document.getElementById("reenviarEmailInfo").innerHTML =
    `Comprobante: <strong>${factura.comprobante}</strong><br>` +
    `Cliente: <strong>${factura.nombre || "Sin nombre"}</strong><br>` +
    `Total: <strong>$${formatMoneyAR(factura.total || 0)}</strong>`;
  document.getElementById("reenviarEmailInput").value = factura.emailTo || getEmailForCuit(factura.cuit) || "";
  document.getElementById("reenviarEmailModal").classList.add("active");
  setTimeout(() => document.getElementById("reenviarEmailInput").focus(), 200);
};

window.cerrarModalReenviarEmail = function() {
  haptic();
  facturaAReenviar = null;
  document.getElementById("reenviarEmailModal").classList.remove("active");
};

// ============================================
// MÓDULO HISTORIAL
// ============================================
const MESES_ES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
                  "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

let histMes  = new Date().getMonth() + 1;
let histAnio = new Date().getFullYear();
let histQ    = "";
let histDebounceTimer = null;
let histFacturaActual = null; // factura abierta en el sheet de detalle

// ── Navegación de mes ─────────────────────────────────────────
window.histNavMes = function(dir) {
  haptic();
  histMes += dir;
  if (histMes < 1)  { histMes = 12; histAnio--; }
  if (histMes > 12) { histMes = 1;  histAnio++; }
  // Deshabilitar "siguiente" si ya estamos en el mes actual
  const hoy = new Date();
  const esActual = histMes === hoy.getMonth() + 1 && histAnio === hoy.getFullYear();
  document.getElementById("histBtnNext").disabled = esActual;
  histActualizarLabel();
  histCargar();
};

function histActualizarLabel() {
  document.getElementById("histMesLabel").textContent = `${MESES_ES[histMes - 1]} ${histAnio}`;
}

// ── Buscador con debounce ─────────────────────────────────────
document.getElementById("histSearchInput").addEventListener("input", function() {
  histQ = this.value.trim();
  document.getElementById("histSearchClear").classList.toggle("show", histQ.length > 0);
  clearTimeout(histDebounceTimer);
  histDebounceTimer = setTimeout(histCargar, 380);
});

window.histClearSearch = function() {
  document.getElementById("histSearchInput").value = "";
  histQ = "";
  document.getElementById("histSearchClear").classList.remove("show");
  histCargar();
};

// ── Cargar el mes completo desde el backend ───────────────────
// La búsqueda y los filtros se aplican en el dispositivo sobre los datos reales del mes
let histDatosMes = [];
let histMesCargado = "";

async function histCargar() {
  const list = document.getElementById("histList");
  const clave = `${histAnio}-${histMes}`;
  if (histMesCargado === clave) { histAplicarFiltros(); return; }

  list.innerHTML = [1,2,3,4,5].map(() => `<div class="hist-skel"></div>`).join("");
  document.getElementById("histStatBar").style.display = "none";

  try {
    const params = new URLSearchParams({ mes: histMes, anio: histAnio, limit: 500 });
    const r = await fetch(`${BASE}/historial?${params}`, { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    // Si mientras cargaba se eligió otro mes, esta respuesta ya no corresponde
    if (clave !== `${histAnio}-${histMes}`) return;
    if (!r.ok || !j.ok) throw new Error(j.message || "Error");
    histDatosMes = (j.facturas || []).slice().sort((a, b) =>
      String(b.fecha).localeCompare(String(a.fecha)) || (b.nroFactura - a.nroFactura));
    histMesCargado = clave;
    histAplicarFiltros();
  } catch (e) {
    if (clave !== `${histAnio}-${histMes}`) return;
    list.innerHTML = `<div class="hist-empty">${ico("wifi-off")}
      <p>No se pudo cargar el historial</p>
      <small>${escHtml(e.message)}</small>
    </div>`;
  }
}

const sinAcentos = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function histCoincide(f, q) {
  if (!q) return true;
  const qn = sinAcentos(q).trim();
  if (sinAcentos(f.nombre).includes(qn)) return true;
  if (sinAcentos(f.comprobante).includes(qn)) return true;
  const dig = q.replace(/\D/g, "");
  if (dig && String(f.cuit || "").includes(dig)) return true;
  if (dig && /^\d{1,8}$/.test(q.trim()) && Number(dig) === Number(f.nroFactura)) return true;
  // Monto: 263434 · 263.434 · 263.434,50
  if (/^[\d.,$\s]+$/.test(q)) {
    const m = Number(q.replace(/[$\s]/g, "").replace(/\./g, "").replace(",", "."));
    if (m > 0 && Math.abs(Math.abs(Number(f.total)) - m) < 1) return true;
  }
  // Fecha: 17/10 · 17/10/2026 · 2026-10-17
  const fe = String(f.fecha || "");
  const feAR = fe.split("-").reverse().join("/");
  if (qn.includes("/") && feAR.includes(qn)) return true;
  if (/^\d{4}-\d{2}/.test(qn) && fe.includes(qn)) return true;
  return false;
}

function histAplicarFiltros() {
  const tipo   = document.getElementById("histFiltroTipo")?.value || "";
  const origen = document.getElementById("histFiltroOrigen")?.value || "";
  const estado = document.getElementById("histFiltroEstado")?.value || "";
  const filtradas = histDatosMes.filter(f => {
    const letra = f.tipoCbte === "NC" ? "NC" : letraDeComprobante(f.comprobante);
    if (tipo && letra !== tipo) return false;
    const esExtracto = /EXTRACTO/i.test(f.condicionVenta || "");
    if (origen === "extracto" && !esExtracto) return false;
    if (origen === "directa" && esExtracto) return false;
    if (estado === "anulada" && !f.anulado) return false;
    if (estado === "emitida" && f.anulado) return false;
    return histCoincide(f, histQ);
  });
  histRenderList(filtradas, filtradas.length);
}

["histFiltroTipo", "histFiltroOrigen", "histFiltroEstado"].forEach(id =>
  document.getElementById(id)?.addEventListener("change", histAplicarFiltros));

// ── Renderizar lista / tabla ──────────────────────────────────
function histRenderList(facturas, totalCount) {
  const list = document.getElementById("histList");
  histActualizarLabel();

  const factSolo  = facturas.filter(f => f.tipoCbte === "FA" && !f.anulado);
  const ncSolo    = facturas.filter(f => f.tipoCbte === "NC");
  const totalPesos = factSolo.reduce((s, f) => s + f.total, 0);
  const statBar = document.getElementById("histStatBar");
  statBar.style.display = "";
  document.getElementById("histStatCount").textContent = factSolo.length;
  document.getElementById("histStatTotal").textContent = `$${formatMoneyAR(totalPesos)}`;
  document.getElementById("histStatNCs").textContent   = ncSolo.length;
  const cli = document.getElementById("histStatClientes");
  if (cli) cli.textContent = new Set(factSolo.map(f => f.cuit)).size;

  if (facturas.length === 0) {
    const filtrando = histQ || document.getElementById("histFiltroTipo")?.value || document.getElementById("histFiltroOrigen")?.value || document.getElementById("histFiltroEstado")?.value;
    list.innerHTML = `<div class="hist-empty">${ico(filtrando ? "search" : "file")}
      <p>${filtrando ? "Sin resultados" : "Sin comprobantes este mes"}</p>
      <small>${filtrando ? "Probá con otro dato: nombre, CUIT, número, monto (263434) o fecha (17/10)" : "Navegá a otro mes con las flechas"}</small>
    </div>`;
    window._histFacturasActuales = [];
    return;
  }

  list.innerHTML = facturas.map((f, i) => {
    const esNC     = f.tipoCbte === "NC";
    const esAnul   = f.anulado;
    const esExtrac = /EXTRACTO/i.test(f.condicionVenta || "");
    const letra    = esNC ? "NC" : letraDeComprobante(f.comprobante);
    const totalFmt = `$${formatMoneyAR(Math.abs(f.total))}`;
    const fechaAR  = String(f.fecha || "").split("-").reverse().join("/");
    const datos    = attrJson({ comprobante: f.comprobante, nombre: f.nombre, total: f.total, cuit: f.cuit, emailTo: f.emailTo, nro: f.nroFactura, nroFactura: f.nroFactura, puntoVenta: f.puntoVenta });
    const estado   = esAnul ? `<span class="tag tag-red tag-dot">Anulada</span>` : `<span class="tag tag-green tag-dot">Emitida</span>`;
    const origenTxt = esExtrac ? "Extracto" : "Directa";

    return `<div class="hrow ${esAnul ? "anulada" : ""}" role="button" tabindex="0" onclick="histAbrirDetalle(${i})" onkeydown="if(event.key==='Enter')histAbrirDetalle(${i})">
      <span class="avatar">${escHtml((f.nombre || f.cuit || "?").trim().charAt(0).toUpperCase())}</span>
      <div class="h-fecha">${escHtml(fechaAR)}</div>
      <div class="h-main"><div class="h-nombre">${escHtml(f.nombre || f.cuit || "Sin nombre")}</div><div class="h-sub">CUIT ${escHtml(f.cuit)} · ${escHtml(fechaAR)}</div></div>
      <div class="h-cuit">${escHtml(f.cuit)}</div>
      <div class="h-comp">${escHtml(f.comprobante)}</div>
      <div class="h-monto ${esNC ? "nc" : ""}">${esNC ? "−" : ""}${totalFmt}</div>
      <div class="h-tipo"><span class="letra-badge letra-${letra || "M"}">${letra || "—"}</span></div>
      <div class="h-origen">${origenTxt}</div>
      <div class="h-estado">${estado}</div>
      <div class="h-acc" onclick="event.stopPropagation()">
        ${f.pdfUrl ? `<a class="icon-btn" href="${escHtml(f.pdfUrl)}" target="_blank" rel="noopener" title="Ver PDF" aria-label="Ver PDF">${ico("download")}</a>` : ""}
        ${!esAnul ? `<button class="icon-btn" title="Reenviar email" aria-label="Reenviar email" onclick='abrirModalReenviarEmail(${datos})'>${ico("mail")}</button>` : ""}
        <button class="icon-btn" title="Más" aria-label="Más opciones" onclick="histAbrirDetalle(${i})">${ico("more")}</button>
      </div>
      <div class="h-badges">
        <span class="letra-badge letra-${letra || "M"}">${letra || "—"}</span>
        <span class="tag">${escHtml(f.comprobante)}</span>
        ${esExtrac ? `<span class="tag tag-violet">Extracto</span>` : ""}
        ${esAnul ? `<span class="tag tag-red">Anulada</span>` : ""}
      </div>
    </div>`;
  }).join("");

  window._histFacturasActuales = facturas;
}

// ── Sheet de detalle ─────────────────────────────────────────
window.histAbrirDetalle = function(idx) {
  haptic();
  const f = (window._histFacturasActuales || [])[idx];
  if (!f) return;
  histFacturaActual = f;

  const esNC   = f.tipoCbte === "NC";
  const esAnul = f.anulado;

  const letra = (String(f.comprobante || "").toUpperCase().match(/^(?:FA-|NC-)?([ABM])-/) || [])[1] || "";
  document.getElementById("histDetTipo").textContent  = `${esNC ? "NOTA DE CRÉDITO" : "FACTURA"} ${letra}`.trim();
  document.getElementById("histDetNombre").textContent = f.nombre || "Sin nombre";
  document.getElementById("histDetSub").textContent   = `CUIT ${f.cuit}`;
  document.getElementById("histDetTotal").textContent  = `${esNC ? "−" : ""}$${formatMoneyAR(Math.abs(f.total))}`;
  document.getElementById("histDetFecha").textContent  = String(f.fecha || "").split("-").reverse().join("/");
  document.getElementById("histDetComp").textContent   = f.comprobante;
  document.getElementById("histDetCuit").textContent   = f.cuit;
  document.getElementById("histDetCae").textContent    = f.cae || "—";
  document.getElementById("histDetCond2").textContent  = f.condicionVenta || "—";
  document.getElementById("histDetEmail").textContent  = f.emailTo || "—";
  document.getElementById("histDetCond").textContent   = esAnul ? "Anulada" : (esNC ? "Nota de crédito" : "Emitida");

  // Botones según estado
  const btnPdf   = document.getElementById("histBtnPdf");
  const btnAnul  = document.getElementById("histBtnAnular");
  btnPdf.style.display   = f.pdfUrl ? "flex" : "none";
  btnAnul.style.display  = (!esNC && !esAnul) ? "flex" : "none";

  document.getElementById("histDetailBackdrop").classList.add("active");
  document.getElementById("histDetailSheet").classList.add("active");
};

window.histCerrarDetalle = function() {
  document.getElementById("histDetailBackdrop").classList.remove("active");
  document.getElementById("histDetailSheet").classList.remove("active");
  histFacturaActual = null;
};

// ── Acciones desde el detalle ─────────────────────────────────
window.histAbrirPdf = function() {
  if (!histFacturaActual?.pdfUrl) return;
  haptic();
  window.open(histFacturaActual.pdfUrl, "_blank");
};

window.histReenviarEmail = function() {
  const f = histFacturaActual; // histCerrarDetalle() lo pone en null
  if (!f) return;
  histCerrarDetalle();
  abrirModalReenviarEmail(f);
};

window.histAnular = function() {
  const f = histFacturaActual; // histCerrarDetalle() lo pone en null
  if (!f) return;
  histCerrarDetalle();
  // Reutilizamos el modal existente de anulación
  facturaAAnular = f;
  document.getElementById("anularTextoInfo").innerHTML =
    `Se va a anular <strong>${escHtml(f.comprobante)}</strong> · ${escHtml(f.nombre || f.cuit)}<br>` +
    `Total: <strong>$${formatMoneyAR(Math.abs(f.total))}</strong>`;
  document.getElementById("anularMotivo").value = "Factura emitida por error";
  document.getElementById("anularModal").classList.add("active");
};

// Inicializar label al cargar
histActualizarLabel();

// ============================================
// MÓDULO EMAIL — Envío de resumen mensual
// ============================================
const EMAIL_CONTACTOS_DEFAULT = [
  { id: "pablo",    nombre: "Pablo (yo)",  email: "santamariapablodaniel@gmail.com", activo: true,  removible: false },
  { id: "contador", nombre: "Contador",    email: "Sticcoj@estudiosticco.com.ar",   activo: false, removible: false }
];
const EMAIL_STORAGE_KEY      = "ml_email_contactos";
const EMAIL_HIST_STORAGE_KEY = "ml_email_send_history";

let emailMes  = new Date().getMonth() + 1;
let emailAnio = new Date().getFullYear();
let emailContactos = [];
let emailIniciado  = false;
let emailStatsCache = {};

function emailCargarContactos() {
  try {
    const saved = JSON.parse(localStorage.getItem(EMAIL_STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length > 0) {
      // Asegurar que los defaults siempre estén
      const ids = saved.map(c => c.id);
      const base = saved.slice();
      for (const def of EMAIL_CONTACTOS_DEFAULT) {
        if (!ids.includes(def.id)) base.unshift({ ...def });
      }
      emailContactos = base;
    } else {
      emailContactos = EMAIL_CONTACTOS_DEFAULT.map(c => ({ ...c }));
    }
  } catch { emailContactos = EMAIL_CONTACTOS_DEFAULT.map(c => ({ ...c })); }
}

function emailGuardarContactos() {
  try { localStorage.setItem(EMAIL_STORAGE_KEY, JSON.stringify(emailContactos)); } catch {}
}

function emailActualizarLabel() {
  const el = document.getElementById("emailMesLabel");
  if (el) el.textContent = `${MESES[emailMes]} ${emailAnio}`;
  const lbl = document.getElementById("emailPreviewMes");
  if (lbl) lbl.textContent = `${MESES[emailMes]} ${emailAnio}`;
  const hoy = new Date();
  const esActual = emailMes === hoy.getMonth() + 1 && emailAnio === hoy.getFullYear();
  const btnNext = document.getElementById("emailBtnNext");
  if (btnNext) btnNext.disabled = esActual;
}

window.emailNavMes = function(dir) {
  haptic();
  emailMes += dir;
  if (emailMes < 1)  { emailMes = 12; emailAnio--; }
  if (emailMes > 12) { emailMes = 1;  emailAnio++; }
  emailActualizarLabel();
  emailCargarStats();
  emailContarEnvios();
  emailOcultarResultado();
};

async function emailCargarStats() {
  const key = `${emailAnio}-${String(emailMes).padStart(2,"0")}`;
  document.getElementById("emailStatCount").textContent   = "—";
  document.getElementById("emailStatTotal").textContent   = "—";
  document.getElementById("emailStatClientes").textContent = "—";

  if (emailStatsCache[key]) {
    emailRenderStats(emailStatsCache[key]);
    return;
  }
  try {
    const r = await fetch(`${BASE}/admin/facturas-mes?anio=${emailAnio}&mes=${emailMes}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error();
    const facturas = Array.isArray(j.facturas) ? j.facturas : [];
    const total    = facturas.reduce((a, f) => a + Number(f.total || 0), 0);
    const clientes = new Set(facturas.map(f => f.cuit || f.cuit_cliente || "").filter(Boolean)).size;
    const stats    = { count: facturas.length, total, clientes };
    emailStatsCache[key] = stats;
    if (key !== `${emailAnio}-${String(emailMes).padStart(2,"0")}`) return;
    emailRenderStats(stats);
  } catch { /* stats quedan en — */ }
}

function emailRenderStats(stats) {
  const fmtK = n => {
    if (Math.abs(n) >= 1000000) return `$${(n/1000000).toLocaleString("es-AR", { maximumFractionDigits: 1 })}M`;
    if (Math.abs(n) >= 1000)    return `$${Math.round(n/1000).toLocaleString("es-AR")}K`;
    return `$${formatMoneyAR(n)}`;
  };
  document.getElementById("emailStatCount").textContent    = stats.count;
  document.getElementById("emailStatTotal").textContent    = fmtK(stats.total);
  document.getElementById("emailStatClientes").textContent = stats.clientes;
  const sub = document.getElementById("emailPreviewSub");
  if (sub) sub.textContent = `${stats.count} comprobante${stats.count !== 1 ? "s" : ""} · $${formatMoneyAR(stats.total)}`;
  emailActualizarSendBtn();
}

function emailContarEnvios() {
  const el = document.getElementById("emailStatEnvios");
  if (!el) return;
  try {
    const hist = JSON.parse(localStorage.getItem(EMAIL_HIST_STORAGE_KEY) || "[]");
    el.textContent = hist.filter(h => Number(h.mes) === emailMes && Number(h.anio) === emailAnio).length;
  } catch { el.textContent = "0"; }
}

function emailRenderChips() {
  const container = document.getElementById("emailChips");
  if (!container) return;
  container.innerHTML = "";
  emailContactos.forEach((c, i) => {
    const div = document.createElement("div");
    div.className = `email-chip${c.activo ? " active" : ""}`;
    div.onclick = () => emailToggleContacto(i);
    div.innerHTML = `
      <div class="email-chip-check">${c.activo ? ico("check") : ""}</div>
      <div class="email-chip-info">
        <div class="email-chip-name">${escHtml(c.nombre)}</div>
        <div class="email-chip-addr">${escHtml(c.email)}</div>
      </div>
      ${c.id === "pablo" ? `<span class="tag">Principal</span>` : ""}
      ${c.removible ? `<button class="email-chip-remove" onclick="emailEliminarContacto(event,${i})" aria-label="Quitar">${ico("trash", "ic-sm")}</button>` : ""}
    `;
    container.appendChild(div);
  });
  emailActualizarSendBtn();
}

window.emailToggleContacto = function(i) {
  haptic();
  emailContactos[i].activo = !emailContactos[i].activo;
  emailGuardarContactos();
  emailRenderChips();
};

window.emailEliminarContacto = function(e, i) {
  e.stopPropagation();
  haptic();
  emailContactos.splice(i, 1);
  emailGuardarContactos();
  emailRenderChips();
};

window.emailAgregarDestinatario = function() {
  const input = document.getElementById("emailNuevoInput");
  const val   = (input?.value || "").trim().toLowerCase();
  if (!val || !val.includes("@") || !val.includes(".")) {
    showToast("⚠️ Ingresá un email válido", "error");
    return;
  }
  if (emailContactos.some(c => c.email.toLowerCase() === val)) {
    showToast("⚠️ Ese email ya está en la lista", "error");
    return;
  }
  haptic();
  const nombre = val.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, l => l.toUpperCase());
  emailContactos.push({ id: `custom_${Date.now()}`, nombre, email: val, activo: true, removible: true });
  emailGuardarContactos();
  emailRenderChips();
  if (input) input.value = "";
  showToast(`✅ ${val} agregado`, "success");
};

function emailActualizarSendBtn() {
  const btn       = document.getElementById("emailSendBtn");
  const activos   = emailContactos.filter(c => c.activo);
  const key       = `${emailAnio}-${String(emailMes).padStart(2,"0")}`;
  const stats     = emailStatsCache[key];
  if (!btn) return;
  btn.disabled    = activos.length === 0;
  if (activos.length === 0) {
    btn.innerHTML = `${ico("mail")}Elegí al menos un destinatario`;
  } else {
    const mesNom = MESES[emailMes];
    const cantStr = activos.length === 1 ? activos[0].nombre.split(" ")[0] : `${activos.length} destinatarios`;
    const factStr = stats ? ` · ${stats.count} comp.` : "";
    btn.innerHTML = `${ico("send")}Enviar resumen de ${mesNom}${factStr} a ${escHtml(cantStr)}`;
  }
}

function emailOcultarResultado() {
  const res = document.getElementById("emailSendResult");
  if (res) { res.className = "email-send-result"; res.innerHTML = ""; }
}

window.emailEnviar = async function() {
  const activos = emailContactos.filter(c => c.activo);
  if (activos.length === 0) return showToast("⚠️ Seleccioná al menos un destinatario", "error");
  haptic();

  const btn = document.getElementById("emailSendBtn");
  const oldHtml = btn.innerHTML;
  btn.disabled  = true;
  btn.innerHTML = `<span class="spinner spinner-sm"></span>Enviando...`;
  emailOcultarResultado();

  try {
    const r = await fetchWithRetry(
      `${BASE}/enviar-resumen`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes: emailMes, anio: emailAnio, destinatarios: activos.map(c => c.email) })
      },
      { maxRetries: 1, timeoutMs: 60000 }
    );
    const j = await r.json();
    const resultados = Array.isArray(j.resultados) ? j.resultados : [];

    // Guardar en historial local
    emailGuardarHistorial({ mes: emailMes, anio: emailAnio, resultados });

    const exitosos = resultados.filter(r => r.ok);
    const fallidos = resultados.filter(r => !r.ok);

    haptic(exitosos.length > 0 ? "success" : "error");

    let resHtml = "";
    if (exitosos.length > 0) {
      resHtml += `<div><strong>${j.simulado ? "Simulación: no se envió nada." : "Enviado correctamente a:"}</strong></div>`;
      resHtml += exitosos.map(r => `<div>• ${escHtml(r.email)}</div>`).join("");
    }
    if (fallidos.length > 0) {
      resHtml += `<div style="margin-top:${exitosos.length ? 8 : 0}px;"><strong>No se pudo enviar a:</strong></div>`;
      resHtml += fallidos.map(r => `<div>• ${escHtml(r.email)} <span class="muted">(${escHtml(r.error || "restricción del proveedor de email")})</span></div>`).join("");
    }

    const resEl = document.getElementById("emailSendResult");
    if (resEl) {
      resEl.className = `email-send-result show ${exitosos.length > 0 ? "ok" : "err"}`;
      resEl.innerHTML = resHtml;
    }

    emailRenderHistorial();
    emailContarEnvios();

  } catch (e) {
    haptic("error");
    showToast("❌ " + (e.message || "Error al enviar"), "error");
  } finally {
    btn.disabled  = false;
    btn.innerHTML = oldHtml;
    emailActualizarSendBtn();
  }
};

function emailGuardarHistorial(entry) {
  try {
    const hist = JSON.parse(localStorage.getItem(EMAIL_HIST_STORAGE_KEY) || "[]");
    hist.unshift({ ...entry, ts: Date.now() });
    if (hist.length > 30) hist.splice(30);
    localStorage.setItem(EMAIL_HIST_STORAGE_KEY, JSON.stringify(hist));
  } catch {}
}

function emailRenderHistorial() {
  const list = document.getElementById("emailHistList");
  if (!list) return;
  try {
    const hist = JSON.parse(localStorage.getItem(EMAIL_HIST_STORAGE_KEY) || "[]");
    if (hist.length === 0) {
      list.innerHTML = `<div class="email-hist-empty">Sin envíos registrados aún</div>`;
      return;
    }
    list.innerHTML = hist.slice(0, 20).map(h => {
      const fecha  = new Date(h.ts);
      const fechaStr = fecha.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit" });
      const horaStr  = fecha.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
      const chips    = (h.resultados || []).map(r =>
        `<span class="tag ${r.ok ? "tag-green" : "tag-red"} tag-dot" title="${escHtml(r.error || "")}">${escHtml(r.email)} · ${r.ok ? "enviado" : "falló"}</span>`
      ).join("");
      return `
        <div class="email-hist-item">
          <div class="email-hist-header">
            <div class="email-hist-mes">${MESES[h.mes] || "?"} ${h.anio}</div>
            <div class="email-hist-time">${fechaStr} ${horaStr}</div>
          </div>
          <div class="email-hist-chips">${chips || `<span class="muted">Sin destinatarios</span>`}</div>
        </div>`;
    }).join("");
  } catch { list.innerHTML = ""; }
}

function emailInicializar() {
  if (!emailIniciado) {
    emailCargarContactos();
    emailIniciado = true;
  }
  emailActualizarLabel();
  emailRenderChips();
  emailCargarStats();
  emailRenderHistorial();
  emailContarEnvios();
}

window.confirmarReenvioEmail = async function() {
  if (!facturaAReenviar) return;
  const emailDestino = document.getElementById("reenviarEmailInput").value.trim();
  if (!emailDestino || !emailDestino.includes("@")) {
    showToast("⚠️ Ingresá un email válido", "error");
    return;
  }

  const ref = { ...facturaAReenviar };
  cerrarModalReenviarEmail();

  const btn = document.getElementById("btnConfirmarReenvio");
  if (btn) { btn.disabled = true; btn.textContent = "Enviando..."; }

  try {
    const r = await fetchWithRetry(
      `${BASE}/reenviar-email`,
      { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comprobante: ref.comprobante, emailDestino }) },
      { maxRetries: 1, timeoutMs: 60000 }
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "Error al reenviar");
    haptic("success");
    showToast(`✅ Email enviado a ${emailDestino}`, "success");
    if (ref.cuit) saveEmailCuit(ref.cuit, emailDestino);
  } catch (e) {
    haptic("error");
    showToast("❌ " + (e.message || "Error al reenviar email"), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Enviar"; }
  }
};
