/* Mercado Limpio — Facturación Móvil (GitHub Pages)
   - Inbox PDFs persistente (IndexedDB)
   - Agrupa por CUIT
   - Prepara factura re-parseando PDFs seleccionados (para descuento global correcto)
   - Preview por partes + ALL
   - Emitir /facturar y WA link + historial local
*/

(() => {
  "use strict";

  // =========================
  // CONFIG
  // =========================
  const DEFAULT_BASE = "https://api-mercadolimpio.onrender.com";
  const ITEMS_POR_FACTURA = 25; // debe coincidir con backend
  const LS_KEY = "ml_fact_mobile_v1";
  const LS_HIST = "ml_fact_hist_v1";
  const DB_NAME = "ml_fact_db";
  const DB_VER = 1;
  const STORE = "remitos";

  // =========================
  // DOM
  // =========================
  const $ = (id) => document.getElementById(id);

  const badgeApi = $("badgeApi");

  const pageInbox = $("pageInbox");
  const pageFactura = $("pageFactura");
  const pageHist = $("pageHist");
  const pageSet = $("pageSet");

  const navBtns = Array.from(document.querySelectorAll(".navbtn"));

  const toast = $("toast");
  const toastT = $("toastT");
  const toastD = $("toastD");

  const modal = $("modal");
  const modalTitle = $("modalTitle");
  const modalSub = $("modalSub");
  const modalList = $("modalList");
  const modalEmpty = $("modalEmpty");
  const btnCloseModal = $("btnCloseModal");
  const btnPrepareFromGroup = $("btnPrepareFromGroup");
  const btnDeleteSelected = $("btnDeleteSelected");

  // Inbox controls
  const fileInput = $("fileInput");
  const btnAddPdfs = $("btnAddPdfs");
  const btnParseAll = $("btnParseAll");
  const btnSyncInbox = $("btnSyncInbox");
  const btnClearInbox = $("btnClearInbox");
  const groupsList = $("groupsList");
  const emptyGroups = $("emptyGroups");
  const pillInboxCount = $("pillInboxCount");
  const pillGroups = $("pillGroups");

  // Factura controls
  const btnBackToInbox = $("btnBackToInbox");
  const btnResetDraft = $("btnResetDraft");

  const inpCuit = $("inpCuit");
  const inpEmail = $("inpEmail");
  const inpDom = $("inpDom");
  const selCondicion = $("selCondicion");

  const btnPreviewAll = $("btnPreviewAll");
  const btnPreviewPart1 = $("btnPreviewPart1");
  const btnCopyWA = $("btnCopyWA");

  const auditBox = $("auditBox");
  const pillAudit = $("pillAudit");

  const btnMic = $("btnMic");
  const inpCmd = $("inpCmd");
  const btnRunCmd = $("btnRunCmd");

  const btnAddItem = $("btnAddItem");
  const btnApplyDraftTotals = $("btnApplyDraftTotals");
  const itemsBox = $("itemsBox");
  const pillItems = $("pillItems");
  const lblTotals = $("lblTotals");

  const inpSubBruto = $("inpSubBruto");
  const inpDescPct = $("inpDescPct");
  const inpDescImp = $("inpDescImp");
  const inpTotalFinal = $("inpTotalFinal");

  const btnEmitir = $("btnEmitir");

  const partsChips = $("partsChips");
  const previewFrame = $("previewFrame");
  const pillPreview = $("pillPreview");

  const lblClientName = $("lblClientName");
  const pillDraftMode = $("pillDraftMode");

  // Hist
  const histList = $("histList");
  const emptyHist = $("emptyHist");
  const btnClearHist = $("btnClearHist");

  // Settings
  const inpApiBase = $("inpApiBase");
  const btnSaveApi = $("btnSaveApi");
  const btnPing = $("btnPing");
  const pillApiOk = $("pillApiOk");

  // =========================
  // STATE
  // =========================
  const state = {
    base: DEFAULT_BASE,
    inbox: [], // local cache (metadata) from DB
    groups: [],
    activeGroupCuit: null,
    activeGroupIds: new Set(),

    // Draft (current invoice)
    draft: {
      source: "none", // "pdf" | "manual"
      cuit: "",
      nombre: "",
      domicilioRemito: "",
      domicilioAfip: "",
      condicionVenta: "Transferencia Bancaria",
      emailCliente: "",
      items: [], // {descripcion,cantidad,precioConIva,subtotalConIva}
      subtotalBruto: 0,
      descuentoPct: 0,
      descuentoImporte: 0,
      totalFinal: 0,
      parts: 1,
      lastWA: ""
    }
  };

  // =========================
  // HELPERS
  // =========================
  const onlyDigits = (s) => String(s ?? "").replace(/\D/g, "");
  const round2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;

  function formatMoneyAR(n) {
    try {
      return new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(Number(n || 0));
    } catch {
      return String(n);
    }
  }

  function parseMoneyArToNumber(v) {
    const s = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? round2(n) : 0;
  }

  function toastShow(title, detail = "", ms = 2600) {
    toastT.textContent = title || "OK";
    toastD.textContent = detail || "";
    toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove("show"), ms);
  }

  function setPill(el, text, kind = "") {
    el.textContent = text;
    el.classList.remove("ok", "warn", "bad");
    if (kind) el.classList.add(kind);
  }

  function api(urlPath) {
    const base = state.base.replace(/\/+$/g, "");
    const path = String(urlPath || "").startsWith("/") ? urlPath : `/${urlPath}`;
    return base + path;
  }

  function saveSettings() {
    localStorage.setItem(LS_KEY, JSON.stringify({ base: state.base }));
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const j = JSON.parse(raw);
      if (j?.base) state.base = String(j.base);
    } catch {}
  }

  function navTo(which) {
    pageInbox.style.display = which === "inbox" ? "" : "none";
    pageFactura.style.display = which === "factura" ? "" : "none";
    pageHist.style.display = which === "hist" ? "" : "none";
    pageSet.style.display = which === "set" ? "" : "none";

    navBtns.forEach(b => b.classList.toggle("active", b.dataset.nav === which));
  }

  // =========================
  // INDEXEDDB
  // =========================
  function dbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const st = db.createObjectStore(STORE, { keyPath: "id" });
          st.createIndex("by_status", "status", { unique: false });
          st.createIndex("by_cuit", "cuit", { unique: false });
          st.createIndex("by_created", "createdAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPutMany(records) {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      for (const r of records) st.put(r);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbGetAll() {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const st = tx.objectStore(STORE);
      const req = st.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbDeleteMany(ids) {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      for (const id of ids) st.delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbClear() {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const req = st.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGetByIds(ids) {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const st = tx.objectStore(STORE);
      const out = [];
      let pending = ids.length;
      if (!pending) return resolve(out);

      ids.forEach((id) => {
        const req = st.get(id);
        req.onsuccess = () => {
          if (req.result) out.push(req.result);
          pending--;
          if (pending === 0) resolve(out);
        };
        req.onerror = () => reject(req.error);
      });
    });
  }

  // =========================
  // INBOX LOGIC
  // =========================
  function uid() {
    return "r_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  }

  async function addFiles(files) {
    const arr = Array.from(files || []);
    if (!arr.length) return;

    const now = Date.now();
    const recs = arr.map(f => ({
      id: uid(),
      createdAt: now,
      fileName: f.name,
      mime: f.type || "application/pdf",
      size: f.size || 0,
      blob: f, // File is a Blob
      status: "pending", // pending | parsed | error
      cuit: "",
      domicilioRemito: "",
      total: 0,
      subtotalBruto: 0,
      descuentoPct: 0,
      descuentoImporte: 0,
      parseMs: 0,
      err: ""
    }));

    await dbPutMany(recs);
    toastShow("PDFs guardados", `${recs.length} archivo(s) en Inbox`);
    await refreshInbox();
  }

  function groupInbox(inboxRecords) {
    const groups = new Map();
    for (const r of inboxRecords) {
      const cuit = r.cuit && r.cuit.length === 11 ? r.cuit : "PENDIENTE";
      if (!groups.has(cuit)) groups.set(cuit, []);
      groups.get(cuit).push(r);
    }

    const out = [];
    for (const [cuit, list] of groups.entries()) {
      list.sort((a, b) => b.createdAt - a.createdAt);
      const parsedOk = list.filter(x => x.status === "parsed").length;
      const pending = list.filter(x => x.status === "pending").length;
      const err = list.filter(x => x.status === "error").length;
      const sumTotal = round2(list.reduce((a, x) => a + Number(x.total || 0), 0));
      out.push({ cuit, list, parsedOk, pending, err, sumTotal });
    }

    // Orden: CUIT real arriba, pendientes abajo
    out.sort((a, b) => {
      const ap = a.cuit === "PENDIENTE" ? 1 : 0;
      const bp = b.cuit === "PENDIENTE" ? 1 : 0;
      if (ap !== bp) return ap - bp;
      return b.sumTotal - a.sumTotal;
    });

    return out;
  }

  async function refreshInbox() {
    const all = await dbGetAll();
    all.sort((a, b) => b.createdAt - a.createdAt);
    state.inbox = all;
    state.groups = groupInbox(all);

    renderInbox();
  }

  function renderInbox() {
    const count = state.inbox.length;
    pillInboxCount.textContent = `${count} PDF${count === 1 ? "" : "s"}`;

    pillGroups.textContent = `${state.groups.length} grupo${state.groups.length === 1 ? "" : "s"}`;

    groupsList.innerHTML = "";
    emptyGroups.style.display = state.groups.length ? "none" : "block";

    for (const g of state.groups) {
      const isPendingGroup = g.cuit === "PENDIENTE";
      const title = isPendingGroup ? "Pendientes (sin CUIT)" : `CUIT ${g.cuit}`;
      const pillKind = g.err ? "bad" : (g.pending ? "warn" : "ok");
      const pillTxt = isPendingGroup
        ? `${g.pending} pendientes`
        : `${g.list.length} PDF • $ ${formatMoneyAR(g.sumTotal)}`;

      const sub = isPendingGroup
        ? "Parseá para detectar CUIT/total."
        : `${g.parsedOk}/${g.list.length} parseados • ${g.pending} pendientes • ${g.err} con error`;

      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="item-top">
          <div>
            <div class="item-title">${title}</div>
            <div class="item-sub">${sub}</div>
          </div>
          <span class="pill ${pillKind}">${pillTxt}</span>
        </div>
        <div class="hr"></div>
        <div class="row">
          <button class="btn ${isPendingGroup ? "" : "primary"}" data-open="${g.cuit}">Abrir</button>
          ${isPendingGroup ? "" : `<button class="btn" data-quick="${g.cuit}">🧠 Preparar</button>`}
        </div>
      `;
      groupsList.appendChild(div);
    }

    // bind
    groupsList.querySelectorAll("[data-open]").forEach(btn => {
      btn.addEventListener("click", () => openGroup(btn.getAttribute("data-open")));
    });
    groupsList.querySelectorAll("[data-quick]").forEach(btn => {
      btn.addEventListener("click", () => openGroup(btn.getAttribute("data-quick"), true));
    });
  }

  async function parseOneRecord(record) {
    // /leer-remito expects multipart 'remito' (array)
    const fd = new FormData();
    fd.append("remito", record.blob, record.fileName);

    const t0 = Date.now();
    const r = await fetch(api("/leer-remito"), { method: "POST", body: fd });
    const ms = Date.now() - t0;

    let json;
    try { json = await r.json(); } catch { json = null; }

    if (!r.ok) {
      const detail = json?.detail ? String(json.detail) : (json?.message || "Error parseando PDF");
      return {
        ...record,
        status: "error",
        err: detail,
        parseMs: ms
      };
    }

    return {
      ...record,
      status: "parsed",
      cuit: String(json?.cuit || ""),
      domicilioRemito: String(json?.domicilioRemito || ""),
      total: Number(json?.total || 0),
      subtotalBruto: Number(json?.subtotalBruto || 0),
      descuentoPct: Number(json?.descuentoPct || 0),
      descuentoImporte: Number(json?.descuentoImporte || 0),
      parseMs: ms,
      err: ""
    };
  }

  async function parsePending(limit = 8) {
    const pending = state.inbox.filter(r => r.status === "pending").slice(0, limit);
    if (!pending.length) {
      toastShow("Nada pendiente", "No hay PDFs para parsear.");
      return;
    }

    toastShow("Parseando…", `${pending.length} PDF(s)`, 1600);

    const updated = [];
    for (const rec of pending) {
      try {
        const u = await parseOneRecord(rec);
        updated.push(u);
      } catch (e) {
        updated.push({ ...rec, status: "error", err: String(e?.message || e), parseMs: 0 });
      }
    }

    await dbPutMany(updated);
    await refreshInbox();

    const ok = updated.filter(x => x.status === "parsed").length;
    const bad = updated.filter(x => x.status === "error").length;
    toastShow("Listo", `Parseados: ${ok} • Errores: ${bad}`);
  }

  async function openGroup(cuitKey, quickPrepare = false) {
    state.activeGroupCuit = cuitKey;
    state.activeGroupIds = new Set();

    const g = state.groups.find(x => x.cuit === cuitKey);
    modalTitle.textContent = (cuitKey === "PENDIENTE") ? "Pendientes" : `Grupo CUIT ${cuitKey}`;
    modalSub.textContent = (cuitKey === "PENDIENTE")
      ? "Estos PDFs todavía no tienen CUIT detectado. Parsealos primero."
      : "Seleccioná remitos del mismo CUIT y tocá “Preparar factura”.";

    modalList.innerHTML = "";
    if (!g || !g.list.length) {
      modalEmpty.style.display = "block";
    } else {
      modalEmpty.style.display = "none";
      for (const r of g.list) {
        const dt = new Date(r.createdAt);
        const when = `${dt.toLocaleDateString("es-AR")} ${dt.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}`;
        const st = r.status === "parsed" ? "ok" : (r.status === "error" ? "bad" : "warn");
        const stTxt = r.status === "parsed" ? "Parsed" : (r.status === "error" ? "Error" : "Pendiente");

        const line = document.createElement("div");
        line.className = "item";
        line.innerHTML = `
          <div class="item-top">
            <div style="display:flex; gap:10px; align-items:flex-start">
              <input type="checkbox" data-sel="${r.id}" ${r.status !== "parsed" ? "disabled" : ""} style="transform:scale(1.2); margin-top:2px" />
              <div>
                <div class="item-title">${r.fileName}</div>
                <div class="item-sub">${when} • ${(r.size/1024/1024).toFixed(2)} MB</div>
                <div class="small muted">${r.domicilioRemito ? r.domicilioRemito : ""}</div>
              </div>
            </div>
            <span class="pill ${st}">${stTxt}${r.total ? ` • $ ${formatMoneyAR(r.total)}` : ""}</span>
          </div>
          ${r.err ? `<div class="hr"></div><div class="small" style="color:#fecaca">${r.err}</div>` : ""}
        `;
        modalList.appendChild(line);
      }

      modalList.querySelectorAll("[data-sel]").forEach(cb => {
        cb.addEventListener("change", () => {
          const id = cb.getAttribute("data-sel");
          if (cb.checked) state.activeGroupIds.add(id);
          else state.activeGroupIds.delete(id);
        });
      });

      if (quickPrepare) {
        // auto-select all parsed in group
        g.list.filter(x => x.status === "parsed").forEach(x => state.activeGroupIds.add(x.id));
        modalList.querySelectorAll("[data-sel]").forEach(cb => {
          const id = cb.getAttribute("data-sel");
          if (state.activeGroupIds.has(id)) cb.checked = true;
        });
      }
    }

    modal.classList.add("show");
  }

  function closeModal() {
    modal.classList.remove("show");
  }

  async function deleteSelectedInGroup() {
    const ids = Array.from(state.activeGroupIds);
    if (!ids.length) {
      toastShow("Nada seleccionado", "Marcá PDFs para borrar.");
      return;
    }
    await dbDeleteMany(ids);
    toastShow("Borrado", `${ids.length} PDF(s) eliminado(s)`);
    closeModal();
    await refreshInbox();
  }

  // Re-parse selected PDFs together (to keep discount global correct)
  async function prepareInvoiceFromSelected() {
    const ids = Array.from(state.activeGroupIds);
    if (!ids.length) {
      toastShow("Falta selección", "Elegí al menos 1 PDF (parsed).");
      return;
    }

    const recs = await dbGetByIds(ids);
    if (!recs.length) return;

    // Build FormData with multiple remitos
    const fd = new FormData();
    recs.forEach(r => fd.append("remito", r.blob, r.fileName));

    toastShow("Preparando…", `Remitos: ${recs.length}`, 1800);

    const r = await fetch(api("/leer-remito"), { method: "POST", body: fd });
    const j = await r.json().catch(() => null);

    if (!r.ok) {
      const detail = j?.detail ? String(j.detail) : (j?.message || "Error en /leer-remito");
      toastShow("Error", detail, 4500);
      return;
    }

    // Draft from parsed bundle
    setDraftFromParsed(j);
    closeModal();
    navTo("factura");
    await refreshPreview("ALL");
  }

  // =========================
  // DRAFT / FACTURA
  // =========================
  function draftReset() {
    state.draft = {
      source: "none",
      cuit: "",
      nombre: "",
      domicilioRemito: "",
      domicilioAfip: "",
      condicionVenta: "Transferencia Bancaria",
      emailCliente: "",
      items: [],
      subtotalBruto: 0,
      descuentoPct: 0,
      descuentoImporte: 0,
      totalFinal: 0,
      parts: 1,
      lastWA: ""
    };
    renderDraft();
  }

  function setDraftFromParsed(parsed) {
    // parsed: {cuit, domicilioRemito, items, total, subtotalBruto, descuentoPct, descuentoImporte}
    state.draft.source = "pdf";
    state.draft.cuit = String(parsed?.cuit || "");
    state.draft.domicilioRemito = String(parsed?.domicilioRemito || "");
    state.draft.items = Array.isArray(parsed?.items) ? parsed.items.map(normalizeItem) : [];
    state.draft.subtotalBruto = Number(parsed?.subtotalBruto || 0);
    state.draft.descuentoPct = Number(parsed?.descuentoPct || 0);
    state.draft.descuentoImporte = Number(parsed?.descuentoImporte || 0);
    state.draft.totalFinal = Number(parsed?.total || parsed?.totalFinal || 0);

    state.draft.parts = Math.max(1, Math.ceil(state.draft.items.length / ITEMS_POR_FACTURA));
    renderDraft();
  }

  function normalizeItem(x) {
    const cantidad = Number(x?.cantidad || 0);
    const descripcion = String(x?.descripcion || "").trim();
    const precioConIva = round2(Number(x?.precioConIva || 0));
    const subtotalConIva = round2(Number(x?.subtotalConIva || (cantidad * precioConIva) || 0));
    return { cantidad, descripcion, precioConIva, subtotalConIva };
  }

  function recomputeDraftTotalsFromItems() {
    const sum = round2(state.draft.items.reduce((a, it) => a + Number(it.subtotalConIva || 0), 0));
    // si totalFinal está vacío, lo calculamos
    if (!(state.draft.totalFinal > 0)) state.draft.totalFinal = sum;

    // si subtotalBruto y descuentoImporte/pct no están, inferimos
    if (state.draft.subtotalBruto > 0 && state.draft.totalFinal > 0) {
      state.draft.descuentoImporte = round2(state.draft.subtotalBruto - state.draft.totalFinal);
      if (state.draft.descuentoImporte > 0 && state.draft.subtotalBruto > 0) {
        if (!(state.draft.descuentoPct > 0)) {
          state.draft.descuentoPct = round2((state.draft.descuentoImporte / state.draft.subtotalBruto) * 100);
        }
      }
    } else if (state.draft.descuentoPct > 0) {
      // si hay pct pero no subtotalBruto, estimamos
      state.draft.subtotalBruto = round2(state.draft.totalFinal / (1 - (state.draft.descuentoPct / 100)));
      state.draft.descuentoImporte = round2(state.draft.subtotalBruto - state.draft.totalFinal);
    }

    state.draft.parts = Math.max(1, Math.ceil(state.draft.items.length / ITEMS_POR_FACTURA));
  }

  function renderDraft() {
    badgeApi.textContent = `API: ${state.base}`;
    inpApiBase.value = state.base;

    const d = state.draft;

    // header pills
    pillDraftMode.textContent = d.source === "pdf" ? "Desde PDF" : (d.source === "manual" ? "Manual" : "Borrador");
    pillDraftMode.classList.remove("ok","warn","bad");
    pillDraftMode.classList.add(d.source === "pdf" ? "ok" : "warn");

    // fields
    inpCuit.value = d.cuit || "";
    inpDom.value = d.domicilioRemito || "";
    selCondicion.value = d.condicionVenta || "Transferencia Bancaria";
    inpEmail.value = d.emailCliente || "";

    inpSubBruto.value = d.subtotalBruto ? formatMoneyAR(d.subtotalBruto) : "";
    inpDescPct.value = d.descuentoPct ? String(d.descuentoPct).replace(".", ",") : "";
    inpDescImp.value = d.descuentoImporte ? formatMoneyAR(d.descuentoImporte) : "";
    inpTotalFinal.value = d.totalFinal ? formatMoneyAR(d.totalFinal) : "";

    // items
    pillItems.textContent = `${d.items.length} ítem${d.items.length === 1 ? "" : "s"}`;
    renderItems();

    // parts chips
    renderPartsChips();

    // totals label
    const sumItems = round2(d.items.reduce((a, it) => a + Number(it.subtotalConIva || 0), 0));
    lblTotals.textContent = `Ítems: $ ${formatMoneyAR(sumItems)} • Total final: $ ${formatMoneyAR(d.totalFinal || sumItems)} • Partes: ${d.parts}`;

    // audit
    renderAudit();
  }

  function renderItems() {
    itemsBox.innerHTML = "";
    const d = state.draft;

    d.items.forEach((it, idx) => {
      const div = document.createElement("div");
      div.className = "it";
      div.innerHTML = `
        <div class="it-grid">
          <input class="input" data-k="desc" data-i="${idx}" value="${escapeHtml(it.descripcion)}" placeholder="Descripción" />
          <input class="input mono" data-k="qty" data-i="${idx}" value="${it.cantidad || ""}" inputmode="numeric" placeholder="Cant" />
          <input class="input mono" data-k="unit" data-i="${idx}" value="${it.precioConIva ? formatMoneyAR(it.precioConIva) : ""}" inputmode="decimal" placeholder="Precio c/IVA" />
        </div>
        <div class="small muted" style="margin-top:8px; display:flex; justify-content:space-between; gap:10px">
          <span>Subtotal c/IVA</span>
          <strong>$ ${formatMoneyAR(it.subtotalConIva || 0)}</strong>
        </div>
        <div class="it-actions">
          <button class="btn" data-dup="${idx}">Duplicar</button>
          <button class="btn bad" data-del="${idx}">Borrar</button>
        </div>
      `;
      itemsBox.appendChild(div);
    });

    // bind edits
    itemsBox.querySelectorAll("input[data-k]").forEach(inp => {
      inp.addEventListener("input", () => {
        const i = Number(inp.getAttribute("data-i"));
        const k = inp.getAttribute("data-k");
        const v = inp.value;

        const it = state.draft.items[i];
        if (!it) return;

        if (k === "desc") it.descripcion = v;
        if (k === "qty") it.cantidad = Math.max(0, Number(String(v).replace(/\D/g, "")) || 0);
        if (k === "unit") it.precioConIva = parseMoneyArToNumber(v);

        // recompute subtotal
        it.subtotalConIva = round2((it.cantidad || 0) * (it.precioConIva || 0));
        recomputeDraftTotalsFromItems();
        renderDraft(); // simple + safe
      });
    });

    itemsBox.querySelectorAll("[data-dup]").forEach(b => {
      b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-dup"));
        const it = state.draft.items[i];
        if (!it) return;
        state.draft.items.splice(i + 1, 0, { ...it });
        recomputeDraftTotalsFromItems();
        renderDraft();
      });
    });

    itemsBox.querySelectorAll("[data-del]").forEach(b => {
      b.addEventListener("click", () => {
        const i = Number(b.getAttribute("data-del"));
        state.draft.items.splice(i, 1);
        recomputeDraftTotalsFromItems();
        renderDraft();
      });
    });
  }

  function renderPartsChips() {
    partsChips.innerHTML = "";

    const d = state.draft;
    const parts = Math.max(1, d.parts || 1);

    const chipAll = document.createElement("div");
    chipAll.className = "chip";
    chipAll.textContent = "Vista completa";
    chipAll.addEventListener("click", async () => {
      await refreshPreview("ALL");
      setActiveChip("ALL");
    });
    partsChips.appendChild(chipAll);

    for (let p = 1; p <= parts; p++) {
      const c = document.createElement("div");
      c.className = "chip";
      c.textContent = `Parte ${p}`;
      c.dataset.part = String(p);
      c.addEventListener("click", async () => {
        await refreshPreview(p);
        setActiveChip(String(p));
      });
      partsChips.appendChild(c);
    }
  }

  function setActiveChip(key) {
    Array.from(partsChips.querySelectorAll(".chip")).forEach(c => {
      const p = c.dataset.part || "ALL";
      c.classList.toggle("active", p === String(key));
      if (!c.dataset.part && key === "ALL") c.classList.add("active");
      if (!c.dataset.part && key !== "ALL") c.classList.remove("active");
    });
  }

  function auditItem(ok, label, detail = "") {
    const div = document.createElement("div");
    div.className = "audit-row";
    const tag = document.createElement("span");
    tag.className = "audit-tag " + (ok === true ? "ok" : ok === "warn" ? "warn" : "bad");
    tag.textContent = ok === true ? "OK" : ok === "warn" ? "ATENCIÓN" : "ERROR";
    div.innerHTML = `<div><strong>${escapeHtml(label)}</strong><div class="small muted" style="margin-top:2px">${escapeHtml(detail)}</div></div>`;
    div.appendChild(tag);
    return div;
  }

  function renderAudit() {
    auditBox.innerHTML = "";
    const d = state.draft;

    const cuit = onlyDigits(d.cuit);
    const hasCuit = cuit.length === 11;

    const itemsOk = d.items.length > 0;
    const sumItems = round2(d.items.reduce((a, it) => a + Number(it.subtotalConIva || 0), 0));
    const totalFinal = Number(d.totalFinal || 0);

    // checks
    auditBox.appendChild(auditItem(hasCuit, "CUIT válido (11 dígitos)", hasCuit ? cuit : "Completá CUIT para emitir"));
    auditBox.appendChild(auditItem(itemsOk, "Ítems", itemsOk ? `${d.items.length} ítems detectados` : "Agregá/parseá ítems"));

    const totalOk = totalFinal > 0;
    auditBox.appendChild(auditItem(totalOk, "Total final", totalOk ? `$ ${formatMoneyAR(totalFinal)}` : "Falta total final"));

    // coherencia subtotal vs descuento
    const hasSub = Number(d.subtotalBruto || 0) > 0;
    const hasDesc = Number(d.descuentoImporte || 0) > 0 || Number(d.descuentoPct || 0) > 0;

    let descOk = true;
    let descDetail = "Sin descuento";
    if (hasSub && hasDesc && totalFinal > 0) {
      const exp = round2(Number(d.subtotalBruto || 0) - Number(d.descuentoImporte || 0));
      const delta = Math.abs(exp - totalFinal);
      descOk = delta <= Math.max(2, totalFinal * 0.003);
      descDetail = `Subtotal $${formatMoneyAR(d.subtotalBruto)} • Dto $${formatMoneyAR(d.descuentoImporte)} • Total $${formatMoneyAR(totalFinal)} • Δ ${formatMoneyAR(delta)}`;
    } else if (hasDesc && !hasSub) {
      descOk = "warn";
      descDetail = "Hay descuento pero falta subtotal bruto.";
    }

    auditBox.appendChild(auditItem(descOk === true ? true : descOk, "Descuento coherente", descDetail));

    // split info
    const parts = Math.max(1, d.parts || 1);
    auditBox.appendChild(auditItem(true, "Split", parts > 1 ? `${parts} partes (25 ítems/parte)` : "1 parte"));

    // overall pill
    const anyBad = [hasCuit, itemsOk, totalOk].some(x => !x) || descOk === false;
    setPill(pillAudit, anyBad ? "Revisar" : "OK", anyBad ? "warn" : "ok");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;");
  }

  // =========================
  // PREVIEW
  // =========================
  async function refreshPreview(previewParte = "ALL") {
    const d = state.draft;
    const cuit = onlyDigits(inpCuit.value);
    if (cuit.length < 11 && d.items.length === 0) {
      toastShow("Preview", "Cargá ítems o completá CUIT.");
      return;
    }

    // normalize items payload
    const items = d.items.map(normalizeItem).filter(it => it.cantidad > 0 && it.precioConIva > 0 && it.subtotalConIva > 0);

    const payload = {
      previewParte,
      cuitCliente: cuit || d.cuit,
      domicilioRemito: String(inpDom.value || d.domicilioRemito || ""),
      condicionVenta: String(selCondicion.value || d.condicionVenta || "Transferencia Bancaria"),
      items,
      subtotalBruto: Number(parseMoneyArToNumber(inpSubBruto.value) || d.subtotalBruto || 0),
      descuentoPct: Number(parseMoneyArToNumber(inpDescPct.value) || d.descuentoPct || 0),
      descuentoImporte: Number(parseMoneyArToNumber(inpDescImp.value) || d.descuentoImporte || 0),
      total: Number(parseMoneyArToNumber(inpTotalFinal.value) || d.totalFinal || 0)
    };

    setPill(pillPreview, "Cargando…", "warn");

    const r = await fetch(api("/debug/preview"), {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });

    if (r.status === 204) {
      setPill(pillPreview, "Sin datos", "warn");
      return;
    }

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      setPill(pillPreview, "Error", "bad");
      toastShow("Preview error", t.slice(0, 220) || "Error generando preview", 5000);
      return;
    }

    const html = await r.text();
    // show in iframe via srcdoc
    previewFrame.srcdoc = html;
    setPill(pillPreview, (String(previewParte).toUpperCase() === "ALL") ? "Vista completa" : `Parte ${previewParte}`, "ok");
  }

  // =========================
  // EMITIR
  // =========================
  async function emitir() {
    // pull latest from UI into draft
    const d = state.draft;

    d.cuit = onlyDigits(inpCuit.value);
    d.emailCliente = String(inpEmail.value || "").trim();
    d.domicilioRemito = String(inpDom.value || "").trim();
    d.condicionVenta = String(selCondicion.value || d.condicionVenta);

    d.subtotalBruto = parseMoneyArToNumber(inpSubBruto.value) || Number(d.subtotalBruto || 0);
    d.descuentoPct = parseMoneyArToNumber(inpDescPct.value) || Number(d.descuentoPct || 0);
    d.descuentoImporte = parseMoneyArToNumber(inpDescImp.value) || Number(d.descuentoImporte || 0);
    d.totalFinal = parseMoneyArToNumber(inpTotalFinal.value) || Number(d.totalFinal || 0);

    d.items = d.items.map(normalizeItem).filter(it => it.cantidad > 0 && it.precioConIva > 0 && it.subtotalConIva > 0);
    recomputeDraftTotalsFromItems();

    // audit minimal
    if (d.cuit.length !== 11) return toastShow("Falta CUIT", "Ingresá 11 dígitos.", 4200);
    if (!d.items.length) return toastShow("Faltan ítems", "Agregá/parseá ítems.", 4200);
    if (!(d.totalFinal > 0)) return toastShow("Falta total", "Completá total final.", 4200);

    btnEmitir.disabled = true;
    toastShow("Emitiendo…", "Autorizando en ARCA / ARCA", 1800);

    const payload = {
      cuitCliente: d.cuit,
      domicilioRemito: d.domicilioRemito,
      condicionVenta: d.condicionVenta,
      items: d.items,
      subtotalBruto: d.subtotalBruto || 0,
      descuentoPct: d.descuentoPct || 0,
      descuentoImporte: d.descuentoImporte || 0,
      total: d.totalFinal || round2(d.items.reduce((a, it) => a + it.subtotalConIva, 0)),
    };
    if (d.emailCliente) payload.emailCliente = d.emailCliente;

    try {
      const r = await fetch(api("/facturar"), {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(() => null);

      if (!r.ok) {
        const msg = j?.message || "Error al facturar";
        const detail = j?.detail ? String(j.detail) : "";
        toastShow("Error", `${msg}\n${detail}`.trim(), 6500);
        btnEmitir.disabled = false;
        return;
      }

      // Save WA + history
      const waLink = j?.waLink ? String(j.waLink) : "";
      d.lastWA = waLink;

      const facturas = Array.isArray(j?.facturas) ? j.facturas : [];
      const pv = j?.puntoDeVenta ?? "";
      const receiverName = j?.receptor?.nombre || d.nombre || "";

      toastShow("Autorizado ✅", `${j?.mensaje || "Factura emitida"}\nPartes: ${facturas.length || 1}`, 4500);

      addHistory({
        at: Date.now(),
        cuit: d.cuit,
        nombre: receiverName,
        pv,
        facturas,
        waLink,
        total: round2(facturas.reduce((a, x) => a + Number(x.total || 0), 0)) || d.totalFinal
      });

      // open WhatsApp
      if (waLink) {
        window.open(waLink, "_blank");
      }

      btnEmitir.disabled = false;
      renderHistory();

    } catch (e) {
      toastShow("Error", String(e?.message || e), 6500);
      btnEmitir.disabled = false;
    }
  }

  // =========================
  // HISTORY
  // =========================
  function getHist() {
    try {
      const raw = localStorage.getItem(LS_HIST);
      const j = raw ? JSON.parse(raw) : [];
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }

  function setHist(arr) {
    localStorage.setItem(LS_HIST, JSON.stringify(arr.slice(0, 80)));
  }

  function addHistory(entry) {
    const h = getHist();
    h.unshift(entry);
    setHist(h);
  }

  function renderHistory() {
    const h = getHist();
    histList.innerHTML = "";
    emptyHist.style.display = h.length ? "none" : "block";

    h.forEach((x) => {
      const dt = new Date(x.at);
      const when = `${dt.toLocaleDateString("es-AR")} ${dt.toLocaleTimeString("es-AR", {hour:"2-digit",minute:"2-digit"})}`;
      const parts = Array.isArray(x.facturas) ? x.facturas.length : 1;

      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="item-top">
          <div>
            <div class="item-title">${escapeHtml(x.nombre || "Cliente")}</div>
            <div class="item-sub">CUIT ${escapeHtml(x.cuit || "")} • ${when} • ${parts} parte(s)</div>
          </div>
          <span class="pill ok">$ ${formatMoneyAR(x.total || 0)}</span>
        </div>
        <div class="hr"></div>
        <div class="row">
          <button class="btn" data-wa="${escapeHtml(x.waLink || "")}">WhatsApp</button>
          <button class="btn" data-copy="${escapeHtml(x.waLink || "")}">Copiar texto</button>
        </div>
      `;
      histList.appendChild(div);
    });

    histList.querySelectorAll("[data-wa]").forEach(b => {
      b.addEventListener("click", () => {
        const url = b.getAttribute("data-wa");
        if (url) window.open(url, "_blank");
      });
    });
    histList.querySelectorAll("[data-copy]").forEach(b => {
      b.addEventListener("click", async () => {
        const url = b.getAttribute("data-copy");
        if (!url) return;
        // wa.me/?text=...
        const u = new URL(url);
        const text = u.searchParams.get("text") || url;
        await navigator.clipboard.writeText(decodeURIComponent(text));
        toastShow("Copiado", "Texto WhatsApp en portapapeles");
      });
    });
  }

  // =========================
  // COMMANDS / DICTATION
  // =========================
  function runCommand(raw) {
    const text = String(raw || "").trim().toLowerCase();
    if (!text) return;

    // comandos
    // - cuit 30...
    // - condicion transferencia / efectivo / cheque
    // - descuento 7 / descuento 32127
    // - total 123456
    // - agregar 12 lavandina 1500
    // - emitir

    if (text.startsWith("cuit")) {
      const d = onlyDigits(text);
      if (d.length === 11) {
        inpCuit.value = d;
        state.draft.cuit = d;
        toastShow("CUIT", d);
        renderDraft();
      } else {
        toastShow("CUIT", "No detecté 11 dígitos");
      }
      return;
    }

    if (text.includes("condicion") || text.includes("condición")) {
      if (text.includes("transfer")) selCondicion.value = "Transferencia Bancaria";
      else if (text.includes("efect")) selCondicion.value = "Efectivo";
      else if (text.includes("cheq")) selCondicion.value = "Cheque";
      state.draft.condicionVenta = selCondicion.value;
      toastShow("Condición", state.draft.condicionVenta);
      renderDraft();
      return;
    }

    if (text.startsWith("descuento")) {
      const nums = text.match(/(\d{1,3}(?:[.,]\d{1,2})?)/);
      if (nums) {
        const n = Number(String(nums[1]).replace(",", "."));
        if (n > 0 && n < 90) {
          inpDescPct.value = String(n).replace(".", ",");
          state.draft.descuentoPct = n;
          toastShow("Descuento %", `${n}%`);
        } else {
          // importe
          inpDescImp.value = formatMoneyAR(parseMoneyArToNumber(nums[1]));
          state.draft.descuentoImporte = parseMoneyArToNumber(nums[1]);
          toastShow("Descuento $", `$ ${formatMoneyAR(state.draft.descuentoImporte)}`);
        }
        renderDraft();
      }
      return;
    }

    if (text.startsWith("total")) {
      const nums = text.match(/(\d[\d.,]+)/);
      if (nums) {
        const v = parseMoneyArToNumber(nums[1]);
        inpTotalFinal.value = formatMoneyAR(v);
        state.draft.totalFinal = v;
        toastShow("Total", `$ ${formatMoneyAR(v)}`);
        renderDraft();
      }
      return;
    }

    if (text.startsWith("agregar") || text.startsWith("add")) {
      // "agregar 12 lavandina 1500"
      const m = text.match(/agregar\s+(\d+)\s+(.+?)\s+(\d[\d.,]+)/);
      if (m) {
        const qty = Number(m[1] || 0);
        const desc = String(m[2] || "").trim();
        const unit = parseMoneyArToNumber(m[3]);
        if (qty > 0 && desc && unit > 0) {
          state.draft.items.push({
            cantidad: qty,
            descripcion: desc,
            precioConIva: unit,
            subtotalConIva: round2(qty * unit)
          });
          state.draft.source = "manual";
          recomputeDraftTotalsFromItems();
          toastShow("Ítem agregado", `${qty} • ${desc} • $ ${formatMoneyAR(unit)}`);
          renderDraft();
        }
      } else {
        toastShow("Formato", "Ej: agregar 12 lavandina 1500");
      }
      return;
    }

    if (text.includes("emitir")) {
      emitir();
      return;
    }

    toastShow("Comando", "No entendí. Ej: agregar 12 lavandina 1500");
  }

  function setupSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      btnMic.disabled = true;
      btnMic.textContent = "🎙️ No disponible";
      return null;
    }

    const rec = new SR();
    rec.lang = "es-AR";
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      const t = ev.results?.[0]?.[0]?.transcript || "";
      inpCmd.value = t;
      runCommand(t);
    };
    rec.onerror = () => toastShow("Dictado", "No se pudo usar el mic. Probá escribir el comando.");
    return rec;
  }

  // =========================
  // WhatsApp text copy
  // =========================
  async function copyWAText() {
    const d = state.draft;
    // si ya emitió, usa link; si no, arma texto provisorio del draft
    if (d.lastWA) {
      const u = new URL(d.lastWA);
      const text = u.searchParams.get("text") || d.lastWA;
      await navigator.clipboard.writeText(decodeURIComponent(text));
      toastShow("Copiado", "Texto WhatsApp de emisión");
      return;
    }

    const sum = round2(d.items.reduce((a, it) => a + Number(it.subtotalConIva || 0), 0));
    const total = d.totalFinal || sum;

    let txt = `Factura Mercado Limpio\n`;
    txt += `CUIT: ${onlyDigits(inpCuit.value || d.cuit)}\n`;
    txt += `Total: $ ${formatMoneyAR(total)}\n`;
    txt += `Condición: ${selCondicion.value}\n`;

    await navigator.clipboard.writeText(txt);
    toastShow("Copiado", "Texto WhatsApp (borrador)");
  }

  // =========================
  // SETTINGS: /health ping
  // =========================
  async function pingHealth() {
    try {
      const r = await fetch(api("/health"));
      const j = await r.json();
      if (!r.ok) throw new Error(j?.message || "Health fail");
      setPill(pillApiOk, "OK", "ok");
      toastShow("API OK", `v: ${j?.version || "—"}`);
    } catch (e) {
      setPill(pillApiOk, "ERROR", "bad");
      toastShow("API ERROR", String(e?.message || e), 5000);
    }
  }

  // =========================
  // BIND UI
  // =========================
  async function init() {
    loadSettings();
    badgeApi.textContent = `API: ${state.base}`;
    inpApiBase.value = state.base;

    // nav
    navBtns.forEach(b => {
      b.addEventListener("click", () => navTo(b.dataset.nav));
    });

    // inbox
    btnAddPdfs.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      await addFiles(fileInput.files);
      fileInput.value = "";
    });

    btnParseAll.addEventListener("click", () => parsePending(10));
    btnSyncInbox.addEventListener("click", refreshInbox);
    btnClearInbox.addEventListener("click", async () => {
      await dbClear();
      toastShow("Inbox vacío", "Se borraron todos los PDFs");
      await refreshInbox();
    });

    // modal
    btnCloseModal.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

    btnDeleteSelected.addEventListener("click", deleteSelectedInGroup);
    btnPrepareFromGroup.addEventListener("click", prepareInvoiceFromSelected);

    // factura nav
    btnBackToInbox.addEventListener("click", () => navTo("inbox"));
    btnResetDraft.addEventListener("click", () => {
      draftReset();
      toastShow("Borrador", "Reset ok");
    });

    // draft field bindings
    inpCuit.addEventListener("input", () => { state.draft.cuit = onlyDigits(inpCuit.value); renderAudit(); });
    inpEmail.addEventListener("input", () => { state.draft.emailCliente = String(inpEmail.value || ""); });
    inpDom.addEventListener("input", () => { state.draft.domicilioRemito = String(inpDom.value || ""); });

    selCondicion.addEventListener("change", () => {
      state.draft.condicionVenta = selCondicion.value;
    });

    inpSubBruto.addEventListener("input", () => { state.draft.subtotalBruto = parseMoneyArToNumber(inpSubBruto.value); renderAudit(); });
    inpDescPct.addEventListener("input", () => { state.draft.descuentoPct = parseMoneyArToNumber(inpDescPct.value); renderAudit(); });
    inpDescImp.addEventListener("input", () => { state.draft.descuentoImporte = parseMoneyArToNumber(inpDescImp.value); renderAudit(); });
    inpTotalFinal.addEventListener("input", () => { state.draft.totalFinal = parseMoneyArToNumber(inpTotalFinal.value); renderAudit(); });

    btnPreviewAll.addEventListener("click", async () => {
      await refreshPreview("ALL");
      setActiveChip("ALL");
    });
    btnPreviewPart1.addEventListener("click", async () => {
      await refreshPreview(1);
      setActiveChip("1");
    });

    btnCopyWA.addEventListener("click", copyWAText);

    btnAddItem.addEventListener("click", () => {
      state.draft.source = "manual";
      state.draft.items.push({ descripcion: "", cantidad: 1, precioConIva: 0, subtotalConIva: 0 });
      recomputeDraftTotalsFromItems();
      renderDraft();
    });

    btnApplyDraftTotals.addEventListener("click", () => {
      // push UI inputs into draft + recompute
      state.draft.subtotalBruto = parseMoneyArToNumber(inpSubBruto.value) || state.draft.subtotalBruto;
      state.draft.descuentoPct = parseMoneyArToNumber(inpDescPct.value) || state.draft.descuentoPct;
      state.draft.descuentoImporte = parseMoneyArToNumber(inpDescImp.value) || state.draft.descuentoImporte;
      state.draft.totalFinal = parseMoneyArToNumber(inpTotalFinal.value) || state.draft.totalFinal;
      recomputeDraftTotalsFromItems();
      renderDraft();
      toastShow("Recalculado", "Totales actualizados");
    });

    btnEmitir.addEventListener("click", emitir);

    // commands
    btnRunCmd.addEventListener("click", () => runCommand(inpCmd.value));
    inpCmd.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runCommand(inpCmd.value);
      }
    });

    const speech = setupSpeech();
    btnMic.addEventListener("click", () => {
      if (!speech) return;
      try {
        speech.start();
        toastShow("Dictado", "Escuchando…", 1200);
      } catch {
        toastShow("Dictado", "No se pudo iniciar. Probá otra vez.");
      }
    });

    // hist
    renderHistory();
    btnClearHist.addEventListener("click", () => {
      setHist([]);
      renderHistory();
      toastShow("Historial", "Borrado");
    });

    // settings
    btnSaveApi.addEventListener("click", () => {
      const v = String(inpApiBase.value || "").trim();
      if (!v.startsWith("http")) {
        toastShow("URL inválida", "Debe empezar con http/https", 4500);
        return;
      }
      state.base = v.replace(/\/+$/g, "");
      badgeApi.textContent = `API: ${state.base}`;
      saveSettings();
      toastShow("Guardado", state.base);
    });
    btnPing.addEventListener("click", pingHealth);

    // initial
    draftReset();
    await refreshInbox();
    await pingHealth();
  }

  // =========================
  // Start
  // =========================
  init().catch((e) => {
    console.error(e);
    toastShow("Error init", String(e?.message || e), 6000);
  });

})();
