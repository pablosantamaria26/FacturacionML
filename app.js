// ============================================
// MERCADO LIMPIO - MOTOR PWA (iOS OPTIMIZADO)
// ============================================

const BASE = "https://api-mercadolimpio.onrender.com";

// Estado Global (Exacto al backend/pc)
let itemsGlobal =[];
let domicilioRemitoGlobal = "";
let subtotalBrutoGlobal = 0;
let descuentoPctGlobal = 0;
let descuentoImporteGlobal = 0;
let totalFinalGlobal = 0;

let previewTimer = null;
let parteActual = 1;
let totalPartes = 1;

// Elementos UI
const fileInput = document.getElementById("fileRemito");
const cuitInput = document.getElementById("cuit");
const montoInput = document.getElementById("monto");
const detalleInput = document.getElementById("detalle");
const btnEmitir = document.getElementById("btnEmitir");
const btnOpenPreview = document.getElementById("btnOpenPreview");

// Haptic Feedback (Vibración nativa si está disponible)
const haptic = (type = 'light') => {
  if (!navigator.vibrate) return;
  if (type === 'light') navigator.vibrate(15);
  if (type === 'success') navigator.vibrate([30, 50, 30]);
  if (type === 'error') navigator.vibrate([50, 50, 50]);
};

// Utils Matemáticos
const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
const formatMoneyAR = (n) => {
  try { return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0)); }
  catch { return String(n); }
};
const parseMontoInput = () => {
  const monto = String(montoInput.value).trim().replace(/\./g, "").replace(",", ".");
  const m = Number(monto);
  return (Number.isFinite(m) && m > 0) ? round2(m) : 0;
};

// Toast Notifications
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerText = msg;
  container.appendChild(toast);
  
  // Reflow y animar
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3500);

  type === 'error' ? haptic('error') : haptic('light');
}

// Control UI Botón Emitir
function setBtnState(state, text) {
  btnEmitir.className = "main-btn"; // Reset
  btnEmitir.disabled = true;
  if (state === 'loading') {
    btnEmitir.classList.add('btn-loading');
    btnEmitir.innerHTML = `<div class="spinner"></div> ${text || 'Procesando...'}`;
  } else if (state === 'success') {
    btnEmitir.classList.add('btn-success');
    btnEmitir.innerHTML = `✅ ${text || '¡Completado!'}`;
    btnEmitir.disabled = false;
  } else {
    // Default / Ready
    btnEmitir.innerHTML = text || 'EMITIR FACTURA';
    btnEmitir.disabled = false;
  }
}

// Preset etiquetas
window.presetDetalle = function(txt) {
  haptic();
  detalleInput.value = txt;
  triggerPreviewNow();
};

// ============================================
// EVENTOS INPUTS -> VISTA PREVIA
// ============================================[cuitInput, montoInput, detalleInput, document.getElementById('condicionVenta')].forEach(el => {
  el.addEventListener('input', () => {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(generarVistaPrevia, 1200);
  });
  el.addEventListener('blur', triggerPreviewNow);
});

function triggerPreviewNow() {
  clearTimeout(previewTimer);
  generarVistaPrevia();
}

// Lógica total partes (igual PC)
function computeTotalPartes() {
  const n = itemsGlobal.length || 0;
  totalPartes = Math.max(1, Math.ceil(n / 25)); // 25 max por backend
  if (parteActual > totalPartes) parteActual = totalPartes;
  if (parteActual < 1) parteActual = 1;

  document.getElementById("pillParte").textContent = `${parteActual}/${totalPartes}`;
  document.getElementById("btnPrev").disabled = (parteActual <= 1);
  document.getElementById("btnNext").disabled = (parteActual >= totalPartes);
}

window.cambiarParte = function(dir) {
  haptic();
  if (dir === -1 && parteActual > 1) parteActual--;
  if (dir === 1 && parteActual < totalPartes) parteActual++;
  triggerPreviewNow();
};

// ============================================
// CARGA DE PDF
// ============================================
fileInput.addEventListener("change", leerPDF);

async function leerPDF() {
  if (!fileInput.files.length) return;
  haptic();

  const fileBadge = document.getElementById("file-badge");
  fileBadge.style.display = "inline-block";
  fileBadge.textContent = `${fileInput.files.length} archivo(s) listo(s)`;

  setBtnState('loading', 'Analizando PDF con IA...');

  const formData = new FormData();
  for (let i = 0; i < fileInput.files.length; i++) {
    formData.append("remito", fileInput.files[i]);
  }

  try {
    const r = await fetch(`${BASE}/leer-remito`, { method: "POST", body: formData });
    const res = await r.json();

    if (!r.ok) throw new Error(res.detail || "Error al leer el PDF.");

    domicilioRemitoGlobal = res.domicilioRemito || "";
    subtotalBrutoGlobal = Number(res.subtotalBruto || 0);
    descuentoPctGlobal = Number(res.descuentoPct || 0);
    descuentoImporteGlobal = Number(res.descuentoImporte || 0);
    totalFinalGlobal = Number(res.total || 0);

    cuitInput.value = res.cuit || "";
    montoInput.value = res.total ? String(res.total).replace(".", ",") : "";
    itemsGlobal = Array.isArray(res.items) ? res.items :[];

    parteActual = 1;
    let msg = `✅ ${itemsGlobal.length} ítems extraídos.`;
    if (totalFinalGlobal > 0) msg += ` Total: $${formatMoneyAR(totalFinalGlobal)}`;
    
    showToast(msg, 'success');
    haptic('success');
    setBtnState('ready', 'EMITIR FACTURA');
    
    triggerPreviewNow();

  } catch (e) {
    showToast(e.message, 'error');
    setBtnState('ready', 'EMITIR FACTURA');
    fileBadge.style.display = "none";
  }
}

// ============================================
// VISTA PREVIA (Llamada al backend)
// ============================================
function buildPayloadForPreview(itemsToSend, totalToSend) {
  return {
    cuitCliente: cuitInput.value.trim(),
    domicilioRemito: domicilioRemitoGlobal,
    condicionVenta: document.getElementById("condicionVenta").value,
    items: itemsToSend,
    subtotalBruto: subtotalBrutoGlobal || 0,
    descuentoPct: descuentoPctGlobal || 0,
    descuentoImporte: descuentoImporteGlobal || 0,
    total: totalToSend,
    previewParte: parteActual // Siempre usamos mode ONE en mobile
  };
}

async function generarVistaPrevia() {
  const cuit = cuitInput.value.trim();
  const detalleManual = detalleInput.value.trim();

  let itemsToPreview = itemsGlobal.map(it => {
    const descripcion = String(it.descripcion || "").trim();
    const cantidad = Number(it.cantidad || 0);
    const precioConIva = round2(Number(it.precioConIva || 0));
    const subtotalConIva = round2(Number(it.subtotalConIva || (cantidad * precioConIva) || 0));
    return { descripcion, cantidad, precioConIva, subtotalConIva };
  }).filter(it => it.cantidad > 0 && it.precioConIva > 0 && it.subtotalConIva > 0);

  if (itemsToPreview.length === 0) {
    const m = parseMontoInput();
    if (m > 0) {
      itemsToPreview =[{
        descripcion: detalleManual || "Artículos varios",
        cantidad: 1,
        precioConIva: round2(m),
        subtotalConIva: round2(m)
      }];
    }
  }

  if (itemsToPreview.length === 0 && (!cuit || cuit.length < 11)) {
    btnOpenPreview.disabled = true;
    return;
  }

  computeTotalPartes();
  btnOpenPreview.disabled = false;
  btnOpenPreview.innerHTML = `👁️ Ver Vista Previa (Parte ${parteActual}/${totalPartes})`;

  try {
    const totalComputed = round2(itemsToPreview.reduce((a, x) => a + Number(x.subtotalConIva || 0), 0));
    const totalToSend = totalFinalGlobal > 0 ? totalFinalGlobal : totalComputed;

    const payload = buildPayloadForPreview(itemsToPreview, totalToSend);

    const r = await fetch(`${BASE}/debug/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (r.ok) {
      const htmlStr = await r.text();
      const doc = document.getElementById("previewFrame").contentWindow.document;
      doc.open(); doc.write(htmlStr); doc.close();
    }
  } catch(e) {
    console.error("Preview error", e);
  }
}

// Modal View Controls
window.openPreview = function() {
  haptic();
  document.getElementById("previewBackdrop").classList.add("active");
  document.getElementById("previewSheet").classList.add("active");
};
window.closePreview = function() {
  haptic();
  document.getElementById("previewBackdrop").classList.remove("active");
  document.getElementById("previewSheet").classList.remove("active");
};
btnOpenPreview.addEventListener('click', openPreview);


// ============================================
// EMISIÓN ARCA (FACTURAR)
// ============================================
window.emitir = async function() {
  haptic();
  const cuit = cuitInput.value.trim();
  if (!cuit || cuit.length !== 11) return showToast("Falta CUIT válido (11 num).", "error");

  let items = itemsGlobal.map(it => {
    const descripcion = String(it.descripcion || "").trim();
    const cantidad = Number(it.cantidad || 0);
    const precioConIva = round2(Number(it.precioConIva || 0));
    const subtotalConIva = round2(Number(it.subtotalConIva || (cantidad * precioConIva) || 0));
    return { descripcion, cantidad, precioConIva, subtotalConIva };
  }).filter(it => it.cantidad > 0 && it.precioConIva > 0 && it.subtotalConIva > 0);

  if (items.length === 0) {
    const m = parseMontoInput();
    if (!m || m <= 0) return showToast("Falta monto total o PDF.", "error");
    items =[{
      descripcion: detalleInput.value || "Artículos Varios",
      cantidad: 1,
      precioConIva: round2(m),
      subtotalConIva: round2(m)
    }];
    
    domicilioRemitoGlobal = ""; subtotalBrutoGlobal = 0; descuentoPctGlobal = 0;
    descuentoImporteGlobal = 0; totalFinalGlobal = round2(m); itemsGlobal = items;
  }

  setBtnState('loading', 'Enviando a AFIP/ARCA...');

  try {
    const totalComputed = round2(items.reduce((a, x) => a + Number(x.subtotalConIva || 0), 0));
    const totalToSend = totalFinalGlobal > 0 ? totalFinalGlobal : totalComputed;

    const payload = {
      cuitCliente: cuit,
      domicilioRemito: domicilioRemitoGlobal,
      condicionVenta: document.getElementById("condicionVenta").value,
      items,
      subtotalBruto: subtotalBrutoGlobal || 0,
      descuentoPct: descuentoPctGlobal || 0,
      descuentoImporte: descuentoImporteGlobal || 0,
      total: totalToSend
    };

    const emailObj = document.getElementById("email").value.trim();
    if (emailObj) payload.emailCliente = emailObj;

    const r = await fetch(`${BASE}/facturar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await r.json();

    if (!r.ok) throw new Error(j.message || "Error al facturar.");

    // Éxito!
    haptic('success');
    setBtnState('success', 'Factura Autorizada');
    showSuccessModal(j);

  } catch (e) {
    setBtnState('ready', 'REINTENTAR EMISIÓN');
    showToast(e.message || "Error de conexión", "error");
  }
};

// ============================================
// PANTALLA DE ÉXITO (WHATSAPP + DOWNLOADS)
// ============================================
function showSuccessModal(data) {
  const modal = document.getElementById("successModal");
  const actionsBox = document.getElementById("successActions");
  
  document.getElementById("successMsgText").innerText = data.mensaje || "Generada correctamente.";
  actionsBox.innerHTML = "";

  // Botón WhatsApp
  if (data.waLink) {
    const btnWa = document.createElement("a");
    btnWa.className = "action-btn btn-wa";
    btnWa.href = data.waLink;
    btnWa.target = "_blank";
    btnWa.innerHTML = `📱 Enviar por WhatsApp`;
    actionsBox.appendChild(btnWa);
  }

  // Botones Descargar PDF (1 por parte)
  if (Array.isArray(data.facturas) && data.facturas.length > 0) {
    data.facturas.forEach((f, idx) => {
      if (f.pdfUrl) {
        const btnPdf = document.createElement("a");
        btnPdf.className = "action-btn btn-download";
        btnPdf.href = f.pdfUrl;
        btnPdf.download = "";
        btnPdf.target = "_blank";
        btnPdf.innerHTML = `📄 Bajar PDF - Parte ${idx + 1} ($${formatMoneyAR(f.total)})`;
        actionsBox.appendChild(btnPdf);
      }
    });
  }

  // Botón Volver a empezar
  const btnReset = document.createElement("button");
  btnReset.className = "action-btn btn-close-success";
  btnReset.innerHTML = "Emitir Otra Factura";
  btnReset.onclick = () => {
    haptic();
    window.location.reload();
  };
  actionsBox.appendChild(btnReset);

  modal.classList.add("active");
}
