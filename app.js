// ============================================
// MERCADO LIMPIO - MOTOR PWA v3
// Progreso real en botón + Panel resumen mensual
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

window.abrirModalAnular = function(factura) {
  haptic();
  facturaAAnular = factura;
  document.getElementById("anularMotivo").value = "Factura emitida por error";
  document.getElementById("anularTextoInfo").innerHTML =
    `Se va a anular el comprobante <strong>${factura.comprobante || `A-${String(factura.puntoVenta || "").padStart(5,"0")}-${String(factura.nro || "").padStart(8,"0")}`}</strong><br>` +
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
  const btn = document.getElementById("btnConfirmarAnular");

  btn.disabled = true;
  btn.textContent = "Anulando...";

  try {
    const payload = {
      comprobante: facturaAAnular.comprobante,
      puntoVenta: facturaAAnular.puntoVenta || extraerPVDesdeComprobante(facturaAAnular.comprobante),
      nroFactura: facturaAAnular.nro || facturaAAnular.nroFactura || extraerNroDesdeComprobante(facturaAAnular.comprobante),
      motivo
    };

    const r = await fetchWithRetry(
      `${BASE}/anular-comprobante`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      },
      { maxRetries: 1, timeoutMs: 180000 }
    );

    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.message || "No se pudo anular");

   // Marcar factura original como anulada y agregar la NC al historial local
try {
  const raw = localStorage.getItem("ml_historial") || "{}";
  const hist = JSON.parse(raw);
  const mesKey = getMesKey();

  if (!hist[mesKey]) hist[mesKey] = [];

  hist[mesKey] = hist[mesKey].map(x => {
    if (String(x.comprobante || "") === String(facturaAAnular.comprobante || "")) {
      return {
        ...x,
        anulado: true
      };
    }
    return x;
  });

  if (j.notaCredito) {
    const nc = j.notaCredito;
    const compNC = nc.comprobante || `NC-${String(nc.puntoVenta || 0).padStart(5, "0")}-${String(nc.nroFactura || 0).padStart(8, "0")}`;

    const yaExisteNC = hist[mesKey].some(x =>
      String(x.comprobante || "") === String(compNC)
    );

    if (!yaExisteNC) {
      hist[mesKey].push({
        fecha: nc.fecha || new Date().toISOString().split("T")[0],
        comprobante: compNC,
        tipoCbte: "NC",
        puntoVenta: Number(nc.puntoVenta || 0),
        nroFactura: Number(nc.nroFactura || 0),
        nro: Number(nc.nroFactura || 0),
        cae: nc.cae || "",
        cuit: facturaAAnular.cuit || "",
        nombre: facturaAAnular.nombre || "Sin nombre",
        total: Number(nc.total || 0) * -1,
        pdfUrl: nc.pdfUrl || "",
      });
    }
  }

  localStorage.setItem("ml_historial", JSON.stringify(hist));
} catch (e) {
  console.warn("No pude actualizar historial local tras anulación:", e?.message || e);
}

cerrarModalAnular();
showToast("✅ Comprobante anulado con Nota de Crédito", "success");

if (j.notaCredito?.pdfUrl) {
  setTimeout(() => {
    window.open(j.notaCredito.pdfUrl, "_blank");
  }, 350);
}

renderResumen();
    
  } catch (e) {
    showToast("❌ " + (e.message || "Error al anular"), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Anular";
  }
};

function extraerPVDesdeComprobante(comp) {
  const m = String(comp || "").match(/-(\d{5})-(\d{8})$/);
  return m ? Number(m[1]) : 0;
}

function extraerNroDesdeComprobante(comp) {
  const m = String(comp || "").match(/-(\d{5})-(\d{8})$/);
  return m ? Number(m[2]) : 0;
}

const fileInput      = document.getElementById("fileRemito");
const cuitInput      = document.getElementById("cuit");
const montoInput     = document.getElementById("monto");
const detalleInput   = document.getElementById("detalle");
const btnEmitir      = document.getElementById("btnEmitir");
const btnOpenPreview = document.getElementById("btnOpenPreview");

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

// ═══════════════════════════════════════════════════════════════
// PASOS DE PROGRESO — animación narrativa durante la emisión
// ═══════════════════════════════════════════════════════════════
const PASOS = [
  { icon: "📡", text: "Conectando con el servidor",    sub: "Verificando disponibilidad...", color: "#636366" },
  { icon: "📋", text: "Preparando el comprobante",     sub: "Validando ítems y totales...",  color: "#007AFF" },
  { icon: "🏛️", text: "Enviando a AFIP / ARCA",       sub: "Transmitiendo datos fiscales...", color: "#5856D6" },
  { icon: "⚙️", text: "ARCA está procesando",         sub: "Esto puede tomar unos segundos...", color: "#FF9500" },
  { icon: "🔐", text: "Solicitando autorización CAE", sub: "Esperando firma digital...",     color: "#FF6B00" },
  { icon: "📄", text: "Generando PDF oficial",         sub: "Creando el comprobante...",     color: "#34C759" },
  { icon: "📬", text: "Enviando por email",            sub: "Casi listo...",                 color: "#30B0C7" },
];

let _pasoInterval = null;
let _pasoActual = 0;
let _pasoTs = 0;

function startEmisionProgress() {
  _pasoActual = 0;
  _pasoTs = Date.now();
  renderPaso(0);
  // Animación visual del botón durante la emisión
  _pasoInterval = setInterval(() => {
    const s = (Date.now() - _pasoTs) / 1000;
    if (s > 5  && _pasoActual < 1) renderPaso(1);
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
  clearInterval(_pasoInterval);
  _pasoInterval = null;
  btnEmitir.style.background = "";
  btnEmitir.style.boxShadow  = "";
}

// Mapea el texto de progreso del servidor a un paso visual
function renderPasoFromText(progressText) {
  const t = String(progressText || "").toLowerCase();
  if (t.includes("punto de venta") || t.includes("iniciando"))      renderPaso(0);
  else if (t.includes("padrón") || t.includes("padron"))            renderPaso(1);
  else if (t.includes("autorizando") || t.includes("voucher"))      renderPaso(2);
  else if (t.includes("cae obtenido") || t.includes("generando pdf")) renderPaso(3);
  else if (t.includes("pdf generado") || t.includes("guardando"))   renderPaso(4);
  else if (t.includes("email") || t.includes("enviando"))           renderPaso(5);
  else if (t.includes("factura autorizada") || t.includes("listo")) renderPaso(6);
}

// (pollJob eliminado — arquitectura sincrónica)

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

// ── Keep-alive ─────────────────────────────────────────────────
async function pingServer() {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(8000) });
    const dot   = document.getElementById("statusDot");
    const label = document.getElementById("statusLabel");
    if (r.ok) {
      serverAwake = true;
      if (dot)   dot.className     = "status-dot online";
      if (label) label.textContent = "Servidor activo";
    } else throw new Error();
  } catch {
    const dot   = document.getElementById("statusDot");
    const label = document.getElementById("statusLabel");
    if (dot)   dot.className     = "status-dot offline";
    if (label) label.textContent = "Sin conexión";
  }
}
pingServer();
setInterval(pingServer, 9 * 60 * 1000);

// ── Fetch con retry ────────────────────────────────────────────
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

// ── Inputs → preview ──────────────────────────────────────────
[cuitInput, montoInput, detalleInput, document.getElementById("condicionVenta")].forEach(el => {
  if (!el) return;
  el.addEventListener("input", () => { clearTimeout(previewTimer); previewTimer = setTimeout(generarVistaPrevia, 1500); });
  el.addEventListener("blur", triggerPreviewNow);
});
function triggerPreviewNow() { clearTimeout(previewTimer); generarVistaPrevia(); }

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
  if (dir === 1 && parteActual < totalPartes) parteActual++;
  triggerPreviewNow();
};

// ── Carga PDF ──────────────────────────────────────────────────
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

// ── Vista previa ───────────────────────────────────────────────
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
btnOpenPreview.addEventListener("click", openPreview);

// ═══════════════════════════════════════════════════════════════
// EMISIÓN ARCA
// ═══════════════════════════════════════════════════════════════
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
    // Fetch directo — el servidor responde cuando AFIP autoriza + PDF listo
    // El email se manda en background del servidor DESPUÉS de responder
    const r = await fetchWithRetry(
      `${BASE}/facturar`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { maxRetries: 1, timeoutMs: 180000 }  // 3 minutos — AFIP puede tardar
    );
    const j = await r.json();
if (!r.ok) throw new Error(j.message || "Error al facturar");
if (!j.ok) throw new Error(j.message || "Respuesta inválida");

// ✅ Guardar resultado exitoso inmediatamente
try {
  localStorage.setItem("ml_last_result", JSON.stringify({
    result: j,
    payload,
    ts: Date.now()
  }));
} catch {}

try { localStorage.removeItem("ml_pending_emission"); } catch {}
haptic("success");
stopEmisionProgress();
setBtnState("success", "¡Factura Autorizada por ARCA!");
guardarEnHistorialLocal(j, payload);
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

// ── Recuperar emisión pendiente ────────────────────────────────
(async function checkPending() {
  try {
    const raw = localStorage.getItem("ml_pending_emission");
    if (!raw) return;

    const { payload, ts } = JSON.parse(raw);

    if (Date.now() - ts > 10 * 60 * 1000) {
      localStorage.removeItem("ml_pending_emission");
      return;
    }

    const ok = confirm(
      `⚠️ Emisión pendiente (CUIT: ${payload.cuitCliente})\n` +
      `¿Reintentar ahora?\n\n` +
      `⚠️ Si la factura YA se emitió, tocá Cancelar para no duplicar.`
    );

    if (!ok) {
      localStorage.removeItem("ml_pending_emission");
      return;
    }

    btnEmitir.disabled = true;
    btnEmitir.className = "main-btn btn-loading";
    startEmisionProgress();

    const r = await fetchWithRetry(
      `${BASE}/facturar`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      },
      { maxRetries: 1, timeoutMs: 180000 }
    );

    const j = await r.json();
    if (!r.ok) throw new Error(j.message || "Error");
    if (!j.ok) throw new Error(j.message || "Respuesta inválida");

    // ✅ Guardar también el último resultado exitoso
    try {
      localStorage.setItem("ml_last_result", JSON.stringify({
        result: j,
        payload,
        ts: Date.now()
      }));
    } catch {}

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

// ── Recuperar último resultado exitoso ────────────────────────
// Si la factura salió pero la app se cerró o hubo corte visual,
// se puede volver a mostrar el resultado y descargar el PDF.
(function checkLastResult() {
  try {
    const raw = localStorage.getItem("ml_last_result");
    if (!raw) return;

    const { result, payload, ts } = JSON.parse(raw);

    // vence en 30 minutos
    if (Date.now() - ts > 30 * 60 * 1000) {
      localStorage.removeItem("ml_last_result");
      return;
    }

    const modal = document.getElementById("successModal");
    if (modal && !modal.classList.contains("active")) {
      const ok = confirm(
        `✅ Hay una factura emitida recientemente.\n` +
        `CUIT: ${payload?.cuitCliente || "?"}\n\n` +
        `¿Querés volver a ver el resultado y descargar el PDF?`
      );

      if (ok) {
        guardarEnHistorialLocal(result, payload);
        showSuccessModal(result);
        setBtnState("success", "¡Factura Recuperada!");
      }

      localStorage.removeItem("ml_last_result");
    }
  } catch {
    try { localStorage.removeItem("ml_last_result"); } catch {}
  }
})();

// ═══════════════════════════════════════════════════════════════
// HISTORIAL LOCAL
// ═══════════════════════════════════════════════════════════════
function guardarEnHistorialLocal(responseData, payload) {
  try {
    const facturas = Array.isArray(responseData.facturas) ? responseData.facturas : [];
    const hoy = new Date();
    const mesKey = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}`;
    const raw = localStorage.getItem("ml_historial") || "{}";
    const hist = JSON.parse(raw);

    if (!hist[mesKey]) hist[mesKey] = [];

    for (const f of facturas) {
      const puntoVenta = Number(f.puntoVenta || f.pv || extraerPVDesdeComprobante(f.comprobante));
      const nroFactura = Number(f.nroFactura || f.nro || extraerNroDesdeComprobante(f.comprobante));
      const comprobante = f.comprobante || `A-${String(puntoVenta).padStart(5, "0")}-${String(nroFactura).padStart(8, "0")}`;
      const tipoCbte = f.tipoCbte || (String(comprobante).startsWith("NC-") ? "NC" : "FA");

      const yaExiste = hist[mesKey].some(x =>
        String(x.comprobante || "") === String(comprobante)
      );

      if (yaExiste) continue;

      hist[mesKey].push({
        fecha: f.fecha || hoy.toISOString().split("T")[0],
        comprobante,
        tipoCbte,
        puntoVenta,
        nroFactura,
        nro: nroFactura,
        cae: f.cae || "",
        cuit: payload?.cuitCliente || responseData?.receptor?.cuit || "",
        nombre: responseData?.receptor?.nombre || `CUIT ${payload?.cuitCliente || ""}`,
        total: Number(f.total || 0),
        pdfUrl: f.pdfUrl || "",
      });
    }

    localStorage.setItem("ml_historial", JSON.stringify(hist));
  } catch (e) {
    console.warn("guardarEnHistorialLocal:", e?.message || e);
  }
}

// ═══════════════════════════════════════════════════════════════
// PANEL RESUMEN MENSUAL
// ═══════════════════════════════════════════════════════════════
const MESES = ["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

window.abrirResumen = function () {
  haptic();
  document.getElementById("resumenModal").classList.add("active");
  renderResumen();
};
window.cerrarResumen = function () {
  haptic();
  document.getElementById("resumenModal").classList.remove("active");
};

function getMesKey() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}`;
}

function renderResumen() {
  const contenido = document.getElementById("resumenContenido");
  if (!contenido) return;

  let hist = {};
  try { hist = JSON.parse(localStorage.getItem("ml_historial") || "{}"); } catch {}

  const mesKey  = getMesKey();
  const [anio, mesNum] = mesKey.split("-").map(Number);
  const facturas = hist[mesKey] || [];
  const totalMes = round2(facturas.reduce((a, f) => a + Number(f.total || 0), 0));
  const cuitsSet = new Set(facturas.map(f => f.cuit));

  // Agrupar por cliente
  const porCliente = {};
  for (const f of facturas) {
    if (!porCliente[f.cuit]) porCliente[f.cuit] = { nombre: f.nombre, cuit: f.cuit, total: 0, cant: 0 };
    porCliente[f.cuit].total = round2(porCliente[f.cuit].total + Number(f.total || 0));
    porCliente[f.cuit].cant++;
  }
  const clientes = Object.values(porCliente).sort((a, b) => b.total - a.total);

  if (facturas.length === 0) {
    contenido.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:#8E8E93;">
        <div style="font-size:52px;margin-bottom:14px;">📋</div>
        <div style="font-size:17px;font-weight:700;color:#1C1C1E;">Sin facturas este mes</div>
        <div style="font-size:14px;margin-top:6px;">Las facturas que emitas aparecerán aquí automáticamente</div>
      </div>`;
    return;
  }

  let html = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-num">${facturas.length}</div>
        <div class="kpi-label">Facturas</div>
      </div>
      <div class="kpi-card kpi-green">
        <div class="kpi-num kpi-num-sm">$${formatMoneyAR(totalMes)}</div>
        <div class="kpi-label">Total del mes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">${cuitsSet.size}</div>
        <div class="kpi-label">Clientes</div>
      </div>
    </div>

    <div class="section-label">Comprobantes emitidos</div>
  `;

    for (const f of [...facturas].reverse()) {
    const comprobante = f.comprobante || `A-${String(f.puntoVenta || "").padStart(5,"0")}-${String(f.nro || "").padStart(8,"0")}`;
    const esNC = String(f.tipoCbte || "").toUpperCase() === "NC" || String(comprobante).startsWith("NC-");
    const estaAnulado = !!f.anulado;
    const totalNum = Number(f.total || 0);

    html += `
      <div class="fact-row">
        <div style="flex:1;min-width:0;">
          <div style="font-weight:800;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
            ${f.nombre}
          </div>
          <div style="font-size:12px;color:#8E8E93;margin-top:2px;">
            ${f.fecha} · ${comprobante}
          </div>
          <div style="font-size:11px;color:#A0AEC0;font-family:monospace;margin-top:1px;">
            CAE: ${f.cae || "—"}
          </div>
          <div class="fact-actions">
            ${f.pdfUrl ? `<button class="fact-mini-btn pdf" onclick="window.open('${f.pdfUrl}','_blank')">📄 PDF</button>` : ""}
            ${!esNC && !estaAnulado && totalNum > 0 ? `<button class="fact-mini-btn anular" onclick='abrirModalAnular(${JSON.stringify({
              comprobante,
              nombre: f.nombre,
              total: f.total,
              nro: f.nro,
              puntoVenta: f.puntoVenta || extraerPVDesdeComprobante(comprobante)
            }).replace(/'/g, "&apos;")})'>⛔ Anular</button>` : ""}
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
          <div style="font-size:11px;color:#8E8E93;margin-top:3px;">${c.cant} factura(s) · ${pct}% del total</div>
        </div>`;
    }
  }

  contenido.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// PANTALLA DE ÉXITO
// ═══════════════════════════════════════════════════════════════
function showSuccessModal(data) {
  const modal      = document.getElementById("successModal");
  const actionsBox = document.getElementById("successActions");
  document.getElementById("successMsgText").innerText =
  data.mensaje || "Factura emitida correctamente. Podés descargar el PDF aunque el email falle.";
  actionsBox.innerHTML = "";

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
          const file = new File([blob], `Factura_${f.nroFactura||idx+1}.pdf`, { type:"application/pdf" });
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




