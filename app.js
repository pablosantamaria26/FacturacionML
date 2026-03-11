// ============================================
// MERCADO LIMPIO - MOTOR PWA v2
// Fix: timeout, retry, keep-alive, background sync, PDF directo WA
// ============================================

const BASE = "https://api-mercadolimpio.onrender.com";

// ── Estado Global ──────────────────────────────────────────────
let itemsGlobal = [];
let domicilioRemitoGlobal = "";
let subtotalBrutoGlobal = 0;
let descuentoPctGlobal = 0;
let descuentoImporteGlobal = 0;
let totalFinalGlobal = 0;

let previewTimer = null;
let parteActual = 1;
let totalPartes = 1;
let serverAwake = false;   // sabe si el server ya respondió un ping

// ── Elementos UI ───────────────────────────────────────────────
const fileInput       = document.getElementById("fileRemito");
const cuitInput       = document.getElementById("cuit");
const montoInput      = document.getElementById("monto");
const detalleInput    = document.getElementById("detalle");
const btnEmitir       = document.getElementById("btnEmitir");
const btnOpenPreview  = document.getElementById("btnOpenPreview");

// ── Helpers matemáticos ────────────────────────────────────────
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

// ── Haptic ─────────────────────────────────────────────────────
const haptic = (type = "light") => {
  if (!navigator.vibrate) return;
  if (type === "light")   navigator.vibrate(15);
  if (type === "success") navigator.vibrate([30, 50, 30]);
  if (type === "error")   navigator.vibrate([50, 50, 50]);
};

// ── Toast ──────────────────────────────────────────────────────
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

// ── Progreso en botón ──────────────────────────────────────────
let _progressInterval = null;
function startProgressBtn(label = "Procesando") {
  let secs = 0;
  btnEmitir.className = "main-btn btn-loading";
  btnEmitir.disabled = true;
  clearInterval(_progressInterval);
  _progressInterval = setInterval(() => {
    secs++;
    const msg = secs < 20
      ? `${label}... ${secs}s`
      : secs < 40
        ? `⏳ Servidor despertando... ${secs}s`
        : `🔄 Casi listo... ${secs}s`;
    btnEmitir.innerHTML = `<div class="spinner"></div> ${msg}`;
  }, 1000);
}
function stopProgressBtn() { clearInterval(_progressInterval); _progressInterval = null; }

function setBtnState(state, text) {
  stopProgressBtn();
  btnEmitir.className = "main-btn";
  btnEmitir.disabled = true;
  if (state === "loading") {
    btnEmitir.classList.add("btn-loading");
    btnEmitir.innerHTML = `<div class="spinner"></div> ${text || "Procesando..."}`;
  } else if (state === "success") {
    btnEmitir.classList.add("btn-success");
    btnEmitir.innerHTML = `✅ ${text || "¡Completado!"}`;
    btnEmitir.disabled = false;
  } else {
    btnEmitir.innerHTML = text || "EMITIR FACTURA";
    btnEmitir.disabled = false;
  }
}

// ── Preset etiquetas ───────────────────────────────────────────
window.presetDetalle = function (txt) {
  haptic();
  detalleInput.value = txt;
  triggerPreviewNow();
};

// ═══════════════════════════════════════════════════════════════
// KEEP-ALIVE: ping cada 9 minutos para que Render no duerma
// También hace un ping inmediato al cargar la página
// ═══════════════════════════════════════════════════════════════
async function pingServer(silent = false) {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      serverAwake = true;
      if (!silent) showToast("✅ Servidor activo", "success");
    }
  } catch {
    if (!silent) console.log("Ping silencioso fallido, reintentará.");
  }
}
// Ping inmediato al cargar (despierta el servidor antes de que el usuario haga algo)
pingServer(true);
// Ping cada 9 minutos
setInterval(() => pingServer(true), 9 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════
// FETCH CON RETRY + TIMEOUT GENEROSO
// Reintentos automáticos si el servidor está durmiendo
// ═══════════════════════════════════════════════════════════════
async function fetchWithRetry(url, options = {}, { maxRetries = 3, timeoutMs = 90000, onRetry } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(url, { ...options, signal: ctrl.signal });
      clearTimeout(timer);
      return r;
    } catch (e) {
      lastErr = e;
      if (attempt < maxRetries) {
        const wait = attempt * 4000; // 4s, 8s entre reintentos
        if (onRetry) onRetry(attempt, wait);
        await new Promise(res => setTimeout(res, wait));
      }
    }
  }
  throw lastErr;
}

// ═══════════════════════════════════════════════════════════════
// EVENTOS DE INPUTS → VISTA PREVIA
// ═══════════════════════════════════════════════════════════════
[cuitInput, montoInput, detalleInput, document.getElementById("condicionVenta")].forEach(el => {
  if (!el) return;
  el.addEventListener("input", () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(generarVistaPrevia, 1500);
  });
  el.addEventListener("blur", triggerPreviewNow);
});

function triggerPreviewNow() {
  clearTimeout(previewTimer);
  generarVistaPrevia();
}

function computeTotalPartes() {
  const n = itemsGlobal.length || 0;
  totalPartes = Math.max(1, Math.ceil(n / 25));
  if (parteActual > totalPartes) parteActual = totalPartes;
  if (parteActual < 1) parteActual = 1;
  document.getElementById("pillParte").textContent = `${parteActual}/${totalPartes}`;
  document.getElementById("btnPrev").disabled = (parteActual <= 1);
  document.getElementById("btnNext").disabled = (parteActual >= totalPartes);
}

window.cambiarParte = function (dir) {
  haptic();
  if (dir === -1 && parteActual > 1) parteActual--;
  if (dir === 1 && parteActual < totalPartes) parteActual++;
  triggerPreviewNow();
};

// ═══════════════════════════════════════════════════════════════
// CARGA DE PDF
// ═══════════════════════════════════════════════════════════════
fileInput.addEventListener("change", leerPDF);

async function leerPDF(event) {
  const files = event?.target?.files || fileInput.files;
  if (!files || files.length === 0) return;
  haptic();

  const fileBadge = document.getElementById("file-badge");
  if (fileBadge) { fileBadge.style.display = "inline-block"; fileBadge.textContent = `${files.length} archivo(s)`; }

  setBtnState("loading", "Analizando PDF...");
  btnEmitir.innerHTML = `<div class="spinner"></div> Analizando PDF...`;

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) formData.append("remito", files[i]);

  try {
    const r = await fetchWithRetry(
      `${BASE}/leer-remito`,
      { method: "POST", body: formData },
      {
        maxRetries: 3,
        timeoutMs: 120000,
        onRetry: (attempt) => {
          showToast(`⏳ Reintentando análisis (${attempt}/3)...`, "success");
        }
      }
    );
    const res = await r.json();
    if (!r.ok) throw new Error(res.detail || res.message || "Error al leer el PDF.");

    domicilioRemitoGlobal  = res.domicilioRemito || "";
    subtotalBrutoGlobal    = Number(res.subtotalBruto || 0);
    descuentoPctGlobal     = Number(res.descuentoPct || 0);
    descuentoImporteGlobal = Number(res.descuentoImporte || 0);
    totalFinalGlobal       = Number(res.total || 0);
    itemsGlobal            = Array.isArray(res.items) ? res.items : [];
    parteActual            = 1;

    if (cuitInput)  cuitInput.value  = res.cuit || "";
    if (montoInput) montoInput.value = res.total ? String(res.total).replace(".", ",") : "";

    // Mostrar resumen visual de extracción
    mostrarResumenExtraccion(res);

    showToast(`✅ ${itemsGlobal.length} ítems · $${formatMoneyAR(totalFinalGlobal)}`, "success");
    haptic("success");
    setBtnState("ready", "EMITIR FACTURA");
    triggerPreviewNow();

  } catch (e) {
    showToast("❌ " + (e.message || "Error de conexión"), "error");
    setBtnState("ready", "EMITIR FACTURA");
    if (fileBadge) fileBadge.style.display = "none";
  }
}

function mostrarResumenExtraccion(res) {
  const box = document.getElementById("resumenExtraccion");
  if (!box) return;

  const items = Array.isArray(res.items) ? res.items : [];
  const total = Number(res.total || 0);
  const desc  = Number(res.descuentoImporte || 0);
  const sub   = Number(res.subtotalBruto || 0);
  const cuit  = res.cuit || "";
  const dom   = res.domicilioRemito || "";

  let html = `<strong>📋 Extracción del remito</strong><br>`;
  if (cuit) html += `CUIT: <strong>${cuit}</strong><br>`;
  html += `Ítems detectados: <strong>${items.length}</strong><br>`;
  if (sub > 0 && desc > 0) {
    html += `Subtotal: <strong>$${formatMoneyAR(sub)}</strong> &nbsp;·&nbsp; Descuento: <strong>-$${formatMoneyAR(desc)} (${formatMoneyAR(res.descuentoPct || 0)}%)</strong><br>`;
  }
  if (total > 0) html += `<div class="summary-total">Total a facturar: $${formatMoneyAR(total)}</div>`;
  if (dom) html += `<div class="domicilio-pdf">📍 ${dom}</div>`;

  box.innerHTML = html;
  box.style.display = "block";
}

// ═══════════════════════════════════════════════════════════════
// VISTA PREVIA
// ═══════════════════════════════════════════════════════════════
function buildPreviewPayload(itemsToSend, totalToSend) {
  return {
    cuitCliente:       cuitInput.value.trim(),
    domicilioRemito:   domicilioRemitoGlobal,
    condicionVenta:    document.getElementById("condicionVenta").value,
    items:             itemsToSend,
    subtotalBruto:     subtotalBrutoGlobal || 0,
    descuentoPct:      descuentoPctGlobal  || 0,
    descuentoImporte:  descuentoImporteGlobal || 0,
    total:             totalToSend,
    previewParte:      parteActual
  };
}

async function generarVistaPrevia() {
  const cuit         = cuitInput.value.trim();
  const detalleManual = detalleInput.value.trim();

  let itemsToPreview = itemsGlobal.map(it => {
    const d = String(it.descripcion || "").trim();
    const q = Number(it.cantidad || 0);
    const p = round2(Number(it.precioConIva || 0));
    const s = round2(Number(it.subtotalConIva || (q * p) || 0));
    return { descripcion: d, cantidad: q, precioConIva: p, subtotalConIva: s };
  }).filter(it => it.cantidad > 0 && it.precioConIva > 0 && it.subtotalConIva > 0);

  if (itemsToPreview.length === 0) {
    const m = parseMontoInput();
    if (m > 0) {
      itemsToPreview = [{ descripcion: detalleManual || "Artículos varios", cantidad: 1, precioConIva: round2(m), subtotalConIva: round2(m) }];
    }
  }

  if (itemsToPreview.length === 0 && (!cuit || cuit.length < 11)) {
    btnOpenPreview.disabled = true;
    return;
  }

  computeTotalPartes();
  btnOpenPreview.disabled = false;
  btnOpenPreview.innerHTML = `👁️ Vista Previa (Parte ${parteActual}/${totalPartes})`;

  try {
    const totalComputed = round2(itemsToPreview.reduce((a, x) => a + Number(x.subtotalConIva || 0), 0));
    const totalToSend   = totalFinalGlobal > 0 ? totalFinalGlobal : totalComputed;
    const payload       = buildPreviewPayload(itemsToPreview, totalToSend);

    const r = await fetchWithRetry(
      `${BASE}/debug/preview`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { maxRetries: 2, timeoutMs: 30000 }
    );

    if (r.ok) {
      const html = await r.text();
      const doc  = document.getElementById("previewFrame").contentWindow.document;
      doc.open(); doc.write(html); doc.close();
    }
  } catch (e) {
    console.warn("Preview silently failed:", e.message);
  }
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
// EMISIÓN ARCA — con retry, progreso en tiempo real, tolerancia
// Si cerrás la app y volvés, la factura ya está autorizada
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

  // Guardamos payload en localStorage por si la app se cierra
  const totalComputed = round2(items.reduce((a, x) => a + Number(x.subtotalConIva || 0), 0));
  const totalToSend   = totalFinalGlobal > 0 ? totalFinalGlobal : totalComputed;
  const payload = {
    cuitCliente:       cuit,
    domicilioRemito:   domicilioRemitoGlobal,
    condicionVenta:    document.getElementById("condicionVenta").value,
    items,
    subtotalBruto:     subtotalBrutoGlobal  || 0,
    descuentoPct:      descuentoPctGlobal   || 0,
    descuentoImporte:  descuentoImporteGlobal || 0,
    total:             totalToSend
  };
  const emailObj = document.getElementById("email").value.trim();
  if (emailObj) payload.emailCliente = emailObj;

  // Guardamos intento pendiente — si se cierra la app, al volver lo reintentamos
  try { localStorage.setItem("ml_pending_emission", JSON.stringify({ payload, ts: Date.now() })); } catch {}

  // Arrancar progreso visual
  startProgressBtn("Conectando con AFIP/ARCA");

  try {
    const r = await fetchWithRetry(
      `${BASE}/facturar`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      {
        maxRetries: 3,
        timeoutMs: 120000, // 2 minutos — AFIP puede tardar
        onRetry: (attempt, wait) => {
          showToast(`⏳ Servidor ocupado, reintentando (${attempt}/3)...`, "success");
          startProgressBtn(`Reintento ${attempt}/3`);
        }
      }
    );

    const j = await r.json();
    if (!r.ok) throw new Error(j.message || "Error al facturar");

    // Limpiamos el pending porque ya terminó
    try { localStorage.removeItem("ml_pending_emission"); } catch {}

    haptic("success");
    stopProgressBtn();
    setBtnState("success", "¡Factura Autorizada!");
    showSuccessModal(j);

  } catch (e) {
    stopProgressBtn();
    setBtnState("ready", "🔄 REINTENTAR EMISIÓN");
    const msg = e.name === "AbortError"
      ? "⏱ Tiempo agotado. El servidor puede estar iniciando. Esperá 30s y reintentá."
      : "❌ " + (e.message || "Error de conexión");
    showToast(msg, "error");
  }
};

// ═══════════════════════════════════════════════════════════════
// RECUPERAR EMISIÓN PENDIENTE al volver a abrir la app
// ═══════════════════════════════════════════════════════════════
(async function checkPendingEmission() {
  try {
    const raw = localStorage.getItem("ml_pending_emission");
    if (!raw) return;
    const { payload, ts } = JSON.parse(raw);
    const age = Date.now() - ts;
    if (age > 10 * 60 * 1000) { localStorage.removeItem("ml_pending_emission"); return; } // >10min, ignorar

    // Preguntar al usuario si quiere reanudar
    const ok = confirm(`⚠️ Hay una emisión pendiente de hace ${Math.round(age / 1000)}s.\n\nCUIT: ${payload.cuitCliente}\n\n¿Reintentar ahora?`);
    if (!ok) { localStorage.removeItem("ml_pending_emission"); return; }

    startProgressBtn("Retomando emisión pendiente");
    const r = await fetchWithRetry(
      `${BASE}/facturar`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      { maxRetries: 3, timeoutMs: 120000 }
    );
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || "Error");
    localStorage.removeItem("ml_pending_emission");
    stopProgressBtn();
    setBtnState("success", "¡Factura Autorizada!");
    showSuccessModal(j);
  } catch (e) {
    stopProgressBtn();
    setBtnState("ready", "EMITIR FACTURA");
    showToast("No se pudo recuperar la emisión: " + e.message, "error");
  }
})();

// ═══════════════════════════════════════════════════════════════
// PANTALLA DE ÉXITO — WhatsApp con link público + Compartir PDF
// ═══════════════════════════════════════════════════════════════
function showSuccessModal(data) {
  const modal      = document.getElementById("successModal");
  const actionsBox = document.getElementById("successActions");
  document.getElementById("successMsgText").innerText = data.mensaje || "Generada correctamente.";
  actionsBox.innerHTML = "";

  const facturas = Array.isArray(data.facturas) ? data.facturas : [];

  // ── WhatsApp (texto con links públicos) ──
  if (data.waLink) {
    const btn = document.createElement("a");
    btn.className = "action-btn btn-wa";
    btn.href      = data.waLink;
    btn.target    = "_blank";
    btn.innerHTML = `📱 Enviar resumen por WhatsApp`;
    actionsBox.appendChild(btn);
  }

  // ── Por cada factura: compartir PDF nativo o abrir ──
  facturas.forEach((f, idx) => {
    if (!f.pdfUrl) return;

    // Botón "Compartir PDF" — usa Web Share API si está disponible (iOS/Android)
    if (navigator.share) {
      const btnShare = document.createElement("button");
      btnShare.className = "action-btn btn-download";
      btnShare.innerHTML = `📤 Compartir PDF${facturas.length > 1 ? ` (Parte ${idx + 1})` : ""} · $${formatMoneyAR(f.total)}`;
      btnShare.onclick = async () => {
        haptic();
        try {
          // Intentamos compartir el archivo PDF directamente
          const resp = await fetch(f.pdfUrl);
          const blob = await resp.blob();
          const file = new File([blob], `Factura_${f.nroFactura || idx + 1}.pdf`, { type: "application/pdf" });

          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: `Factura Mercado Limpio`, text: `Factura $${formatMoneyAR(f.total)} — CAE: ${f.cae}` });
          } else {
            // Fallback: compartir link
            await navigator.share({ title: "Factura Mercado Limpio", text: `Factura $${formatMoneyAR(f.total)}`, url: f.pdfUrl });
          }
        } catch (e) {
          if (e.name !== "AbortError") window.open(f.pdfUrl, "_blank");
        }
      };
      actionsBox.appendChild(btnShare);
    }

    // Botón "Abrir/Descargar PDF" — siempre visible como fallback
    const btnPdf = document.createElement("a");
    btnPdf.className = "action-btn btn-download";
    btnPdf.href      = f.pdfUrl;
    btnPdf.target    = "_blank";
    btnPdf.download  = `Factura_${f.nroFactura || idx + 1}.pdf`;
    btnPdf.innerHTML = `📄 Abrir PDF${facturas.length > 1 ? ` (Parte ${idx + 1})` : ""} · $${formatMoneyAR(f.total)}`;
    actionsBox.appendChild(btnPdf);

    // WhatsApp directo con link del PDF esta factura
    const waUrl = `https://wa.me/?text=${encodeURIComponent(`Factura Mercado Limpio\nTotal: $${formatMoneyAR(f.total)}\nCAE: ${f.cae}\nPDF: ${f.pdfUrl}`)}`;
    const btnWaPdf = document.createElement("a");
    btnWaPdf.className = "action-btn btn-wa";
    btnWaPdf.href      = waUrl;
    btnWaPdf.target    = "_blank";
    btnWaPdf.style.opacity = "0.85";
    btnWaPdf.innerHTML = `💬 Enviar link PDF por WhatsApp${facturas.length > 1 ? ` (Parte ${idx + 1})` : ""}`;
    actionsBox.appendChild(btnWaPdf);
  });

  // ── Datos técnicos ──
  if (facturas.length > 0) {
    const info = document.createElement("div");
    info.style = "margin: 20px 0 10px; padding: 16px; background: #f8fafc; border-radius: 14px; font-size: 13px; color: #475569; line-height: 1.7;";
    info.innerHTML = facturas.map((f, i) =>
      `<strong>Parte ${i + 1}:</strong> Nro ${String(f.nroFactura || "").padStart(8, "0")} · CAE: ${f.cae} · $${formatMoneyAR(f.total)}`
    ).join("<br>");
    actionsBox.appendChild(info);
  }

  // ── Volver ──
  const btnReset = document.createElement("button");
  btnReset.className = "action-btn btn-close-success";
  btnReset.innerHTML = "📋 Emitir Otra Factura";
  btnReset.onclick   = () => { haptic(); window.location.reload(); };
  actionsBox.appendChild(btnReset);

  modal.classList.add("active");
}
