"use strict";

// =========================
// CONFIG
// =========================
const BASE = "https://api-mercadolimpio.onrender.com";
const ITEMS_POR_FACTURA = 25;

// Draft storage
const DRAFT_KEY = "ml_facturacion_draft_v1";

// Estado global
let itemsGlobal = [];
let domicilioRemitoGlobal = "";
let subtotalBrutoGlobal = 0;
let descuentoPctGlobal = 0;
let descuentoImporteGlobal = 0;
let totalFinalGlobal = 0;

let facturasEmitidas = [];
let currentWaText = "";
let currentWaLink = "";

// UI refs
let inputPdf, loaderUI, statusAlert, btnMainAction, btnShareNative, statusBadge, btnMainLabel;
let modalItem, modalBackdrop, btnCloseModal, btnSaveItem, btnDeleteItem, modalTitle;
let m_desc, m_qty, m_unit;
let editingIndex = -1;

// =========================
// INIT
// =========================
document.addEventListener("DOMContentLoaded", () => {
  // UI
  inputPdf = document.getElementById("inputPdf");
  loaderUI = document.getElementById("loaderUI");
  statusAlert = document.getElementById("statusAlert");
  btnMainAction = document.getElementById("btnMainAction");
  btnShareNative = document.getElementById("btnShareNative");
  statusBadge = document.getElementById("statusBadge");
  btnMainLabel = document.getElementById("btnMainLabel");

  // Buttons
  document.getElementById("btnPickPdf")?.addEventListener("click", () => inputPdf.click());
  document.getElementById("btnGoManual")?.addEventListener("click", () => switchTab("manual"));
  document.getElementById("btnGoManual2")?.addEventListener("click", () => switchTab("manual"));

  document.getElementById("btnManualAddItem")?.addEventListener("click", () => openItemModal(-1));
  document.getElementById("btnManualGoData")?.addEventListener("click", () => switchTab("items"));
  document.getElementById("btnManualGoPreview")?.addEventListener("click", () => { recalcTotals(); switchTab("preview"); });

  document.getElementById("btnAddItem")?.addEventListener("click", () => openItemModal(-1));
  document.getElementById("btnClearItems")?.addEventListener("click", clearItems);
  document.getElementById("btnRecalc")?.addEventListener("click", () => { recalcTotals(); mostrarAlerta("✅ Totales actualizados.", "success"); });
  document.getElementById("btnGoPreview")?.addEventListener("click", () => { recalcTotals(); switchTab("preview"); });

  document.getElementById("btnEmitir")?.addEventListener("click", emitirFactura);
  document.getElementById("btnResetDraft")?.addEventListener("click", resetDraft);
  document.getElementById("btnShareWa")?.addEventListener("click", shareWhatsAppDirect);

  // Modal refs
  modalItem = document.getElementById("modalItem");
  modalBackdrop = document.getElementById("modalBackdrop");
  btnCloseModal = document.getElementById("btnCloseModal");
  btnSaveItem = document.getElementById("btnSaveItem");
  btnDeleteItem = document.getElementById("btnDeleteItem");
  modalTitle = document.getElementById("modalTitle");

  m_desc = document.getElementById("m_desc");
  m_qty = document.getElementById("m_qty");
  m_unit = document.getElementById("m_unit");

  btnCloseModal?.addEventListener("click", closeItemModal);
  modalBackdrop?.addEventListener("click", closeItemModal);
  btnSaveItem?.addEventListener("click", saveItemFromModal);
  btnDeleteItem?.addEventListener("click", deleteItemFromModal);

  // Inputs -> autosave + recalc
  ["cuit", "domicilioRemito", "condicionVenta", "descuentoPct", "descuentoImporte"].forEach(id => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => {
      pullFormIntoGlobals();
      recalcTotals();
      saveDraft();
    });
    el?.addEventListener("change", () => {
      pullFormIntoGlobals();
      recalcTotals();
      saveDraft();
    });
  });

  // Nav buttons
  document.querySelectorAll("button[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.getAttribute("data-tab")));
  });

  // Main action = procesar PDF (si estás en capture) / agregar item (si estás en manual)
  btnMainAction?.addEventListener("click", () => {
    const active = getActiveTab();
    if (active === "manual" || active === "items") openItemModal(-1);
    else inputPdf.click();
  });

  // Share native
  btnShareNative?.addEventListener("click", shareNative);

  // File change
  inputPdf?.addEventListener("change", procesarArchivo);

  // Health ping
  startHealthPolling();

  // Restore draft
  loadDraft();

  // Initial tab
  switchTab("capture");
});

// =========================
// HELPERS
// =========================
function moneyAR(n) {
  const v = Number(n || 0);
  return v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}
function sumItems() {
  return round2(itemsGlobal.reduce((a, it) => a + Number(it.subtotalConIva || 0), 0));
}
function getActiveTab() {
  const tabs = ["capture", "items", "manual", "preview"];
  for (const t of tabs) {
    const el = document.getElementById(`tab-${t}`);
    if (el && !el.classList.contains("hidden")) return t;
  }
  return "capture";
}
function setMainActionLabel() {
  const active = getActiveTab();
  if (!btnMainLabel) return;
  if (active === "manual" || active === "items") btnMainLabel.textContent = "Agregar";
  else btnMainLabel.textContent = "Procesar";
}

// =========================
// ALERTS
// =========================
function mostrarAlerta(msg, tipo) {
  statusAlert.innerHTML = msg;
  statusAlert.className = `fixed top-16 left-1/2 transform -translate-x-1/2 z-[100] rounded-full px-5 py-3 text-xs font-black shadow-2xl min-w-[80%] text-center transition-all duration-300 ${
    tipo === "success" ? "bg-emerald-600 text-white" :
    tipo === "error" ? "bg-red-600 text-white" :
    "bg-slate-900 text-white"
  }`;
  statusAlert.classList.remove("hidden");
  if (tipo !== "info") setTimeout(() => statusAlert.classList.add("hidden"), 3500);
}

// =========================
// TAB NAV
// =========================
function switchTab(tabId) {
  ["tab-capture", "tab-items", "tab-manual", "tab-preview"].forEach(id => document.getElementById(id)?.classList.add("hidden"));
  ["nav-capture", "nav-items", "nav-preview"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove("text-blue-600");
    el.classList.add("text-slate-400");
  });

  document.getElementById(`tab-${tabId}`)?.classList.remove("hidden");
  if (tabId === "capture") highlightNav("nav-capture");
  if (tabId === "items" || tabId === "manual") highlightNav("nav-items");
  if (tabId === "preview") highlightNav("nav-preview");

  setMainActionLabel();

  if (tabId === "preview") {
    pullFormIntoGlobals();
    recalcTotals();
    buildPreviewRail().catch(() => {});
  }
  if (tabId === "manual") {
    renderManualList();
    refreshManualTotalsPills();
  }
}

function highlightNav(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("text-slate-400");
  el.classList.add("text-blue-600");
}

// =========================
// FORM <-> GLOBALS
// =========================
function pullFormIntoGlobals() {
  const cuit = document.getElementById("cuit")?.value?.trim() || "";
  const dom = document.getElementById("domicilioRemito")?.value?.trim() || "";
  domicilioRemitoGlobal = dom;

  descuentoPctGlobal = Number(document.getElementById("descuentoPct")?.value || 0);
  descuentoImporteGlobal = Number(document.getElementById("descuentoImporte")?.value || 0);

  // subtotalBrutoGlobal: lo usamos como "subtotal pre-desc" si estamos en manual
  subtotalBrutoGlobal = sumItems();

  // no guardo cuit acá global (solo en draft), pero queda en el input
  return cuit;
}

function pushGlobalsToForm() {
  document.getElementById("domicilioRemito").value = domicilioRemitoGlobal || "";
  document.getElementById("descuentoPct").value = String(descuentoPctGlobal || 0);
  document.getElementById("descuentoImporte").value = String(descuentoImporteGlobal || 0);
}

// =========================
// DRAFT STORAGE
// =========================
function saveDraft() {
  const draft = {
    cuit: document.getElementById("cuit")?.value?.trim() || "",
    domicilioRemito: domicilioRemitoGlobal || "",
    condicionVenta: document.getElementById("condicionVenta")?.value || "Transferencia Bancaria",
    descuentoPct: Number(descuentoPctGlobal || 0),
    descuentoImporte: Number(descuentoImporteGlobal || 0),
    items: itemsGlobal,
    ts: Date.now()
  };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    showDraftPill(true);
  } catch {}
}

function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);

    if (d?.cuit) document.getElementById("cuit").value = d.cuit;
    if (d?.domicilioRemito) domicilioRemitoGlobal = d.domicilioRemito;
    if (d?.condicionVenta) document.getElementById("condicionVenta").value = d.condicionVenta;

    descuentoPctGlobal = Number(d?.descuentoPct || 0);
    descuentoImporteGlobal = Number(d?.descuentoImporte || 0);

    itemsGlobal = Array.isArray(d?.items) ? d.items : [];

    pushGlobalsToForm();
    updateItemsListUI();
    renderManualList();
    recalcTotals();
    showDraftPill(itemsGlobal.length > 0 || !!d?.cuit);
  } catch {}
}

function resetDraft() {
  itemsGlobal = [];
  domicilioRemitoGlobal = "";
  subtotalBrutoGlobal = 0;
  descuentoPctGlobal = 0;
  descuentoImporteGlobal = 0;
  totalFinalGlobal = 0;
  facturasEmitidas = [];
  currentWaText = "";
  currentWaLink = "";

  document.getElementById("cuit").value = "";
  document.getElementById("domicilioRemito").value = "";
  document.getElementById("descuentoPct").value = "0";
  document.getElementById("descuentoImporte").value = "0";
  document.getElementById("condicionVenta").value = "Transferencia Bancaria";

  try { localStorage.removeItem(DRAFT_KEY); } catch {}

  updateItemsListUI();
  renderManualList();
  recalcTotals();
  hideResultBox();
  showDraftPill(false);

  mostrarAlerta("✅ Listo. Nuevo borrador.", "success");
  switchTab("capture");
}

function showDraftPill(show) {
  const pill = document.getElementById("draftModePill");
  if (!pill) return;
  if (show) pill.classList.remove("hidden");
  else pill.classList.add("hidden");
}

function clearItems() {
  itemsGlobal = [];
  updateItemsListUI();
  renderManualList();
  recalcTotals();
  saveDraft();
  mostrarAlerta("🧹 Ítems limpiados.", "success");
}

// =========================
// HEALTH / ONLINE BADGE
// =========================
async function healthOnce() {
  try {
    const r = await fetch(`${BASE}/health`, { cache: "no-store" });
    if (!r.ok) throw new Error("bad");
    const j = await r.json();
    statusBadge.className = "bg-emerald-100 text-emerald-700 text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-wide";
    statusBadge.textContent = "Online";
    return j;
  } catch {
    statusBadge.className = "bg-red-100 text-red-700 text-[10px] font-black px-2 py-1 rounded-full uppercase tracking-wide";
    statusBadge.textContent = "Offline";
    return null;
  }
}
function startHealthPolling() {
  healthOnce();
  setInterval(healthOnce, 15000);
}

// =========================
// PDF FLOW
// =========================
async function procesarArchivo(e) {
  if (!e.target.files || !e.target.files.length) return;

  loaderUI.classList.remove("hidden");
  statusAlert.classList.add("hidden");

  btnMainAction.disabled = true;
  btnMainAction.classList.add("opacity-50");

  const formData = new FormData();
  for (let i = 0; i < e.target.files.length; i++) formData.append("remito", e.target.files[i]);

  try {
    const r = await fetch(`${BASE}/leer-remito`, { method: "POST", body: formData });
    const res = await r.json();
    if (!r.ok) throw new Error(res.detail || "Error al procesar");

    // Fill base
    document.getElementById("cuit").value = res.cuit || "";
    domicilioRemitoGlobal = res.domicilioRemito || "";
    document.getElementById("domicilioRemito").value = domicilioRemitoGlobal;

    itemsGlobal = Array.isArray(res.items) ? res.items : [];
    subtotalBrutoGlobal = Number(res.subtotalBruto || 0);
    descuentoPctGlobal = Number(res.descuentoPct || 0);
    descuentoImporteGlobal = Number(res.descuentoImporte || 0);
    totalFinalGlobal = Number(res.total || 0);

    document.getElementById("descuentoPct").value = String(descuentoPctGlobal || 0);
    document.getElementById("descuentoImporte").value = String(descuentoImporteGlobal || 0);

    updateItemsListUI();
    renderManualList();
    recalcTotals(true);

    saveDraft();

    loaderUI.classList.add("hidden");
    mostrarAlerta(`✅ ¡Listo! ${itemsGlobal.length} ítems extraídos.`, "success");
    setTimeout(() => switchTab("preview"), 700);

  } catch (err) {
    loaderUI.classList.add("hidden");
    mostrarAlerta(`❌ Error: ${err.message}`, "error");
  } finally {
    btnMainAction.disabled = false;
    btnMainAction.classList.remove("opacity-50");
    inputPdf.value = "";
  }
}

// =========================
// ITEMS UI (Datos)
// =========================
function updateItemsListUI() {
  const list = document.getElementById("itemsList");
  const count = document.getElementById("itemCount");
  if (count) count.textContent = itemsGlobal.length;

  if (!list) return;

  if (itemsGlobal.length === 0) {
    list.innerHTML = `<div class="text-sm text-slate-400 italic text-center py-4">No hay artículos.</div>`;
    return;
  }

  list.innerHTML = itemsGlobal.map((it, idx) => `
    <div class="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-100">
      <div class="max-w-[70%]">
        <div class="font-black text-slate-800 text-sm truncate">${escapeHtml(it.descripcion || "")}</div>
        <div class="text-xs text-slate-500 font-bold">${Number(it.cantidad || 0)} un · $${moneyAR(Number(it.precioConIva || 0))} c/u</div>
      </div>
      <div class="flex items-center gap-2">
        <div class="text-sm font-black text-slate-900">$${moneyAR(Number(it.subtotalConIva || 0))}</div>
        <button class="btn bg-white border border-slate-200 rounded-lg px-2 py-2" onclick="openItemModal(${idx})" aria-label="Editar">
          ✎
        </button>
      </div>
    </div>
  `).join("");
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (m) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[m]));
}

// =========================
// ITEMS UI (Manual Tab)
// =========================
function renderManualList() {
  const list = document.getElementById("itemsListManual");
  const count = document.getElementById("itemCountManual");
  if (count) count.textContent = itemsGlobal.length;

  if (!list) return;

  if (itemsGlobal.length === 0) {
    list.innerHTML = `<div class="text-sm text-slate-400 italic text-center py-6">Agregá ítems para emitir manual.</div>`;
    document.getElementById("txtTotalManual").textContent = "$0,00";
    return;
  }

  list.innerHTML = itemsGlobal.map((it, idx) => `
    <div class="flex justify-between items-center bg-slate-50 p-3 rounded-2xl border border-slate-100">
      <div class="max-w-[72%]">
        <div class="font-black text-slate-900 text-sm truncate">${escapeHtml(it.descripcion || "")}</div>
        <div class="text-xs text-slate-500 font-bold">${Number(it.cantidad || 0)} un · $${moneyAR(Number(it.precioConIva || 0))} c/u</div>
      </div>
      <div class="flex items-center gap-2">
        <div class="text-sm font-black text-slate-900">$${moneyAR(Number(it.subtotalConIva || 0))}</div>
        <button class="btn bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-black" onclick="openItemModal(${idx})">Editar</button>
      </div>
    </div>
  `).join("");

  refreshManualTotalsPills();
}

function refreshManualTotalsPills() {
  const total = Number(totalFinalGlobal || 0);
  const sub = Number(subtotalBrutoGlobal || 0);
  document.getElementById("txtTotalManual").textContent = `$${moneyAR(total)}`;

  const pillSub = document.getElementById("pillSubtotalManual");
  const pillDesc = document.getElementById("pillDescManual");

  const hasDesc = (Number(descuentoImporteGlobal || 0) > 0 || Number(descuentoPctGlobal || 0) > 0) && sub > 0 && total > 0 && total < sub;
  if (hasDesc) {
    pillSub.classList.remove("hidden");
    pillDesc.classList.remove("hidden");
    pillSub.textContent = `Subtotal $${moneyAR(sub)}`;
    const d = round2(sub - total);
    pillDesc.textContent = `Desc -$${moneyAR(d)}`;
  } else {
    pillSub.classList.add("hidden");
    pillDesc.classList.add("hidden");
  }
}

// =========================
// ITEM MODAL (ADD/EDIT)
// =========================
window.openItemModal = function(idx) {
  editingIndex = Number(idx);
  const isEdit = editingIndex >= 0;

  modalTitle.textContent = isEdit ? "Editar ítem" : "Agregar ítem";
  btnDeleteItem.classList.toggle("hidden", !isEdit);
  btnSaveItem.classList.toggle("col-span-2", !isEdit);

  if (isEdit) {
    const it = itemsGlobal[editingIndex];
    m_desc.value = String(it.descripcion || "");
    m_qty.value = String(Number(it.cantidad || 1));
    m_unit.value = String(Number(it.precioConIva || 0));
  } else {
    m_desc.value = "";
    m_qty.value = "1";
    m_unit.value = "";
  }

  modalItem.classList.remove("hidden");
  setTimeout(() => m_desc.focus(), 50);
};

function closeItemModal() {
  modalItem.classList.add("hidden");
  editingIndex = -1;
}

function saveItemFromModal() {
  const desc = String(m_desc.value || "").trim();
  const qty = Number(m_qty.value || 0);
  const unit = Number(m_unit.value || 0);

  if (!desc) return mostrarAlerta("Falta descripción.", "info");
  if (!(qty > 0)) return mostrarAlerta("Cantidad inválida.", "info");
  if (!(unit > 0)) return mostrarAlerta("Precio inválido.", "info");

  const subtotal = round2(qty * unit);
  const item = { cantidad: qty, descripcion: desc, precioConIva: round2(unit), subtotalConIva: subtotal };

  if (editingIndex >= 0) itemsGlobal[editingIndex] = item;
  else itemsGlobal.push(item);

  updateItemsListUI();
  renderManualList();
  recalcTotals();
  saveDraft();

  closeItemModal();
  mostrarAlerta("✅ Ítem guardado.", "success");
}

function deleteItemFromModal() {
  if (editingIndex < 0) return;
  itemsGlobal.splice(editingIndex, 1);
  updateItemsListUI();
  renderManualList();
  recalcTotals();
  saveDraft();

  closeItemModal();
  mostrarAlerta("🗑️ Ítem eliminado.", "success");
}

// =========================
// TOTALS + DISCOUNT
// =========================
function recalcTotals(fromPdf = false) {
  // Subtotal bruto = suma de items (si venís de PDF y tu backend ya calculó subtotalBrutoGlobal,
  // lo respetamos SOLO si tiene sentido (>= sumaItems). Si no, recalculamos con items.)
  const sum = sumItems();
  const existingSub = Number(subtotalBrutoGlobal || 0);

  if (!fromPdf) subtotalBrutoGlobal = sum;
  else {
    // si backend dio subtotalBruto, úsalo; si no, sum
    subtotalBrutoGlobal = existingSub > 0 ? existingSub : sum;
  }

  // descuento
  descuentoPctGlobal = Number(document.getElementById("descuentoPct")?.value || descuentoPctGlobal || 0);
  descuentoImporteGlobal = Number(document.getElementById("descuentoImporte")?.value || descuentoImporteGlobal || 0);

  // total final:
  let total = sum;

  // Si estás en modo remito: totalFinalGlobal viene del backend y ya es el total post-desc.
  // Pero si el usuario toca descuento manualmente, recalculamos.
  const userTouchedDiscount = (descuentoPctGlobal > 0 || descuentoImporteGlobal > 0);

  if (userTouchedDiscount) {
    const subForDisc = subtotalBrutoGlobal > 0 ? subtotalBrutoGlobal : sum;
    if (descuentoImporteGlobal > 0) total = round2(subForDisc - descuentoImporteGlobal);
    else if (descuentoPctGlobal > 0) total = round2(subForDisc * (1 - (descuentoPctGlobal / 100)));
    else total = sum;
  } else {
    // si venís de PDF y backend dio totalFinalGlobal úsalo; si no, sum
    if (fromPdf && Number(totalFinalGlobal || 0) > 0) total = Number(totalFinalGlobal || 0);
    else total = sum;
  }

  if (total < 0) total = 0;
  totalFinalGlobal = round2(total);

  // Update preview top
  const totalEl = document.getElementById("txtTotal");
  if (totalEl) totalEl.textContent = `$${moneyAR(totalFinalGlobal)}`;

  const subEl = document.getElementById("txtSubtotal");
  const pctEl = document.getElementById("txtDescPct");

  const hasDesc = subtotalBrutoGlobal > 0 && totalFinalGlobal > 0 && totalFinalGlobal < subtotalBrutoGlobal - 0.005;
  if (hasDesc) {
    subEl.classList.remove("hidden");
    subEl.textContent = `$${moneyAR(subtotalBrutoGlobal)}`;

    pctEl.classList.remove("hidden");
    const pct = (descuentoPctGlobal > 0) ? descuentoPctGlobal : round2(((subtotalBrutoGlobal - totalFinalGlobal) / subtotalBrutoGlobal) * 100);
    pctEl.textContent = `DESC ${moneyAR(pct)}%`;
  } else {
    subEl.classList.add("hidden");
    pctEl.classList.add("hidden");
  }

  // Manual tab badges
  refreshManualTotalsPills();
}

// =========================
// PREVIEW RAIL + IFRAME
// =========================
async function buildPreviewRail() {
  const cuit = (document.getElementById("cuit").value || "").trim();
  if (itemsGlobal.length === 0 || !cuit || cuit.length < 11) {
    // igual dejamos ver todo si hay items
    if (itemsGlobal.length === 0) return;
  }

  const partes = Math.max(1, Math.ceil(itemsGlobal.length / ITEMS_POR_FACTURA));
  const rail = document.getElementById("railPartes");
  rail.innerHTML = `
    <div onclick="loadIframe('ALL', this)" class="snap-center shrink-0 w-[40%] bg-slate-950 text-white rounded-2xl p-4 shadow-sm active:scale-95 transition flex flex-col justify-center items-center cursor-pointer border-2 border-slate-950 rail-card-active">
      <span class="block font-black text-lg">VER TODO</span>
      <span class="block text-[10px] text-slate-500 font-black uppercase">${partes} Partes</span>
    </div>
  `;

  for (let i = 1; i <= partes; i++) {
    rail.innerHTML += `
      <div onclick="loadIframe(${i}, this)" class="snap-center shrink-0 w-[50%] bg-white rounded-2xl p-4 shadow-sm border border-slate-200 active:bg-blue-50 transition cursor-pointer flex flex-col justify-between">
        <div class="flex justify-between items-center mb-1">
          <span class="text-xs font-black text-blue-600">Parte ${i}</span>
          <div class="w-2 h-2 rounded-full bg-slate-200 status-dot"></div>
        </div>
        <div class="text-[10px] text-slate-400 font-bold">Toque para ver</div>
      </div>
    `;
  }

  const first = rail.querySelector(".rail-card-active");
  await loadIframe("ALL", first);
}

window.loadIframe = async function(parteNum, element) {
  const rail = document.getElementById("railPartes");
  rail.querySelectorAll(".snap-center").forEach(el => {
    el.classList.remove("border-blue-500", "border-2", "rail-card-active", "bg-slate-950", "text-white");
    el.classList.add("bg-white", "text-slate-900", "border-slate-200");
    const dot = el.querySelector(".status-dot");
    if (dot) dot.classList.replace("bg-blue-500", "bg-slate-200");
  });

  if (parteNum === "ALL") {
    element.classList.add("bg-slate-950", "text-white", "border-slate-950", "rail-card-active");
  } else {
    element.classList.add("border-blue-500", "border-2", "rail-card-active");
    const dot = element.querySelector(".status-dot");
    if (dot) dot.classList.replace("bg-slate-200", "bg-blue-500");
  }

  const container = document.getElementById("previewContainer");
  container.classList.add("animate-pulse");

  pullFormIntoGlobals();
  recalcTotals();

  const payload = {
    cuitCliente: (document.getElementById("cuit").value || "").trim(),
    domicilioRemito: (document.getElementById("domicilioRemito").value || "").trim(),
    condicionVenta: document.getElementById("condicionVenta").value,
    items: itemsGlobal,
    subtotalBruto: subtotalBrutoGlobal,
    descuentoPct: descuentoPctGlobal,
    descuentoImporte: descuentoImporteGlobal,
    total: totalFinalGlobal,
    previewParte: parteNum
  };

  try {
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
  } catch (e) {
    console.error(e);
  } finally {
    container.classList.remove("animate-pulse");
  }
};

// =========================
// EMITIR (MANUAL o PDF)
// =========================
async function emitirFactura() {
  const cuit = (document.getElementById("cuit").value || "").trim();
  if (!cuit || cuit.length !== 11) return mostrarAlerta("❗ CUIT inválido (11 números).", "info");
  if (!itemsGlobal.length) return mostrarAlerta("❗ No hay ítems para facturar.", "info");

  // UX: disable
  const btn = document.getElementById("btnEmitir");
  btn.disabled = true;
  btn.classList.add("opacity-50");
  mostrarAlerta("⏳ Emitiendo… (ARCA + PDF)", "info");
  hideResultBox();

  pullFormIntoGlobals();
  recalcTotals();

  const payload = {
    cuitCliente: cuit,
    domicilioRemito: (document.getElementById("domicilioRemito").value || "").trim(),
    condicionVenta: document.getElementById("condicionVenta").value,
    items: itemsGlobal,
    subtotalBruto: subtotalBrutoGlobal,
    descuentoPct: descuentoPctGlobal,
    descuentoImporte: descuentoImporteGlobal,
    total: totalFinalGlobal
    // emailCliente: "" // opcional, si querés pedirlo en UI después
  };

  try {
    const r = await fetch(`${BASE}/facturar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const res = await r.json();
    if (!r.ok) throw new Error(res?.message || "Error al facturar");

    facturasEmitidas = Array.isArray(res.facturas) ? res.facturas : [];
    currentWaLink = res.waLink || "";
    currentWaText = buildWaTextFallback(res);

    // Guardar draft (por si querés reimprimir / reenviar)
    saveDraft();

    mostrarAlerta(`✅ ${res.mensaje || "Factura emitida"}`, "success");
    showResultBox(res);

  } catch (err) {
    mostrarAlerta(`❌ ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.classList.remove("opacity-50");
  }
}

function buildWaTextFallback(res) {
  // Si por algún motivo faltara waLink, armamos un texto mínimo
  const receptor = res?.receptor?.nombre || "Cliente";
  const cuit = res?.receptor?.cuit || "";
  let t = `Factura - Mercado Limpio\nCliente: ${receptor}\nCUIT: ${cuit}\n\n`;
  (res?.facturas || []).forEach((f, idx) => {
    t += `Parte ${idx + 1}: ${String(f.nroFactura || "").padStart(8, "0")} | $${moneyAR(f.total || 0)} | CAE: ${f.cae}\n`;
    if (f.pdfUrl) t += `PDF: ${f.pdfUrl}\n`;
    t += "\n";
  });
  return t.trim();
}

// =========================
// RESULT UI
// =========================
function hideResultBox() {
  document.getElementById("resultBox")?.classList.add("hidden");
}

function showResultBox(res) {
  const box = document.getElementById("resultBox");
  const list = document.getElementById("resultList");
  const title = document.getElementById("resultTitle");
  const btnWa = document.getElementById("btnShareWa");

  if (!box || !list || !title || !btnWa) return;

  title.textContent = res?.mensaje || "Factura emitida";
  list.innerHTML = "";

  const facts = Array.isArray(res?.facturas) ? res.facturas : [];
  if (!facts.length) {
    list.innerHTML = `<div class="text-sm text-slate-500 font-bold">Sin datos de comprobantes.</div>`;
  } else {
    list.innerHTML = facts.map((f, i) => `
      <div class="bg-slate-50 border border-slate-100 rounded-2xl p-3">
        <div class="flex justify-between items-center">
          <div class="text-xs font-black text-slate-500 uppercase">Parte ${i + 1}</div>
          <div class="text-xs font-black text-slate-700">CAE ${escapeHtml(f.cae || "")}</div>
        </div>
        <div class="mt-1 flex justify-between items-center">
          <div class="text-sm font-black text-slate-900">Comp. ${String(f.nroFactura || "").padStart(8, "0")}</div>
          <div class="text-sm font-black text-slate-900">$${moneyAR(f.total || 0)}</div>
        </div>
        <div class="mt-2 flex gap-2">
          ${f.pdfUrl ? `<a class="btn bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-black" href="${f.pdfUrl}" target="_blank" rel="noopener">Abrir PDF</a>` : ""}
          ${f.pdfUrl ? `<button class="btn bg-slate-950 text-white rounded-xl px-3 py-2 text-xs font-black" onclick="copyToClipboard('${escapeJs(f.pdfUrl)}')">Copiar link</button>` : ""}
        </div>
      </div>
    `).join("");
  }

  box.classList.remove("hidden");
}

function escapeJs(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

window.copyToClipboard = async function(text) {
  try {
    await navigator.clipboard.writeText(text);
    mostrarAlerta("✅ Link copiado.", "success");
  } catch {
    mostrarAlerta("❌ No pude copiar (iOS a veces bloquea).", "error");
  }
};

// =========================
// SHARE
// =========================
async function shareWhatsAppDirect() {
  if (currentWaLink) return window.open(currentWaLink, "_blank");
  const text = currentWaText || `Factura - Mercado Limpio\nTotal: $${moneyAR(totalFinalGlobal)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

async function shareNative() {
  // Si ya emitiste, compartimos el waLink (mejor que texto)
  const link = currentWaLink || "";
  const text = currentWaText || `Factura - Mercado Limpio\nTotal: $${moneyAR(totalFinalGlobal)}`;

  if (navigator.share) {
    try {
      // iOS: share link si existe
      if (link) await navigator.share({ title: "Factura", text: "Enviar factura por WhatsApp", url: link });
      else await navigator.share({ title: "Factura", text });
    } catch {
      // cancelado
    }
  } else {
    // fallback
    if (link) window.open(link, "_blank");
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }
}
