"use strict";

/* =========================================================
   CONFIG
========================================================= */
const BASE = "https://api-mercadolimpio.onrender.com";
const ITEMS_POR_FACTURA = 25;
const DRAFT_KEY = "ml_facturacion_draft_v2_native";

/* =========================================================
   STATE
========================================================= */
const state = {
  items: [],
  domicilioRemito: "",
  subtotalBruto: 0,
  descuentoPct: 0,
  descuentoImporte: 0,
  total: 0,

  facturas: [],
  waText: "",
  waLink: "",

  active: "capture",
  editingIndex: -1,

  online: null,
  toastTimer: null
};

/* =========================================================
   DOM refs
========================================================= */
const $ = (id) => document.getElementById(id);

let inputPdf;

document.addEventListener("DOMContentLoaded", () => {
  inputPdf = $("inputPdf");

  // nav
  document.querySelectorAll("[data-screen]").forEach(btn => {
    btn.addEventListener("click", () => switchScreen(btn.getAttribute("data-screen")));
  });

  // primary actions
  $("btnPickPdf")?.addEventListener("click", () => inputPdf.click());
  $("btnMainAction")?.addEventListener("click", onMainAction);

  $("btnGoManual")?.addEventListener("click", () => switchScreen("manual"));
  $("btnGoManual2")?.addEventListener("click", () => switchScreen("manual"));
  $("btnGoManualFromData")?.addEventListener("click", () => switchScreen("manual"));
  $("btnManualGoData")?.addEventListener("click", () => switchScreen("data"));

  $("btnAddItem")?.addEventListener("click", () => openItemSheet(-1));
  $("btnManualAddItem")?.addEventListener("click", () => openItemSheet(-1));
  $("btnManualGoPreview")?.addEventListener("click", () => { recalcTotals(); switchScreen("preview"); });
  $("btnGoPreview")?.addEventListener("click", () => { recalcTotals(); switchScreen("preview"); });

  $("btnClearItems")?.addEventListener("click", clearItems);
  $("btnRecalc")?.addEventListener("click", () => { recalcTotals(); toast("✅ Totales actualizados", "ok"); });

  $("btnEmitir")?.addEventListener("click", emitirFactura);
  $("btnResetDraft")?.addEventListener("click", resetDraft);

  $("btnShareWa")?.addEventListener("click", shareWhatsAppDirect);
  $("btnShareNative")?.addEventListener("click", shareNative);

  // sheet
  $("btnCloseSheet")?.addEventListener("click", closeItemSheet);
  $("sheetBackdrop")?.addEventListener("click", closeItemSheet);
  $("btnSaveItem")?.addEventListener("click", saveItemFromSheet);
  $("btnDeleteItem")?.addEventListener("click", deleteItemFromSheet);

  // inputs -> autosave
  ["cuit", "domicilioRemito", "condicionVenta", "descuentoPct", "descuentoImporte"].forEach(id => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", onFormChanged);
    el.addEventListener("change", onFormChanged);
  });

  // file
  inputPdf?.addEventListener("change", procesarArchivo);

  // init
  loadDraft();
  renderAll();
  startHealthPolling();
  switchScreen("capture", { silent: true });
});

/* =========================================================
   UTIL
========================================================= */
function moneyAR(n){
  const v = Number(n || 0);
  return v.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function round2(n){
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}
function sumItems(){
  return round2(state.items.reduce((a,it) => a + Number(it.subtotalConIva || 0), 0));
}
function escapeHtml(s){
  return String(s || "").replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}
function escapeJs(s){
  return String(s || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function vibrate(ms=10){
  // haptic-lite (Android) - silencioso si no soporta
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch {}
}
function parseNum(str){
  // acepta "1.234,56" / "1234.56" / "1234,56"
  const s = String(str ?? "").trim();
  if (!s) return 0;
  const cleaned = s
    .replace(/\s/g,"")
    .replace(/\./g,"")
    .replace(/,/g,".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/* =========================================================
   TOAST + OVERLAY
========================================================= */
function toast(msg, kind="info", timeout=2800){
  const el = $("toast");
  if (!el) return;

  el.className = `toast ${kind}`;
  el.textContent = msg;
  el.classList.add("show");

  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove("show"), timeout);
}

function overlay(show, { title="Procesando…", sub="Un segundo…", step=1 } = {}){
  const ov = $("overlay");
  if (!ov) return;

  $("overlayTitle").textContent = title;
  $("overlaySub").textContent = sub;

  // steps highlight
  ["st1","st2","st3","st4"].forEach((id, idx) => {
    const el = $(id);
    if (!el) return;
    el.classList.toggle("on", (idx+1) === step);
  });

  ov.classList.toggle("show", !!show);
  ov.setAttribute("aria-hidden", show ? "false" : "true");
}

/* =========================================================
   NAV / SCREENS
========================================================= */
function switchScreen(name, { silent=false } = {}){
  state.active = name;

  // screens
  ["capture","data","manual","preview"].forEach(s => {
    const sc = $(`screen-${s}`);
    if (!sc) return;
    sc.classList.toggle("active", s === name);
  });

  // nav buttons
  $("navCapture")?.classList.toggle("active", name === "capture");
  $("navData")?.classList.toggle("active", name === "data" || name === "manual");
  $("navPreview")?.classList.toggle("active", name === "preview");

  setMainLabel();

  if (!silent) vibrate(8);

  if (name === "preview"){
    pullFormIntoState();
    recalcTotals();
    buildPreviewRail().catch(() => {});
  }
  if (name === "manual"){
    renderManualList();
    refreshManualTotals();
  }
}

function setMainLabel(){
  const lbl = $("btnMainLabel");
  if (!lbl) return;
  if (state.active === "data" || state.active === "manual") lbl.textContent = "Agregar";
  else lbl.textContent = "Procesar";
}

/* =========================================================
   FORM <-> STATE
========================================================= */
function onFormChanged(){
  pullFormIntoState();
  recalcTotals();
  saveDraft();
  renderBadges();
}

function pullFormIntoState(){
  state.domicilioRemito = ($("domicilioRemito")?.value || "").trim();

  state.descuentoPct = parseNum($("descuentoPct")?.value);
  state.descuentoImporte = parseNum($("descuentoImporte")?.value);

  // subtotal base
  state.subtotalBruto = sumItems();
}

function pushStateToForm(){
  if ($("domicilioRemito")) $("domicilioRemito").value = state.domicilioRemito || "";
  if ($("descuentoPct")) $("descuentoPct").value = String(state.descuentoPct || 0);
  if ($("descuentoImporte")) $("descuentoImporte").value = String(state.descuentoImporte || 0);
}

/* =========================================================
   DRAFT
========================================================= */
function saveDraft(){
  const draft = {
    cuit: ($("cuit")?.value || "").trim(),
    domicilioRemito: state.domicilioRemito || "",
    condicionVenta: $("condicionVenta")?.value || "Transferencia Bancaria",
    descuentoPct: Number(state.descuentoPct || 0),
    descuentoImporte: Number(state.descuentoImporte || 0),
    items: state.items,
    ts: Date.now()
  };

  try{
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }catch{}
}

function loadDraft(){
  try{
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);

    if (d?.cuit) $("cuit").value = d.cuit;
    if (d?.domicilioRemito) state.domicilioRemito = d.domicilioRemito;
    if (d?.condicionVenta) $("condicionVenta").value = d.condicionVenta;

    state.descuentoPct = Number(d?.descuentoPct || 0);
    state.descuentoImporte = Number(d?.descuentoImporte || 0);
    state.items = Array.isArray(d?.items) ? d.items : [];

    pushStateToForm();
    recalcTotals();
    renderAll();
  }catch{}
}

function resetDraft(){
  state.items = [];
  state.domicilioRemito = "";
  state.subtotalBruto = 0;
  state.descuentoPct = 0;
  state.descuentoImporte = 0;
  state.total = 0;
  state.facturas = [];
  state.waText = "";
  state.waLink = "";

  if ($("cuit")) $("cuit").value = "";
  if ($("condicionVenta")) $("condicionVenta").value = "Transferencia Bancaria";
  pushStateToForm();

  try{ localStorage.removeItem(DRAFT_KEY); }catch{}

  renderAll();
  hideResultBox();
  toast("✅ Listo. Nuevo borrador.", "ok");
  switchScreen("capture");
}

function renderBadges(){
  const hasDraft = (state.items.length > 0) || !!(($("cuit")?.value || "").trim());
  $("badgeDraft")?.classList.toggle("hidden", !hasDraft);
}

/* =========================================================
   HEALTH / ONLINE
========================================================= */
async function healthOnce(){
  const badge = $("badgeOnline");
  try{
    const r = await fetch(`${BASE}/health`, { cache: "no-store" });
    if (!r.ok) throw new Error("bad");
    await r.json();

    state.online = true;
    if (badge){
      badge.className = "badge ok";
      badge.textContent = "Online";
    }
  }catch{
    state.online = false;
    if (badge){
      badge.className = "badge bad";
      badge.textContent = "Offline";
    }
  }
}
function startHealthPolling(){
  healthOnce();
  setInterval(healthOnce, 15000);
}

/* =========================================================
   MAIN ACTION
========================================================= */
function onMainAction(){
  vibrate(10);
  if (state.active === "data" || state.active === "manual"){
    openItemSheet(-1);
  }else{
    inputPdf.click();
  }
}

/* =========================================================
   PDF FLOW
========================================================= */
async function procesarArchivo(e){
  if (!e.target.files || !e.target.files.length) return;

  hideResultBox();
  overlay(true, { title:"Procesando PDF…", sub:"Subiendo y leyendo remitos", step:1 });

  // disable main
  const fab = $("btnMainAction");
  if (fab) fab.disabled = true;

  const formData = new FormData();
  for (let i = 0; i < e.target.files.length; i++){
    formData.append("remito", e.target.files[i]);
  }

  try{
    overlay(true, { title:"Procesando PDF…", sub:"Extrayendo ítems y totales", step:2 });
    const r = await fetch(`${BASE}/leer-remito`, { method:"POST", body: formData });
    const res = await r.json();
    if (!r.ok) throw new Error(res.detail || "Error al procesar");

    // fill
    $("cuit").value = res.cuit || "";
    state.domicilioRemito = res.domicilioRemito || "";
    $("domicilioRemito").value = state.domicilioRemito;

    state.items = Array.isArray(res.items) ? res.items : [];
    state.subtotalBruto = Number(res.subtotalBruto || 0);
    state.descuentoPct = Number(res.descuentoPct || 0);
    state.descuentoImporte = Number(res.descuentoImporte || 0);
    state.total = Number(res.total || 0);

    $("descuentoPct").value = String(state.descuentoPct || 0);
    $("descuentoImporte").value = String(state.descuentoImporte || 0);

    recalcTotals(true);
    saveDraft();

    renderAll();
    toast(`✅ Listo: ${state.items.length} ítems extraídos`, "ok");
    vibrate(15);

    overlay(false);
    switchScreen("preview");
  }catch(err){
    overlay(false);
    toast(`❌ ${err.message}`, "bad", 4200);
  }finally{
    if (fab) fab.disabled = false;
    inputPdf.value = "";
  }
}

/* =========================================================
   ITEMS UI
========================================================= */
function updateItemsListUI(){
  const list = $("itemsList");
  const count = $("itemCount");
  if (count) count.textContent = String(state.items.length);

  if (!list) return;

  if (!state.items.length){
    list.innerHTML = `<div class="empty">Procesá un PDF o cargá ítems manuales.</div>`;
    return;
  }

  list.innerHTML = state.items.map((it, idx) => `
    <div class="item">
      <div class="left">
        <div class="desc">${escapeHtml(it.descripcion || "")}</div>
        <div class="meta">${Number(it.cantidad || 0)} un · $${moneyAR(Number(it.precioConIva || 0))} c/u</div>
      </div>
      <div class="right">
        <div class="money">$${moneyAR(Number(it.subtotalConIva || 0))}</div>
        <button class="btn ghost mini" style="height:44px" onclick="window.__editItem(${idx})">✎ Editar</button>
      </div>
    </div>
  `).join("");
}

function renderManualList(){
  const list = $("itemsListManual");
  const count = $("itemCountManual");
  if (count) count.textContent = String(state.items.length);

  if (!list) return;

  if (!state.items.length){
    list.innerHTML = `<div class="empty">Agregá ítems para emitir manual.</div>`;
    return;
  }

  list.innerHTML = state.items.map((it, idx) => `
    <div class="item">
      <div class="left">
        <div class="desc">${escapeHtml(it.descripcion || "")}</div>
        <div class="meta">${Number(it.cantidad || 0)} un · $${moneyAR(Number(it.precioConIva || 0))} c/u</div>
      </div>
      <div class="right">
        <div class="money">$${moneyAR(Number(it.subtotalConIva || 0))}</div>
        <button class="btn ghost mini" style="height:44px" onclick="window.__editItem(${idx})">✎ Editar</button>
      </div>
    </div>
  `).join("");
}

window.__editItem = (idx) => openItemSheet(idx);

function clearItems(){
  state.items = [];
  recalcTotals();
  saveDraft();
  renderAll();
  toast("🧹 Ítems limpiados", "ok");
  vibrate(12);
}

/* =========================================================
   ITEM SHEET (ADD/EDIT)
========================================================= */
function openItemSheet(idx){
  state.editingIndex = Number(idx);
  const isEdit = state.editingIndex >= 0;

  const sheet = $("sheetItem");
  const del = $("btnDeleteItem");
  const h = $("sheetH");

  if (h) h.textContent = isEdit ? "Editar ítem" : "Agregar ítem";
  if (del) del.classList.toggle("hidden", !isEdit);

  if (isEdit){
    const it = state.items[state.editingIndex];
    $("m_desc").value = String(it.descripcion || "");
    $("m_qty").value = String(Number(it.cantidad || 1));
    $("m_unit").value = String(Number(it.precioConIva || 0));
  }else{
    $("m_desc").value = "";
    $("m_qty").value = "1";
    $("m_unit").value = "";
  }

  sheet.classList.add("show");
  sheet.setAttribute("aria-hidden", "false");
  setTimeout(() => $("m_desc")?.focus(), 60);
  vibrate(8);
}

function closeItemSheet(){
  const sheet = $("sheetItem");
  sheet.classList.remove("show");
  sheet.setAttribute("aria-hidden", "true");
  state.editingIndex = -1;
}

function saveItemFromSheet(){
  const desc = String($("m_desc").value || "").trim();
  const qty = parseNum($("m_qty").value);
  const unit = parseNum($("m_unit").value);

  if (!desc) return toast("Falta descripción", "info");
  if (!(qty > 0)) return toast("Cantidad inválida", "info");
  if (!(unit > 0)) return toast("Precio inválido", "info");

  const subtotal = round2(qty * unit);
  const item = {
    cantidad: qty,
    descripcion: desc,
    precioConIva: round2(unit),
    subtotalConIva: subtotal
  };

  if (state.editingIndex >= 0) state.items[state.editingIndex] = item;
  else state.items.push(item);

  pullFormIntoState();
  recalcTotals();
  saveDraft();
  renderAll();
  closeItemSheet();
  toast("✅ Ítem guardado", "ok");
  vibrate(14);
}

function deleteItemFromSheet(){
  if (state.editingIndex < 0) return;
  state.items.splice(state.editingIndex, 1);

  pullFormIntoState();
  recalcTotals();
  saveDraft();
  renderAll();
  closeItemSheet();

  toast("🗑️ Ítem eliminado", "ok");
  vibrate(14);
}

/* =========================================================
   TOTALS + DISCOUNT
========================================================= */
function recalcTotals(fromPdf=false){
  const sum = sumItems();
  const existingSub = Number(state.subtotalBruto || 0);

  // subtotal
  if (!fromPdf) state.subtotalBruto = sum;
  else state.subtotalBruto = existingSub > 0 ? existingSub : sum;

  // descuento (desde inputs)
  state.descuentoPct = parseNum($("descuentoPct")?.value);
  state.descuentoImporte = parseNum($("descuentoImporte")?.value);

  // total
  let total = sum;

  const userTouchedDiscount = (state.descuentoPct > 0 || state.descuentoImporte > 0);
  if (userTouchedDiscount){
    const subForDisc = state.subtotalBruto > 0 ? state.subtotalBruto : sum;
    if (state.descuentoImporte > 0) total = round2(subForDisc - state.descuentoImporte);
    else if (state.descuentoPct > 0) total = round2(subForDisc * (1 - (state.descuentoPct / 100)));
    else total = sum;
  }else{
    if (fromPdf && Number(state.total || 0) > 0) total = Number(state.total || 0);
    else total = sum;
  }

  if (total < 0) total = 0;
  state.total = round2(total);

  // preview summary
  if ($("txtTotal")) $("txtTotal").textContent = `$${moneyAR(state.total)}`;

  const hasDesc = state.subtotalBruto > 0 && state.total > 0 && state.total < state.subtotalBruto - 0.005;

  if (hasDesc){
    $("txtSubtotal")?.classList.remove("hidden");
    $("txtSubtotal").textContent = `$${moneyAR(state.subtotalBruto)}`;

    $("chipDescPct")?.classList.remove("hidden");
    const pct = (state.descuentoPct > 0)
      ? state.descuentoPct
      : round2(((state.subtotalBruto - state.total) / state.subtotalBruto) * 100);
    $("chipDescPct").textContent = `DESC ${moneyAR(pct)}%`;
  }else{
    $("txtSubtotal")?.classList.add("hidden");
    $("chipDescPct")?.classList.add("hidden");
  }

  refreshManualTotals();
}

function refreshManualTotals(){
  if ($("txtTotalManual")) $("txtTotalManual").textContent = `$${moneyAR(state.total || 0)}`;

  const hasDesc = state.subtotalBruto > 0 && state.total > 0 && state.total < state.subtotalBruto - 0.005;
  const chip = $("chipDescManual");

  if (hasDesc){
    chip?.classList.remove("hidden");
    $("txtSubtotalManual")?.classList.remove("hidden");
    $("txtSubtotalManual").textContent = `$${moneyAR(state.subtotalBruto)}`;
  }else{
    chip?.classList.add("hidden");
    $("txtSubtotalManual")?.classList.add("hidden");
  }
}

/* =========================================================
   PREVIEW RAIL + IFRAME
========================================================= */
async function buildPreviewRail(){
  const cuit = ($("cuit")?.value || "").trim();
  const rail = $("railPartes");
  if (!rail) return;

  rail.innerHTML = "";

  if (!state.items.length){
    rail.innerHTML = `<div class="empty" style="width:100%;">No hay ítems para previsualizar.</div>`;
    return;
  }

  const partes = Math.max(1, Math.ceil(state.items.length / ITEMS_POR_FACTURA));

  // "ALL"
  rail.appendChild(makeRailCard("ALL", `VER TODO`, `${partes} partes`, true));

  for (let i=1; i<=partes; i++){
    rail.appendChild(makeRailCard(i, `Parte ${i}`, `Toque para ver`, false));
  }

  // load first
  await loadIframe("ALL");
}

function makeRailCard(value, t1, t2, active){
  const div = document.createElement("div");
  div.className = `railCard ${active ? "active" : ""}`;
  div.dataset.value = String(value);

  div.innerHTML = `
    <div class="top">
      <div class="p1">${escapeHtml(t1)}</div>
      <div class="dot"></div>
    </div>
    <div class="p2">${escapeHtml(t2)}</div>
  `;

  div.addEventListener("click", async () => {
    document.querySelectorAll(".railCard").forEach(x => x.classList.remove("active"));
    div.classList.add("active");
    vibrate(8);
    await loadIframe(value);
  });

  return div;
}

async function loadIframe(parteNum){
  const wrap = $("frameWrap");
  const frame = $("previewFrame");
  if (!wrap || !frame) return;

  wrap.classList.add("loading");

  pullFormIntoState();
  recalcTotals();

  const payload = {
    cuitCliente: ($("cuit")?.value || "").trim(),
    domicilioRemito: ($("domicilioRemito")?.value || "").trim(),
    condicionVenta: $("condicionVenta")?.value || "Transferencia Bancaria",
    items: state.items,
    subtotalBruto: state.subtotalBruto,
    descuentoPct: state.descuentoPct,
    descuentoImporte: state.descuentoImporte,
    total: state.total,
    previewParte: parteNum
  };

  try{
    overlay(true, { title:"Generando preview…", sub:"Preparando HTML desde backend", step:3 });
    const r = await fetch(`${BASE}/debug/preview`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });

    if (r.ok){
      const htmlStr = await r.text();
      const doc = frame.contentWindow.document;
      doc.open(); doc.write(htmlStr); doc.close();
    }
  }catch(e){
    // silencioso
  }finally{
    overlay(false);
    wrap.classList.remove("loading");
  }
}

/* =========================================================
   EMITIR
========================================================= */
async function emitirFactura(){
  const cuit = ($("cuit")?.value || "").trim();
  if (!cuit || cuit.length !== 11) return toast("❗ CUIT inválido (11 números)", "info");
  if (!state.items.length) return toast("❗ No hay ítems para facturar", "info");

  hideResultBox();

  const btn = $("btnEmitir");
  if (btn){ btn.disabled = true; }

  pullFormIntoState();
  recalcTotals();

  const payload = {
    cuitCliente: cuit,
    domicilioRemito: ($("domicilioRemito")?.value || "").trim(),
    condicionVenta: $("condicionVenta")?.value || "Transferencia Bancaria",
    items: state.items,
    subtotalBruto: state.subtotalBruto,
    descuentoPct: state.descuentoPct,
    descuentoImporte: state.descuentoImporte,
    total: state.total
  };

  try{
    overlay(true, { title:"Emitiendo…", sub:"ARCA + PDF + links", step:4 });
    toast("⏳ Emitiendo…", "info", 2400);

    const r = await fetch(`${BASE}/facturar`, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });

    const res = await r.json();
    if (!r.ok) throw new Error(res?.message || "Error al facturar");

    state.facturas = Array.isArray(res.facturas) ? res.facturas : [];
    state.waLink = res.waLink || "";
    state.waText = buildWaTextFallback(res);

    saveDraft();
    overlay(false);

    toast(`✅ ${res.mensaje || "Factura emitida"}`, "ok", 3200);
    vibrate(18);
    showResultBox(res);
  }catch(err){
    overlay(false);
    toast(`❌ ${err.message}`, "bad", 4500);
    vibrate(20);
  }finally{
    if (btn){ btn.disabled = false; }
  }
}

function buildWaTextFallback(res){
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

/* =========================================================
   RESULT UI
========================================================= */
function hideResultBox(){
  $("resultBox")?.classList.add("hidden");
}

function showResultBox(res){
  const box = $("resultBox");
  const list = $("resultList");
  const title = $("resultTitle");
  if (!box || !list || !title) return;

  title.textContent = res?.mensaje || "Factura emitida";
  list.innerHTML = "";

  const facts = Array.isArray(res?.facturas) ? res.facturas : [];
  if (!facts.length){
    list.innerHTML = `<div class="empty">Sin datos de comprobantes.</div>`;
  }else{
    list.innerHTML = facts.map((f, i) => `
      <div class="res">
        <div class="resTop">
          <div>Parte ${i + 1}</div>
          <div>CAE ${escapeHtml(f.cae || "")}</div>
        </div>
        <div class="resMid">
          <div class="n">Comp. ${String(f.nroFactura || "").padStart(8, "0")}</div>
          <div class="v">$${moneyAR(f.total || 0)}</div>
        </div>
        <div class="resBtns">
          ${f.pdfUrl ? `<a class="btn ghost mini" style="height:44px" href="${f.pdfUrl}" target="_blank" rel="noopener">📄 Abrir PDF</a>` : ``}
          ${f.pdfUrl ? `<button class="btn dark mini" style="height:44px" onclick="window.__copy('${escapeJs(f.pdfUrl)}')">📋 Copiar link</button>` : ``}
        </div>
      </div>
    `).join("");
  }

  box.classList.remove("hidden");
}

window.__copy = async (text) => {
  try{
    await navigator.clipboard.writeText(text);
    toast("✅ Link copiado", "ok");
    vibrate(10);
  }catch{
    toast("❌ No pude copiar (bloqueo del navegador)", "bad", 3600);
  }
};

/* =========================================================
   SHARE
========================================================= */
async function shareWhatsAppDirect(){
  if (state.waLink) return window.open(state.waLink, "_blank");

  const text = state.waText || `Factura - Mercado Limpio\nTotal: $${moneyAR(state.total)}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

async function shareNative(){
  const link = state.waLink || "";
  const text = state.waText || `Factura - Mercado Limpio\nTotal: $${moneyAR(state.total)}`;

  if (navigator.share){
    try{
      if (link) await navigator.share({ title:"Factura", text:"Enviar factura por WhatsApp", url: link });
      else await navigator.share({ title:"Factura", text });
    }catch{
      // cancelado
    }
  }else{
    if (link) window.open(link, "_blank");
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
  }
}

/* =========================================================
   RENDER
========================================================= */
function renderAll(){
  renderBadges();
  updateItemsListUI();
  renderManualList();
  refreshManualTotals();
  recalcTotals();
}

/* =========================================================
   END
========================================================= */
