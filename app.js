// ============================================
// MERCADO LIMPIO - PWA v4
// Navegación de meses · Overlay NC · iPhone 14 Pro
// ============================================

const BASE = "https://api-mercadolimpio.onrender.com";

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
  t.innerText = msg;
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
async function pingServer() {
  const dot   = document.getElementById("statusDot");
  const label = document.getElementById("statusLabel");
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      serverAwake = true;
      if (dot)   dot.className     = "status-dot online";
      if (label) label.textContent = "Servidor activo";
    } else throw new Error();
  } catch {
    if (dot)   dot.className     = "status-dot offline";
    if (label) label.textContent = "Sin conexión";
  }
}
pingServer();
setInterval(pingServer, 9 * 60 * 1000);

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
  { icon: "📡", text: "Conectando con el servidor",    sub: "Verificando disponibilidad...",    color: "#636366" },
  { icon: "📋", text: "Preparando el comprobante",     sub: "Validando ítems y totales...",      color: "#007AFF" },
  { icon: "🏛️", text: "Enviando a AFIP / ARCA",       sub: "Transmitiendo datos fiscales...",   color: "#5856D6" },
  { icon: "⚙️", text: "ARCA está procesando",         sub: "Esto puede tomar unos segundos...", color: "#FF9500" },
  { icon: "🔐", text: "Solicitando autorización CAE", sub: "Esperando firma digital...",         color: "#FF6B00" },
  { icon: "📄", text: "Generando PDF oficial",         sub: "Creando el comprobante...",         color: "#34C759" },
  { icon: "📬", text: "Enviando por email",            sub: "Casi listo...",                     color: "#30B0C7" },
];

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
  btnEmitir.style.background = p.color;
  btnEmitir.style.boxShadow  = `0 8px 24px ${p.color}55`;
  btnEmitir.innerHTML = `
    <div class="spinner"></div>
    <div style="display:flex;flex-direction:column;align-items:flex-start;gap:1px;">
      <span style="font-size:14px;font-weight:800;letter-spacing:-0.2px;">${p.icon} ${p.text}</span>
      <span style="font-size:11px;opacity:0.72;font-weight:500;">${p.sub} · paso ${idx+1}/${PASOS.length}</span>
    </div>
  `;
}

function stopEmisionProgress() {
  clearInterval(_pasoInterval); _pasoInterval = null;
  btnEmitir.style.background = "";
  btnEmitir.style.boxShadow  = "";
}

function setBtnState(state, text) {
  stopEmisionProgress();
  btnEmitir.className = "main-btn";
  btnEmitir.disabled  = true;
  btnEmitir.style.background = "";
  btnEmitir.style.boxShadow  = "";
  if (state === "loading") {
    btnEmitir.classList.add("btn-loading");
    btnEmitir.innerHTML = `<div class="spinner"></div> ${text || "Procesando..."}`;
  } else if (state === "success") {
    btnEmitir.classList.add("btn-success");
    btnEmitir.innerHTML = `✅ ${text || "¡Completado!"}`;
    btnEmitir.disabled = false;
  } else {
    btnEmitir.innerHTML = text || "⚡ EMITIR FACTURA";
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
  if (fileBadge) { fileBadge.style.display = "block"; fileBadge.textContent = `📎 ${files.length} archivo(s) cargado(s)`; }
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
  let html = `<strong>📋 Extracción del remito</strong><br>`;
  if (res.cuit) html += `CUIT: <strong>${res.cuit}</strong><br>`;
  html += `Ítems: <strong>${items.length}</strong>`;
  if (subtotalBrutoGlobal > 0 && descuentoImporteGlobal > 0)
    html += ` · Subtotal: <strong>$${formatMoneyAR(subtotalBrutoGlobal)}</strong> · Dto: <strong>-$${formatMoneyAR(descuentoImporteGlobal)}</strong>`;
  if (totalFinalGlobal > 0) html += `<div class="summary-total">Total: $${formatMoneyAR(totalFinalGlobal)}</div>`;
  if (res.domicilioRemito) html += `<div class="domicilio-pdf">📍 ${res.domicilioRemito}</div>`;
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
  if (items.length === 0 && (!cuit || cuit.length < 11)) { btnOpenPreview.disabled = true; return; }

  computeTotalPartes();
  btnOpenPreview.disabled = false;
  btnOpenPreview.innerHTML = `👁️ Vista Previa (Parte ${parteActual}/${totalPartes})`;

  try {
    const totalComputed = round2(items.reduce((a, x) => a + Number(x.subtotalConIva || 0), 0));
    const totalToSend   = totalFinalGlobal > 0 ? totalFinalGlobal : totalComputed;
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
    }
  } catch (e) { console.warn("Preview:", e.message); }
}

window.openPreview = function () {
  haptic();
  document.getElementById("previewBackdrop").classList.add("active");
  document.getElementById("previewSheet").classList.add("active");
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
  document.getElementById("resumenModal").classList.add("active");
  await renderResumen();
};

window.cerrarResumen = function () {
  haptic();
  document.getElementById("resumenModal").classList.remove("active");
};

async function renderResumen() {
  const contenido = document.getElementById("resumenContenido");
  if (!contenido) return;

  // Skeleton loader mientras carga
  contenido.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:10px;margin-bottom:20px;">
      ${[1,2,3].map(() => `
        <div style="background:#fff;border-radius:16px;padding:18px 10px;box-shadow:0 2px 10px rgba(0,0,0,0.05);">
          <div class="skeleton" style="width:50%;margin:0 auto 8px;height:22px;"></div>
          <div class="skeleton" style="width:70%;margin:0 auto;height:10px;"></div>
        </div>`).join("")}
    </div>
    ${[1,2,3].map(() => `<div class="skeleton" style="height:82px;border-radius:16px;margin-bottom:9px;"></div>`).join("")}
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
      <div style="text-align:center;padding:60px 20px;color:#8E8E93;">
        <div style="font-size:52px;margin-bottom:14px;">📋</div>
        <div style="font-size:17px;font-weight:700;color:#1C1C1E;">Sin facturas en ${MESES[resumenMes]} ${resumenAnio}</div>
        <div style="font-size:14px;margin-top:6px;color:#8E8E93;">
          ${origen === "local" ? "Sin datos en servidor ni en este dispositivo" : "No hay comprobantes registrados para este mes"}
        </div>
      </div>`;
    return;
  }

  let html = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-num">${facturas.length}</div>
        <div class="kpi-label">Comprobantes</div>
      </div>
      <div class="kpi-card kpi-green">
        <div class="kpi-num-sm">$${formatMoneyAR(totalMes)}</div>
        <div class="kpi-label">Total del mes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">${cuitsSet.size}</div>
        <div class="kpi-label">Clientes</div>
      </div>
    </div>
    <div class="section-label">Comprobantes · ${origen === "server" ? "sincronizado" : "cache local"}</div>
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

    const emailTo   = f.emailTo || f.email_to || "";
    const factData = JSON.stringify({ comprobante, nombre, total: totalNum, nro, nroFactura: nro, puntoVenta: pv, cuit, emailTo }).replace(/'/g, "&apos;");

    html += `
      <div class="fact-row${estaAnulado ? " anulada" : ""}">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:6px;">
            <span style="overflow:hidden;text-overflow:ellipsis;">${nombre}</span>
            ${estaAnulado ? `<span style="flex-shrink:0;font-size:10px;font-weight:800;color:#FF3B30;background:#FFF1F0;padding:2px 7px;border-radius:999px;">ANULADA</span>` : ""}
            ${esNC ? `<span style="flex-shrink:0;font-size:10px;font-weight:800;color:#5856D6;background:#EEEEFF;padding:2px 7px;border-radius:999px;">NC</span>` : ""}
          </div>
          <div style="font-size:12px;color:#8E8E93;margin-top:3px;">${f.fecha || ""} · ${comprobante}</div>
          <div style="font-size:11px;color:#A0AEC0;font-family:monospace;margin-top:1px;">CAE: ${f.cae || "—"}</div>
          <div class="fact-actions">
            ${pdfUrl ? `<button class="fact-mini-btn pdf" onclick="window.open('${pdfUrl}','_blank')">📄 PDF</button>` : ""}
            ${!esNC && !estaAnulado && totalNum > 0 ? `<button class="fact-mini-btn anular" onclick='abrirModalAnular(${factData})'>⛔ NC</button>` : ""}
            ${!estaAnulado ? `<button class="fact-mini-btn" style="background:#EFF6FF;color:#1D4ED8;" onclick='abrirModalReenviarEmail(${factData})'>📧 Email</button>` : ""}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:12px;">
          <div style="font-weight:900;font-size:15px;color:${totalNum < 0 ? "#FF3B30" : "#1C1C1E"};">
            ${totalNum < 0 ? "-" : ""}$${formatMoneyAR(Math.abs(totalNum))}
          </div>
        </div>
      </div>`;
  }

  if (clientes.length > 1) {
    html += `<div class="section-label" style="margin-top:20px;">Por cliente</div>`;
    for (const c of clientes) {
      const pct = totalMes > 0 ? Math.round((c.total / totalMes) * 100) : 0;
      html += `
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:5px;">
            <span style="font-weight:700;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.nombre}</span>
            <span style="font-weight:900;font-size:13px;margin-left:8px;flex-shrink:0;">$${formatMoneyAR(c.total)}</span>
          </div>
          <div style="background:#F2F2F7;border-radius:6px;height:7px;overflow:hidden;">
            <div style="background:linear-gradient(90deg,#007AFF,#5856D6);height:100%;width:${pct}%;border-radius:6px;transition:width 0.8s cubic-bezier(.4,0,.2,1);"></div>
          </div>
          <div style="font-size:11px;color:#8E8E93;margin-top:3px;">${c.cant} comprobante(s) · ${pct}% del total</div>
        </div>`;
    }
  }

  contenido.innerHTML = html;
}

// ============================================
// PANTALLA DE ÉXITO
// ============================================
function showSuccessModal(data) {
  const modal      = document.getElementById("successModal");
  const actionsBox = document.getElementById("successActions");
  document.getElementById("successMsgText").innerText =
    data.mensaje || "Factura emitida correctamente. Podés descargar el PDF aunque el email falle.";
  actionsBox.innerHTML = "";

  const cuitUsado   = document.getElementById("cuit")?.value?.trim()  || data.receptor?.cuit  || "";
  const emailUsado  = document.getElementById("email")?.value?.trim() || "";
  const nombreUsado = data.receptor?.nombre || (cuitUsado ? `CUIT ${cuitUsado}` : "");

  const facturas = Array.isArray(data.facturas) ? data.facturas : [];

  if (data.waLink) {
    const btn = document.createElement("a");
    btn.className = "action-btn btn-wa";
    btn.href = data.waLink; btn.target = "_blank";
    btn.innerHTML = `📱 Enviar resumen por WhatsApp`;
    actionsBox.appendChild(btn);
  }

  facturas.forEach((f, idx) => {
    if (!f.pdfUrl) return;

    if (navigator.share) {
      const btnShare = document.createElement("button");
      btnShare.className = "action-btn btn-download";
      btnShare.innerHTML = `📤 Compartir PDF${facturas.length > 1 ? ` (Parte ${idx+1})` : ""} · $${formatMoneyAR(f.total)}`;
      btnShare.onclick = async () => {
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
      actionsBox.appendChild(btnShare);
    }

    const btnPdf = document.createElement("a");
    btnPdf.className = "action-btn btn-download";
    btnPdf.href = f.pdfUrl; btnPdf.target = "_blank"; btnPdf.download = `Factura_${f.nroFactura||idx+1}.pdf`;
    btnPdf.innerHTML = `📄 Abrir PDF${facturas.length > 1 ? ` (Parte ${idx+1})` : ""} · $${formatMoneyAR(f.total)}`;
    actionsBox.appendChild(btnPdf);

    const btnWaPdf = document.createElement("a");
    btnWaPdf.className = "action-btn btn-wa"; btnWaPdf.style.opacity = "0.82";
    btnWaPdf.href = `https://wa.me/?text=${encodeURIComponent(`Factura Mercado Limpio\nTotal: $${formatMoneyAR(f.total)}\nCAE: ${f.cae}\nPDF: ${f.pdfUrl}`)}`;
    btnWaPdf.target = "_blank";
    btnWaPdf.innerHTML = `💬 Enviar link PDF por WhatsApp${facturas.length > 1 ? ` (Parte ${idx+1})` : ""}`;
    actionsBox.appendChild(btnWaPdf);
  });

  if (facturas.length > 0) {
    const factLines = facturas.map(f => `• ${f.comprobante || ""} · $${formatMoneyAR(f.total)}`).join("\n");
    const msgOficina =
      `✅ *Factura emitida - Mercado Limpio*\n` +
      `Cliente: ${nombreUsado}\n` +
      `CUIT: ${cuitUsado}\n` +
      `${factLines}\n` +
      (emailUsado ? `📧 Email enviado a: ${emailUsado}` : `📧 Sin email registrado`);
    const btnOficina = document.createElement("a");
    btnOficina.className = "action-btn btn-wa";
    btnOficina.style.marginTop = "4px";
    btnOficina.href = `https://wa.me/5491133395487?text=${encodeURIComponent(msgOficina)}`;
    btnOficina.target = "_blank";
    btnOficina.innerHTML = `📲 Avisar a Oficina`;
    actionsBox.appendChild(btnOficina);

    const info = document.createElement("div");
    info.style = "margin:14px 0 6px;padding:14px;background:#F8FAFC;border-radius:14px;font-size:12px;color:#475569;line-height:1.9;font-family:monospace;border:1px solid #E2E8F0;";
    info.innerHTML = facturas.map((f, i) =>
      `<strong>Parte ${i+1}:</strong> Nro ${String(f.nroFactura||"").padStart(8,"0")} · CAE: ${f.cae} · $${formatMoneyAR(f.total)}`
    ).join("<br>");
    actionsBox.appendChild(info);
  }

  const btnReset = document.createElement("button");
  btnReset.className = "action-btn btn-close-success";
  btnReset.innerHTML = "📋 Emitir Otra Factura";
  btnReset.onclick = () => { haptic(); window.location.reload(); };
  actionsBox.appendChild(btnReset);

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
          puntoVenta: Number(pv), nroFactura: Number(nro),
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

  document.getElementById("tabFacturar").style.display     = isFacturar  ? "block" : "none";
  document.getElementById("tabExtracto").style.display     = isExtracto  ? "flex"  : "none";
  document.getElementById("tabHistorial").style.display    = isHistorial ? "flex"  : "none";
  document.getElementById("tabEmail").style.display        = isEmail     ? "flex"  : "none";
  document.getElementById("bottomBarFacturar").style.display = isFacturar  ? "block" : "none";
  document.getElementById("bottomBarExtracto").style.display = isExtracto  ? "block" : "none";

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
  badge.style.display = "block";
  badge.textContent = `📎 ${f.name} (${(f.size / 1024).toFixed(0)} KB)`;
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
  btn.innerHTML = `<div class="spinner" style="border-color:rgba(255,255,255,0.3);border-top-color:#fff;width:18px;height:18px;"></div> Subiendo...`;

  try {
    const formData = new FormData();
    formData.append("extracto", file);

    // Solo sube el archivo — el servidor responde con jobId al instante
    const r = await fetchWithRetry(
      `${BASE}/procesar-extracto`,
      { method: "POST", body: formData },
      { maxRetries: 2, timeoutMs: 20000 }
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "Error al subir");

    // Mostrar pantalla de análisis con polling
    btn.innerHTML = `<div class="spinner" style="border-color:rgba(255,255,255,0.3);border-top-color:#fff;width:18px;height:18px;"></div> Analizando...`;
    await extEsperarAnalisis(j.jobId, btn);

  } catch (e) {
    showToast("❌ " + (e.message || "Error"), "error");
    btn.disabled = false;
    btn.innerHTML = "🔍 ANALIZAR CON IA";
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
            btn.innerHTML = "🔍 ANALIZAR CON IA";
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
        btn.innerHTML = "🔍 ANALIZAR CON IA";
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
  extBtn.style.opacity = extBtn.disabled ? "0.55" : "1";

  const btnTodo = document.getElementById("extBtnFacturarTodo");
  if (btnTodo) {
    const candidatasTodo = extTodasTransferencias.filter(t =>
      String(t.cuit || "").replace(/\D/g, "").length === 11 && !t.yaFacturado && Number(t.monto) > 0
    );
    btnTodo.style.display = "flex";
    btnTodo.disabled = candidatasTodo.length === 0;
    btnTodo.style.opacity = btnTodo.disabled ? "0.55" : "1";
    btnTodo.innerHTML = candidatasTodo.length > 0
      ? `🏦 FACTURAR TODO (${candidatasTodo.length})`
      : `🏦 FACTURAR TODO CON CUIT`;
  }

  // Barra de total en el bottom bar (siempre visible antes de facturar)
  const bottomBar = document.getElementById("extBottomTotalBar");
  const bottomCount = document.getElementById("extBottomCount");
  const bottomTotal = document.getElementById("extBottomTotal");
  if (bottomBar) {
    bottomBar.style.display = incluidas.length > 0 ? "flex" : "none";
    if (bottomCount) bottomCount.textContent = `${incluidas.length} transferencia${incluidas.length !== 1 ? "s" : ""}`;
    if (bottomTotal) bottomTotal.textContent = `$${formatMoneyAR(total)}`;
  }

  extTransferencias.forEach(t => {
    const div = document.createElement("div");
    const sinCuit = !t.cuitEdit;
    const emailGuardado = t.cuitEdit.length === 11 ? getEmailForCuit(t.cuitEdit) : "";
    div.className = `transfer-card${sinCuit ? " sin-cuit" : ""}${!t.incluida ? " excluida" : ""}`;

    const avatarLetter = (t.nombre || "?").trim().charAt(0).toUpperCase();
    div.innerHTML = `
      <div class="tc-main">
        <div class="tc-avatar">${avatarLetter}</div>
        <div class="tc-info">
          <div class="tc-nombre">${t.nombre}</div>
          <div class="tc-meta">${t.fecha || "Sin fecha"}${t.descripcion ? " · " + t.descripcion : ""}</div>
          ${t.yaFacturado ? `<div class="tc-ya-fac">✅ Ya facturada este mes — excluida por defecto</div>` : ""}
        </div>
        <div class="tc-monto">$${formatMoneyAR(t.monto)}</div>
      </div>
      <div class="tc-bottom">
        <div class="tc-cuit-row">
          <input class="transfer-cuit-input" type="tel" inputmode="numeric" maxlength="11"
            placeholder="CUIT (11 dígitos)" value="${t.cuitEdit}"
            onchange="extUpdateCuit(${t.id}, this.value)"
            oninput="extUpdateCuit(${t.id}, this.value)" />
          <button class="transfer-toggle${t.incluida ? " incluida" : ""}"
            onclick="extToggleTransfer(${t.id})">
            ${t.incluida ? "✓ Incluida" : "Excluida"}
          </button>
        </div>
        ${emailGuardado ? `<div class="tc-email">📧 ${emailGuardado}</div>` : ""}
        ${sinCuit && !t.yaFacturado ? `<div class="tc-alert">⚠️ Ingresá el CUIT para incluir</div>` : ""}
      </div>
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
        card.classList.toggle("sin-cuit", t.cuitEdit.length !== 11);
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
  document.getElementById("extStep2").classList.remove("active");
  document.getElementById("extStep1").classList.add("active");
  document.getElementById("extFileBadge").style.display = "none";
  document.getElementById("extFileInput").value = "";
  const bottomBar = document.getElementById("extBottomTotalBar");
  if (bottomBar) bottomBar.style.display = "none";
  const btn = document.getElementById("extBtnProcesar");
  btn.disabled = true;
  btn.innerHTML = "🔍 ANALIZAR CON IA";
};

// ── Paso 3: Facturar (fire-and-forget con job polling) ────────
window.extFacturar = async function() {
  const incluidas = extTransferencias.filter(t => t.incluida && t.cuitEdit.length === 11 && t.monto > 0);
  if (incluidas.length === 0) return showToast("No hay transferencias válidas para facturar", "error");

  haptic();
  const btn = document.getElementById("extBtnFacturar");
  btn.disabled = true;
  btn.innerHTML = `<div class="spinner" style="border-color:rgba(255,255,255,0.3);border-top-color:#fff;width:18px;height:18px;"></div> Iniciando...`;

  try {
    const payload = {
      transferencias: incluidas.map(t => {
        const savedEmail = getEmailForCuit(t.cuitEdit);
        const obj = { cuit: t.cuitEdit, monto: t.monto, nombre: t.nombre, fecha: t.fecha || "" };
        if (savedEmail) obj.email = savedEmail;
        return obj;
      }),
      todasTransferencias: extTodasTransferencias.map(t => ({
        cuit:   t.cuit   || "",
        monto:  t.monto  || 0,
        nombre: t.nombre || "",
        fecha:  t.fecha  || ""
      })),
      condicionVenta: "Transferencia Bancaria",
      emailReporte: "santamariapablodaniel@gmail.com"
    };

    // El servidor responde con jobId inmediatamente
    const r = await fetchWithRetry(
      `${BASE}/facturar-extracto`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { maxRetries: 1, timeoutMs: 15000 }
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "Error al iniciar");

    haptic("success");
    await extMostrarProgreso(j.jobId, j.total);

  } catch (e) {
    showToast("❌ " + (e.message || "Error"), "error");
    btn.disabled = false;
    btn.innerHTML = `⚡ FACTURAR SELECCIONADAS`;
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
  confirmar.style.opacity = confirmar.disabled ? "0.55" : "1";

  lista.innerHTML = (extCandidatasTodo.length ? extCandidatasTodo.map(t => `
    <div class="rev-card">
      <div class="rev-avatar">${(t.nombre||"?").trim().charAt(0).toUpperCase()}</div>
      <div class="rev-info">
        <div class="rev-nombre">${t.nombre}</div>
        <div class="rev-sub">${t.fecha || ""} · CUIT ${t.cuit}</div>
      </div>
      <div class="rev-right">
        <div class="rev-monto">$${formatMoneyAR(t.monto)}</div>
        <button class="rev-remove" onclick="extQuitarCandidataTodo(${t._id})">✕</button>
      </div>
    </div>
  `).join("") : `<div style="text-align:center;padding:32px;color:var(--text2);font-size:13px;font-weight:600;">Sin candidatas</div>`);
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
  btn.innerHTML = `<div class="spinner" style="border-color:rgba(255,255,255,0.3);border-top-color:#fff;width:18px;height:18px;"></div> Iniciando...`;

  try {
    const payload = {
      transferencias: extCandidatasTodo.map(t => {
        const savedEmail = getEmailForCuit(t.cuit);
        const obj = { cuit: t.cuit, monto: t.monto, nombre: t.nombre, fecha: t.fecha || "" };
        if (savedEmail) obj.email = savedEmail;
        return obj;
      }),
      todasTransferencias: extTodasTransferencias.map(t => ({
        cuit: t.cuit || "", monto: t.monto || 0, nombre: t.nombre || "", fecha: t.fecha || ""
      })),
      condicionVenta: "Transferencia Bancaria",
      emailReporte: "santamariapablodaniel@gmail.com"
    };

    const r = await fetchWithRetry(
      `${BASE}/facturar-extracto`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { maxRetries: 1, timeoutMs: 15000 }
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "Error al iniciar");

    haptic("success");
    await extMostrarProgreso(j.jobId, j.total);
  } catch (e) {
    showToast("❌ " + (e.message || "Error"), "error");
    btn.disabled = false;
    const n = extCandidatasTodo.length;
    btn.innerHTML = `🏦 FACTURAR TODO (${n})`;
  }
};

// ── Pantalla de progreso con polling ──────────────────────────
async function extMostrarProgreso(jobId, total) {
  document.getElementById("extStep2").classList.remove("active");
  document.getElementById("extStep3").classList.add("active");
  document.getElementById("extBtnFacturar").style.display = "none";
  const btnTodoP = document.getElementById("extBtnFacturarTodo");
  if (btnTodoP) btnTodoP.style.display = "none";

  const container = document.getElementById("extResultados");
  container.innerHTML = `
    <div style="text-align:center;padding:32px 16px;">
      <div class="spinner" style="width:44px;height:44px;border-width:4px;margin:0 auto 20px;border-color:rgba(52,199,89,0.3);border-top-color:#34C759;"></div>
      <div id="extProgresoTexto" style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:6px;">Iniciando proceso...</div>
      <div id="extProgresoCount" style="font-size:13px;color:var(--text2);margin-bottom:16px;">0 / ${total}</div>
      <div style="background:#e2e8f0;border-radius:8px;height:8px;overflow:hidden;margin-bottom:12px;">
        <div id="extProgresoBar" style="background:#34C759;height:100%;width:0%;transition:width 0.6s ease;border-radius:8px;"></div>
      </div>
      <div id="extProgresoDetalle" style="font-size:12px;color:var(--text2);line-height:1.6;"></div>
      <div style="margin-top:16px;padding:12px;background:#F0FDF4;border-radius:10px;border:1px solid #BBF7D0;font-size:12px;color:#15803D;font-weight:600;">
        📱 Podés guardar el celular — el servidor sigue procesando
      </div>
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
      if (txtEl) txtEl.textContent = estado.estado === "terminado" ? "✅ Proceso completado" : `Procesando... ${pct}%`;
      if (cntEl) cntEl.textContent = `${estado.progreso} / ${estado.total}`;
      if (detEl) detEl.innerHTML =
        `${estado.facturasEmitidas || 0} emitidas · ${estado.omitidas || 0} ya facturadas · ${estado.errores || 0} errores`;

      fallos = 0;

      if (estado.estado === "terminado" || estado.estado === "error") {
        haptic("success");
        extRenderResultados(estado);
        return;
      }
    } catch (e) {
      fallos++;
      if (fallos >= 3) {
        const detEl = document.getElementById("extProgresoDetalle");
        if (detEl) detEl.innerHTML = `⚠️ Sin conexión — el proceso sigue en el servidor.<br>Cuando vuelvas a abrir la app vas a ver el resultado.`;
      }
    }
  }
}

function extRenderResultados(data) {
  document.getElementById("extStep2").classList.remove("active");
  document.getElementById("extStep3").classList.add("active");
  document.getElementById("extBtnFacturar").style.display = "none";
  const btnTodoR = document.getElementById("extBtnFacturarTodo");
  if (btnTodoR) btnTodoR.style.display = "none";

  const container = document.getElementById("extResultados");
  const emitidas = (data.resultados || []).filter(r => r.ok && !r.skipped);
  const omitidas = (data.resultados || []).filter(r => r.skipped);
  const errores  = (data.resultados || []).filter(r => !r.ok);

  let html = `
    <div class="ext-summary-bar" style="margin-bottom:16px;">
      <div><div class="lbl">Facturas emitidas</div><div class="val">${emitidas.length}</div></div>
      <div style="text-align:right;"><div class="lbl">Total facturado</div><div class="val">$${formatMoneyAR(data.totalFacturado || 0)}</div></div>
    </div>
    ${omitidas.length > 0 ? `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:12px;color:#64748B;font-weight:600;">
      ✅ ${omitidas.length} ya facturada${omitidas.length !== 1 ? "s" : ""} este mes — omitidas para no duplicar
    </div>` : ""}
    <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px;">Comprobantes emitidos</div>
  `;

  emitidas.forEach(r => {
    const ini = (r.nombre||"?").trim().charAt(0).toUpperCase();
    html += `
      <div class="ext-result-card" style="display:flex;align-items:center;gap:12px;">
        <div style="width:42px;height:42px;border-radius:13px;flex-shrink:0;background:linear-gradient(135deg,#065f46,#059669);color:#FFF;font-size:18px;font-weight:800;display:flex;align-items:center;justify-content:center;">${ini}</div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:14px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.nombre}</div>
          <div style="font-size:11px;color:var(--text2);margin-top:2px;">${r.comprobante} · CAE ${r.cae}</div>
          <div style="font-size:16px;font-weight:800;color:var(--green);margin-top:5px;">$${formatMoneyAR(r.total)}</div>
        </div>
        ${r.pdfUrl ? `<button class="fact-mini-btn pdf" onclick="window.open('${r.pdfUrl}','_blank')" style="flex-shrink:0;">📄 PDF</button>` : ""}
      </div>`;
  });

  if (errores.length > 0) {
    html += `<div style="font-size:12px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:0.6px;margin:16px 0 8px;">Con error (${errores.length})</div>`;
    errores.forEach(r => {
      const ini = (r.nombre||"?").trim().charAt(0).toUpperCase();
      html += `
        <div class="ext-result-card error" style="display:flex;align-items:center;gap:12px;">
          <div style="width:42px;height:42px;border-radius:13px;flex-shrink:0;background:linear-gradient(135deg,#7f1d1d,#dc2626);color:#FFF;font-size:18px;font-weight:800;display:flex;align-items:center;justify-content:center;">${ini}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:800;font-size:14px;color:var(--text);">${r.nombre}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px;">CUIT: ${r.cuit}</div>
            <div style="font-size:12px;color:var(--red);margin-top:5px;font-weight:600;">❌ ${r.error}</div>
          </div>
        </div>`;
    });
  }

  html += `<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:12px;padding:12px 16px;margin-top:16px;font-size:13px;color:#15803D;font-weight:600;">
    📧 Se envió el reporte consolidado por email.
  </div>`;

  container.innerHTML = html;
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
  btn.innerHTML = "⚡ FACTURAR SELECCIONADAS";
  const btnTodoReset = document.getElementById("extBtnFacturarTodo");
  if (btnTodoReset) { btnTodoReset.disabled = true; btnTodoReset.style.display = "none"; btnTodoReset.innerHTML = "🏦 FACTURAR TODO CON CUIT"; }
  extCandidatasTodo = [];
  document.getElementById("revisionTodoBackdrop")?.classList.remove("active");
  document.getElementById("revisionTodoSheet")?.classList.remove("active");
  const procBtn = document.getElementById("extBtnProcesar");
  procBtn.disabled = true;
  procBtn.innerHTML = "🔍 ANALIZAR CON IA";
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

// ── Cargar resultados desde el backend ───────────────────────
async function histCargar() {
  const list = document.getElementById("histList");
  // Mostrar skeleton
  list.innerHTML = [1,2,3,4].map(() => `<div class="hist-skel"></div>`).join("");
  document.getElementById("histStatBar").style.display = "none";

  try {
    const params = new URLSearchParams({ mes: histMes, anio: histAnio });
    if (histQ) params.set("q", histQ);
    const r = await fetch(`${BASE}/historial?${params}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "Error");
    histRenderList(j.facturas || [], j.total || 0);
  } catch (e) {
    list.innerHTML = `<div class="hist-empty">
      <div class="icon">⚠️</div>
      <p>No se pudo cargar el historial</p>
      <small>${e.message}</small>
    </div>`;
  }
}

// ── Renderizar lista ──────────────────────────────────────────
function histRenderList(facturas, totalCount) {
  const list = document.getElementById("histList");
  histActualizarLabel();

  // Stats
  const factSolo  = facturas.filter(f => f.tipoCbte === "FA" && !f.anulado);
  const ncSolo    = facturas.filter(f => f.tipoCbte === "NC");
  const totalPesos = factSolo.reduce((s, f) => s + f.total, 0);
  const statBar = document.getElementById("histStatBar");
  statBar.style.display = "flex";
  document.getElementById("histStatCount").textContent = factSolo.length;
  document.getElementById("histStatTotal").textContent = `$${formatMoneyAR(totalPesos)}`;
  document.getElementById("histStatNCs").textContent   = ncSolo.length;

  if (facturas.length === 0) {
    list.innerHTML = `<div class="hist-empty">
      <div class="icon">${histQ ? "🔍" : "📭"}</div>
      <p>${histQ ? `Sin resultados para "${histQ}"` : "Sin comprobantes este mes"}</p>
      <small>${histQ ? "Probá buscar por CUIT completo o parte del nombre" : "Navegá a otro mes con las flechas"}</small>
    </div>`;
    return;
  }

  list.innerHTML = facturas.map(f => {
    const esNC     = f.tipoCbte === "NC";
    const esAnul   = f.anulado;
    const esExtrac = (f.condicionVenta || "").includes("EXTRACTO");
    const totalFmt = `$${formatMoneyAR(Math.abs(f.total))}`;
    const badgesHtml = [
      `<span class="hist-badge comp">${f.comprobante}</span>`,
      esNC     ? `<span class="hist-badge nc">Nota de Crédito</span>` : "",
      esAnul   ? `<span class="hist-badge anu">Anulada</span>` : "",
      esExtrac ? `<span class="hist-badge ext">Extracto</span>` : "",
      f.pdfUrl ? `<span class="hist-badge pdf">PDF ✓</span>` : "",
    ].filter(Boolean).join("");

    const avatarInit = (f.nombre || f.cuit || "?").trim().charAt(0).toUpperCase();
    return `<div class="hist-card ${esNC ? "nc" : ""} ${esAnul ? "anulada" : ""}"
                 onclick="histAbrirDetalle(${facturas.indexOf(f)})">
      <div class="hc-avatar">${avatarInit}</div>
      <div class="hc-body">
        <div class="hc-top">
          <div class="hc-nombre">${f.nombre || f.cuit || "Sin nombre"}</div>
          <div class="hc-total ${esNC ? "nc" : ""}">${esNC ? "−" : ""}${totalFmt}</div>
        </div>
        <div class="hc-meta">CUIT ${f.cuit} · ${f.fecha}</div>
        <div class="hc-badges">${badgesHtml}</div>
      </div>
    </div>`;
  }).join("");

  // Guardar facturas en variable global para acceder desde los callbacks
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

  document.getElementById("histDetTipo").textContent  = esNC ? "NOTA DE CRÉDITO" : "FACTURA M";
  document.getElementById("histDetNombre").textContent = f.nombre || "Sin nombre";
  document.getElementById("histDetSub").textContent   = `CUIT ${f.cuit}`;
  document.getElementById("histDetTotal").textContent  = `${esNC ? "−" : ""}$${formatMoneyAR(Math.abs(f.total))}`;
  document.getElementById("histDetFecha").textContent  = f.fecha;
  document.getElementById("histDetComp").textContent   = f.comprobante;
  document.getElementById("histDetCuit").textContent   = f.cuit;
  document.getElementById("histDetCae").textContent    = f.cae || "—";
  document.getElementById("histDetCond2").textContent  = f.condicionVenta || "—";
  document.getElementById("histDetEmail").textContent  = f.emailTo || "—";

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
  if (!histFacturaActual) return;
  histCerrarDetalle();
  abrirModalReenviarEmail(histFacturaActual);
};

window.histAnular = function() {
  if (!histFacturaActual) return;
  histCerrarDetalle();
  // Reutilizamos el modal existente de anulación
  facturaAAnular = histFacturaActual;
  document.getElementById("anularTextoInfo").innerHTML =
    `Se va a anular <strong>${histFacturaActual.comprobante}</strong> · ${histFacturaActual.nombre || histFacturaActual.cuit}<br>` +
    `<span style="color:var(--text2);font-size:12px;">Total: $${formatMoneyAR(histFacturaActual.total)}</span>`;
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
    emailRenderStats(stats);
  } catch { /* stats quedan en — */ }
}

function emailRenderStats(stats) {
  const fmtK = n => {
    if (Math.abs(n) >= 1000000) return `$${(n/1000000).toFixed(1)}M`;
    if (Math.abs(n) >= 1000)    return `$${(n/1000).toFixed(0)}K`;
    return `$${formatMoneyAR(n)}`;
  };
  document.getElementById("emailStatCount").textContent    = stats.count;
  document.getElementById("emailStatTotal").textContent    = fmtK(stats.total);
  document.getElementById("emailStatClientes").textContent = stats.clientes;
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
      <div class="email-chip-check">${c.activo ? "✓" : ""}</div>
      <div class="email-chip-info">
        <div class="email-chip-name">${c.nombre}</div>
        <div class="email-chip-addr">${c.email}</div>
      </div>
      ${c.removible ? `<button class="email-chip-remove" onclick="emailEliminarContacto(event,${i})">×</button>` : ""}
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
    btn.innerHTML = "📧 Seleccioná al menos un destinatario";
  } else {
    const mesNom = MESES[emailMes];
    const cantStr = activos.length === 1 ? activos[0].nombre.split(" ")[0] : `${activos.length} destinatarios`;
    const factStr = stats ? ` · ${stats.count} comp.` : "";
    btn.innerHTML = `📧 Enviar Resumen ${mesNom}${factStr} → ${cantStr}`;
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
  btn.innerHTML = `<div class="spinner" style="width:18px;height:18px;border-color:rgba(255,255,255,0.3);border-top-color:#fff;"></div> Enviando...`;
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
      resHtml += `<div style="margin-bottom:6px;">✅ Enviado correctamente a:</div>`;
      resHtml += exitosos.map(r => `<div style="font-size:12px;opacity:0.85;margin-left:14px;">• ${r.email}</div>`).join("");
    }
    if (fallidos.length > 0) {
      resHtml += `<div style="margin-top:${exitosos.length?8:0}px;margin-bottom:4px;">⚠️ No se pudo enviar a:</div>`;
      resHtml += fallidos.map(r => `<div style="font-size:12px;opacity:0.85;margin-left:14px;">• ${r.email}<br><span style="font-size:11px;opacity:0.7;">${r.error || "Restricción del proveedor de email"}</span></div>`).join("");
    }

    const resEl = document.getElementById("emailSendResult");
    if (resEl) {
      resEl.className = `email-send-result show ${exitosos.length > 0 ? "ok" : "err"}`;
      resEl.innerHTML = resHtml;
    }

    emailRenderHistorial();

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
        `<span class="email-hist-chip ${r.ok ? "ok" : "err"}">${r.ok ? "✓" : "✗"} ${r.email.split("@")[0]}</span>`
      ).join("");
      return `
        <div class="email-hist-item">
          <div class="email-hist-header">
            <div class="email-hist-mes">${MESES[h.mes] || "?"} ${h.anio}</div>
            <div class="email-hist-time">${fechaStr} ${horaStr}</div>
          </div>
          <div class="email-hist-chips">${chips || "<span style='font-size:11px;color:var(--text2)'>Sin destinatarios</span>"}</div>
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
