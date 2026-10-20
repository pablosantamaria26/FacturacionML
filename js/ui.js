// Capa de interfaz: navegación, selector de mes, indicadores, clientes recientes,
// resumen de la vista previa, centro de pendientes y menú.
// Consume los mismos endpoints que app.js; no implementa reglas fiscales.
(function () {
  const $ = (id) => document.getElementById(id);
  const hoy = new Date();
  const MESES_L = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const MESES_C = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  const fmtCorto = (n) => {
    const a = Math.abs(n);
    if (a >= 1e6) return `$${(n / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 })}M`;
    if (a >= 1e3) return `$${Math.round(n / 1e3).toLocaleString("es-AR")}K`;
    return `$${formatMoneyAR(n)}`;
  };

  // ── Datos del mes (cache en memoria) ─────────────────────────
  const cacheMes = new Map();
  async function datosMes(anio, mes, { fresco = false } = {}) {
    const k = `${anio}-${mes}`;
    if (!fresco && cacheMes.has(k)) return cacheMes.get(k);
    const p = fetch(`${BASE}/historial?${new URLSearchParams({ anio, mes, limit: 500 })}`, { signal: AbortSignal.timeout(20000) })
      .then((r) => r.json())
      .then((j) => { if (!j.ok) throw new Error(j.message || "Sin datos"); return j.facturas || []; });
    cacheMes.set(k, p);
    p.catch(() => cacheMes.delete(k));
    return p;
  }
  const mesAnterior = (anio, mes) => (mes === 1 ? [anio - 1, 12] : [anio, mes - 1]);
  const facturasValidas = (arr) => arr.filter((f) => f.tipoCbte === "FA" && !f.anulado);

  // ── Selector de mes global ───────────────────────────────────
  let selAnio = hoy.getFullYear(), selMes = hoy.getMonth() + 1;
  function poblarMeses() {
    const opts = [];
    for (let i = 0; i < 24; i++) {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      opts.push(`<option value="${d.getFullYear()}-${d.getMonth() + 1}">${MESES_L[d.getMonth()]} ${d.getFullYear()}</option>`);
    }
    document.querySelectorAll("[data-mes-global]").forEach((s) => {
      s.innerHTML = opts.join("");
      s.addEventListener("change", () => {
        const [a, m] = s.value.split("-").map(Number);
        cambiarMes(a, m, "global");
      });
    });
    sincronizarSelect();
  }
  function sincronizarSelect() {
    document.querySelectorAll("[data-mes-global]").forEach((s) => { s.value = `${selAnio}-${selMes}`; });
  }
  function cambiarMes(anio, mes, origen) {
    selAnio = anio; selMes = mes;
    sincronizarSelect();
    if (origen !== "hist") {
      histAnio = anio; histMes = mes;
      $("histBtnNext").disabled = anio === hoy.getFullYear() && mes === hoy.getMonth() + 1;
      histActualizarLabel();
      if ($("tabHistorial").classList.contains("active")) histCargar();
    }
    if (origen !== "email") {
      emailAnio = anio; emailMes = mes;
      if (typeof emailIniciado !== "undefined" && emailIniciado) { emailActualizarLabel(); emailCargarStats(); emailContarEnvios(); }
    }
    cargarKPIs();
  }
  const navHistOriginal = window.histNavMes;
  window.histNavMes = function (dir) { navHistOriginal(dir); cambiarMes(histAnio, histMes, "hist"); };
  const navEmailOriginal = window.emailNavMes;
  window.emailNavMes = function (dir) { navEmailOriginal(dir); cambiarMes(emailAnio, emailMes, "email"); };

  // ── Indicadores del mes ──────────────────────────────────────
  function metricas(facturas, hastaDia) {
    const fs = facturasValidas(facturas).filter((f) => !hastaDia || Number(String(f.fecha).slice(8, 10)) <= hastaDia);
    return { n: fs.length, total: fs.reduce((s, f) => s + Number(f.total || 0), 0), clientes: new Set(fs.map((f) => f.cuit)).size };
  }
  function delta(el, actual, previo, tipo, etiqueta) {
    if (!el) return;
    if (previo == null) { el.textContent = ""; return; }
    const d = actual - previo;
    el.className = "kpi-delta" + (d > 0 ? " up" : d < 0 ? " down" : "");
    let txt;
    if (tipo === "pct") txt = previo > 0 ? `${d >= 0 ? "+" : ""}${Math.round((d / previo) * 100)}%` : (actual > 0 ? "nuevo" : "=");
    else txt = `${d >= 0 ? "+" : ""}${d}`;
    el.innerHTML = `<span>${txt}</span><span class="delta-ref"> vs. ${etiqueta}</span>`;
    el.title = `${txt} vs. ${etiqueta}`;
  }
  async function cargarKPIs() {
    const anio = selAnio, mes = selMes;
    const esActual = anio === hoy.getFullYear() && mes === hoy.getMonth() + 1;
    try {
      const actual = await datosMes(anio, mes, { fresco: esActual });
      if (anio !== selAnio || mes !== selMes) return;
      const m = metricas(actual);
      $("kpiFacturas").textContent = m.n;
      $("kpiTotal").textContent = fmtCorto(m.total);
      $("kpiTotal").title = `$${formatMoneyAR(m.total)}`;
      $("kpiClientes").textContent = m.clientes;
      renderUltimas(actual);
      try {
        const [pa, pm] = mesAnterior(anio, mes);
        const prev = await datosMes(pa, pm);
        if (anio !== selAnio || mes !== selMes) return;
        // Mes en curso: comparar contra los mismos días del mes anterior
        const dia = esActual ? hoy.getDate() : null;
        const p = metricas(prev, dia);
        const etiqueta = esActual ? `1–${dia} ${MESES_C[pm - 1]}` : MESES_C[pm - 1];
        delta($("kpiFacturasDelta"), m.n, p.n, "num", etiqueta);
        delta($("kpiTotalDelta"), m.total, p.total, "pct", etiqueta);
        delta($("kpiClientesDelta"), m.clientes, p.clientes, "num", etiqueta);
      } catch { ["kpiFacturasDelta", "kpiTotalDelta", "kpiClientesDelta"].forEach((id) => { $(id).textContent = ""; }); }
    } catch {
      ["kpiFacturas", "kpiTotal", "kpiClientes"].forEach((id) => { $(id).textContent = "—"; });
    }
  }

  function renderUltimas(facturas) {
    const tb = document.querySelector("#ultimasTabla tbody");
    if (!tb) return;
    const ult = facturas.slice().sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || b.nroFactura - a.nroFactura).slice(0, 6);
    if (!ult.length) { tb.innerHTML = `<tr><td colspan="9" class="muted" style="text-align:center;padding:24px;">Sin comprobantes en este mes</td></tr>`; return; }
    tb.innerHTML = ult.map((f) => {
      const letra = f.tipoCbte === "NC" ? "NC" : letraDeComprobante(f.comprobante);
      const datos = attrJson({ comprobante: f.comprobante, nombre: f.nombre, total: f.total, cuit: f.cuit, emailTo: f.emailTo });
      return `<tr>
        <td>${escHtml(String(f.fecha).split("-").reverse().join("/"))}</td>
        <td class="td-cli">${escHtml(f.nombre)}</td>
        <td class="num">${escHtml(f.cuit)}</td>
        <td>${escHtml(f.comprobante)}</td>
        <td class="r num">${f.total < 0 ? "−" : ""}$${formatMoneyAR(Math.abs(f.total))}</td>
        <td><span class="letra-badge letra-${letra || "M"}">${letra || "—"}</span></td>
        <td>${/EXTRACTO/i.test(f.condicionVenta || "") ? "Extracto" : "Directa"}</td>
        <td>${f.anulado ? `<span class="tag tag-red tag-dot">Anulada</span>` : `<span class="tag tag-green tag-dot">Emitida</span>`}</td>
        <td><div class="acc">
          ${f.pdfUrl ? `<a class="icon-btn" href="${escHtml(urlDescargaPdf(f.pdfUrl, f.comprobante, f.nombre))}" download="${escHtml(nombrePdfComprobante(f.comprobante, f.nombre))}" target="_blank" rel="noopener" title="Descargar PDF" aria-label="Descargar PDF">${ico("download")}</a>` : ""}
          ${!f.anulado ? `<button class="icon-btn" title="Reenviar email" aria-label="Reenviar email" onclick='abrirModalReenviarEmail(${datos})'>${ico("mail")}</button>` : ""}
        </div></td>
      </tr>`;
    }).join("");
  }

  // ── Estado del servidor y arranque en frío ───────────────────
  async function checkServer() {
    const banner = $("coldStartBanner");
    setServerStatus("waking");
    const t = setTimeout(() => banner.classList.add("visible"), 4000);
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(75000) });
      if (!r.ok) throw new Error();
      setServerStatus("online");
      serverAwake = true;
    } catch {
      setServerStatus("offline");
    } finally {
      clearTimeout(t);
      banner.classList.remove("visible");
    }
  }

  // ── Origen de la factura / accesos rápidos ───────────────────
  function origen(modo) {
    haptic();
    if (modo === "extracto") { switchTab("extracto"); return; }
    if (modo === "foto") { window.Camara?.abrir(); return; }
    document.querySelectorAll(".origen-btn").forEach((b) => b.classList.toggle("active", b.dataset.origen === modo));
    $("remitoZone").hidden = modo !== "pdf";
    if (modo === "pdf") $("fileRemito").click();
    if (modo === "manual") setTimeout(() => $("cuit").focus(), 50);
  }
  function marcarOrigen(modo) {
    document.querySelectorAll(".origen-btn").forEach((b) => b.classList.toggle("active", b.dataset.origen === modo));
  }

  // ── Cliente: condición fiscal (padrón) y recientes ───────────
  const padron = new Map();
  async function consultarPadron(cuit) {
    if (padron.has(cuit)) return padron.get(cuit);
    const p = fetch(`${BASE}/padron/${cuit}`, { signal: AbortSignal.timeout(30000) })
      .then((r) => r.json()).then((j) => { if (!j.ok) throw new Error(j.message); return j; });
    padron.set(cuit, p);
    p.catch(() => padron.delete(cuit));
    return p;
  }
  let padronActual = null;
  async function infoCliente() {
    const cuit = $("cuit").value.replace(/\D/g, "");
    const box = $("clienteInfo");
    if (cuit.length !== 11) { box.hidden = true; padronActual = null; pintarPrevia(); return; }
    box.hidden = false;
    box.innerHTML = `<span class="spinner spinner-dark spinner-sm"></span><span>Consultando ARCA…</span>`;
    try {
      const j = await consultarPadron(cuit);
      if ($("cuit").value.replace(/\D/g, "") !== cuit) return;
      padronActual = j;
      const letra = j.comprobante?.letra || "A";
      box.innerHTML = `${ico("building", "ic-sm")}<strong>${escHtml(j.nombre)}</strong><span class="muted">${escHtml(j.condicionIVA)}${j.condicionConfirmada ? "" : " (no confirmada)"}</span><span class="letra-badge letra-${letra}">Factura ${letra}</span>`;
    } catch {
      padronActual = null;
      box.innerHTML = `${ico("info", "ic-sm")}<span class="muted">No se pudo consultar ARCA ahora. Al emitir, el servidor vuelve a verificar.</span>`;
    }
    pintarPrevia();
  }

  async function clientesRecientes() {
    const [pa, pm] = mesAnterior(hoy.getFullYear(), hoy.getMonth() + 1);
    const listas = await Promise.allSettled([datosMes(hoy.getFullYear(), hoy.getMonth() + 1), datosMes(pa, pm)]);
    const porCuit = new Map();
    for (const l of listas) for (const f of (l.value || [])) {
      if (f.tipoCbte !== "FA" || !f.cuit) continue;
      const prev = porCuit.get(f.cuit);
      if (!prev || String(f.fecha) > String(prev.fecha)) porCuit.set(f.cuit, { cuit: f.cuit, nombre: f.nombre, fecha: f.fecha, email: f.emailTo || prev?.email || "" });
    }
    return [...porCuit.values()].sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  }
  async function mostrarRecientes(filtro = "") {
    const box = $("recientes");
    const lista = (await clientesRecientes()).filter((c) => !filtro || c.cuit.startsWith(filtro));
    if (!lista.length || (filtro.length === 11)) { box.hidden = true; return; }
    box.innerHTML = `<div class="recientes-tit">Clientes recientes</div>` + lista.slice(0, 6).map((c) =>
      `<button type="button" class="reciente" data-cuit="${escHtml(c.cuit)}"><div><strong>${escHtml(c.nombre)}</strong><span>CUIT ${escHtml(c.cuit)}</span></div><span>${escHtml(String(c.fecha).split("-").reverse().join("/"))}</span></button>`).join("");
    box.hidden = false;
    box.querySelectorAll(".reciente").forEach((b) => b.addEventListener("click", () => {
      const c = lista.find((x) => x.cuit === b.dataset.cuit);
      $("cuit").value = c.cuit;
      const email = getEmailForCuit(c.cuit) || c.email;
      if (email && !$("email").value) $("email").value = email;
      box.hidden = true;
      $("cuit").dispatchEvent(new Event("input"));
      triggerPreviewNow();
      $("monto").focus();
    }));
  }
  function toggleRecientes() {
    const box = $("recientes");
    if (!box.hidden) { box.hidden = true; return; }
    mostrarRecientes($("cuit").value.replace(/\D/g, ""));
  }

  // ── Resumen de la vista previa ───────────────────────────────
  let ultimaPrevia = { cuit: "", items: [], total: 0 };
  function resumenPrevia(d) { ultimaPrevia = d; pintarPrevia(); }
  function pintarPrevia() {
    const cuit = $("cuit").value.replace(/\D/g, "");
    const total = ultimaPrevia.total || 0;
    const ok = cuit.length === 11 && total > 0;
    const letra = padronActual?.comprobante?.letra;
    $("prevTipo").className = "letra-badge" + (letra ? ` letra-${letra}` : "");
    $("prevTipo").textContent = letra ? `Factura ${letra}` : "—";
    $("prevCliente").textContent = padronActual?.nombre || (cuit.length === 11 ? "Consultando…" : "—");
    $("prevCond").textContent = padronActual?.condicionIVA || "—";
    $("prevCuit").textContent = cuit || "—";
    $("prevVenta").textContent = $("condicionVenta").value;
    const n = (ultimaPrevia.items || []).length;
    $("prevItems").textContent = n ? `${n} ítem${n !== 1 ? "s" : ""}${n > 25 ? ` · ${Math.ceil(n / 25)} facturas` : ""}` : "—";
    $("prevTotal").textContent = total > 0 ? `$${formatMoneyAR(total)}` : "—";
    const tag = $("prevEstado");
    tag.className = "tag" + (ok ? " tag-green tag-dot" : "");
    tag.textContent = ok ? "Datos completos" : (cuit.length !== 11 ? "Falta el CUIT" : "Falta el monto");
  }

  // ── Centro de pendientes ─────────────────────────────────────
  async function calcularPendientes() {
    const items = [];
    try {
      const pend = JSON.parse(localStorage.getItem("ml_pending_emission") || "null");
      if (pend && Date.now() - pend.ts < 10 * 60 * 1000) items.push({
        tono: "tone-orange", icono: "refresh", titulo: "Emisión sin confirmar",
        texto: `Se cortó una emisión para el CUIT ${escHtml(pend.payload?.cuitCliente)}. Antes de reintentar, revisá en el Historial si ya se emitió.`,
        acciones: [["Revisar y reintentar", "location.reload()"]],
      });
    } catch {}
    try {
      const ext = JSON.parse(localStorage.getItem("ml_ultimo_extracto") || "null");
      if (ext && Date.now() - ext.ts < 7 * 24 * 3600 * 1000) items.push({
        tono: "tone-red", icono: "bank",
        titulo: ext.interrumpido ? "Facturación de extracto interrumpida" : `Extracto con ${ext.errores.length} error${ext.errores.length !== 1 ? "es" : ""}`,
        texto: (ext.interrumpido ? "Volvé a facturar el extracto: lo ya emitido se omite solo. " : "") +
          ext.errores.slice(0, 4).map((e) => `${escHtml(e.nombre)}: ${escHtml(e.error)}`).join("<br>"),
        acciones: [["Ir a Extracto", "UI.cerrarPendientes();switchTab('extracto')"], ["Descartar", "UI.descartarExtracto()"]],
      });
    } catch {}
    // Facturas autorizadas cuyo email falló (solo "failed": "pending" es normal en las de extracto)
    for (const [a, m] of [[hoy.getFullYear(), hoy.getMonth() + 1], mesAnterior(hoy.getFullYear(), hoy.getMonth() + 1)]) {
      try {
        const r = await fetch(`${BASE}/admin/facturas-mes?${new URLSearchParams({ anio: a, mes: m })}`, { signal: AbortSignal.timeout(20000) });
        const j = await r.json();
        for (const f of (j.facturas || [])) {
          if (f.emailStatus !== "failed" || f.anulado || f.tipoCbte !== "FA") continue;
          const datos = attrJson({ comprobante: f.comprobante, nombre: f.nombre, total: f.total, cuit: f.cuit, emailTo: f.emailTo });
          items.push({
            tono: "tone-blue", icono: "mail", titulo: "Factura autorizada · el email no salió",
            texto: `${escHtml(f.comprobante)} · ${escHtml(f.nombre)} · $${formatMoneyAR(f.total)}. La factura es válida; solo falló el envío.`,
            acciones: [["Reenviar email", `UI.cerrarPendientes();abrirModalReenviarEmail(${datos})`]],
          });
        }
      } catch {}
    }
    return items;
  }
  async function actualizarPendientes() {
    const items = await calcularPendientes();
    const b = $("pendBadge");
    b.hidden = items.length === 0;
    b.textContent = items.length > 9 ? "9+" : String(items.length);
    return items;
  }
  async function abrirPendientes() {
    haptic();
    $("pendLista").innerHTML = `<div class="vacio"><span class="spinner spinner-dark"></span></div>`;
    abrir("pend");
    const items = await actualizarPendientes();
    $("pendLista").innerHTML = items.length ? items.map((it) => `
      <div class="pend-item">
        <span class="pend-ic ${it.tono}">${ico(it.icono, "ic-sm")}</span>
        <div><div class="pend-tit">${it.titulo}</div><div class="pend-txt">${it.texto}</div>
        <div class="pend-acc">${it.acciones.map(([t, js]) => `<button class="mini-btn" onclick="${js.replace(/"/g, "&quot;")}">${escHtml(t)}</button>`).join("")}</div></div>
      </div>`).join("")
      : `<div class="vacio">${ico("check-circle")}<p>No hay nada pendiente</p><small>Las facturas, los emails y los extractos están al día.</small></div>`;
  }

  // ── Hojas genéricas ──────────────────────────────────────────
  function abrir(n) { $(`${n}Backdrop`).classList.add("active"); $(`${n}Sheet`).classList.add("active"); }
  function cerrar(n) { $(`${n}Backdrop`).classList.remove("active"); $(`${n}Sheet`).classList.remove("active"); }

  function abrirMenu() {
    haptic();
    const sw = navigator.serviceWorker?.controller ? "activa" : "sin instalar";
    $("menuMeta").innerHTML = `Entorno: <strong>${window.ML_CONFIG.ENV === "produccion" ? "producción" : "prueba (simulación)"}</strong><br>Caché sin conexión: ${sw}`;
    abrir("menu");
  }

  let promptInstalar = null;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInstalar = e; });
  function instalar() {
    if (promptInstalar) { promptInstalar.prompt(); promptInstalar = null; return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showToast(ios
      ? "En Safari: tocá Compartir y elegí «Agregar a pantalla de inicio»."
      : "Usá el menú del navegador y elegí «Instalar aplicación».", "success");
  }

  function cerrarExito() {
    $("successModal").classList.remove("active");
    $("successBackdrop").classList.remove("active");
  }

  // Escape cierra la hoja abierta (PC)
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const abiertas = [...document.querySelectorAll(".sheet.active, .modal.active")];
    const top = abiertas[abiertas.length - 1];
    if (!top) return;
    const cierres = { previewSheet: closePreview, revisionTodoSheet: cerrarRevisionTodo, resumenModal: cerrarResumen, successModal: cerrarExito,
      histDetailSheet: histCerrarDetalle, pendSheet: () => cerrar("pend"), menuSheet: () => cerrar("menu"), camSheet: () => window.Camara?.cerrar(),
      anularModal: cerrarModalAnular, reenviarEmailModal: cerrarModalReenviarEmail, anularManualModal: cerrarAnulacionManual };
    cierres[top.id]?.();
  });

  // ── Inicio ───────────────────────────────────────────────────
  document.querySelectorAll(".side-link[data-tab]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  window.addEventListener("scroll", () => document.querySelector(".topbar").classList.toggle("scrolled", window.scrollY > 4), { passive: true });

  const cuitEl = $("cuit");
  let tPadron = null;
  cuitEl.addEventListener("input", () => {
    const v = cuitEl.value.replace(/\D/g, "");
    if (v !== cuitEl.value) cuitEl.value = v;
    clearTimeout(tPadron);
    tPadron = setTimeout(infoCliente, 400);
    if (v.length > 0 && v.length < 11) mostrarRecientes(v); else $("recientes").hidden = true;
    pintarPrevia();
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".field-cuit")) $("recientes").hidden = true;
  });
  ["monto", "condicionVenta", "detalle"].forEach((id) => $(id).addEventListener("input", pintarPrevia));
  $("fileRemito").addEventListener("change", () => { $("remitoZone").hidden = false; marcarOrigen("pdf"); });

  poblarMeses();
  checkServer();
  cargarKPIs();
  actualizarPendientes();
  pintarPrevia();
  setInterval(() => { actualizarPendientes(); }, 5 * 60 * 1000);

  window.UI = {
    origen, marcarOrigen, toggleRecientes, resumenPrevia, abrirPendientes, cerrarPendientes: () => cerrar("pend"),
    actualizarPendientes, abrirMenu, cerrarMenu: () => cerrar("menu"), instalar, cerrarExito, cargarKPIs,
    descartarExtracto: () => { try { localStorage.removeItem("ml_ultimo_extracto"); } catch {} abrirPendientes(); },
    abrirHoja: abrir, cerrarHoja: cerrar,
  };
})();
