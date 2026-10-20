// Foto de remito: captura → optimización → lectura con IA → revisión → mismo circuito de emisión.
// Nunca emite: carga los datos revisados en el formulario de Facturar.
(function () {
  const $ = (id) => document.getElementById(id);
  const MAX_LADO = 2200;      // px del lado mayor: suficiente para leer letra chica
  const CALIDAD = 0.86;
  const TOLERANCIA = 1;       // $ de diferencia aceptada entre total leído y calculado

  let fotos = [];             // { blob, url, nombre, kb }
  let datos = null;           // respuesta de la IA, editable
  let revisado = false;

  // ── Optimización de imagen en el dispositivo ─────────────────
  async function optimizar(file) {
    try {
      // createImageBitmap respeta la orientación EXIF en Safari y Chrome
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const esc = Math.min(1, MAX_LADO / Math.max(bmp.width, bmp.height));
      const w = Math.round(bmp.width * esc), h = Math.round(bmp.height * esc);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      const blob = await new Promise((r) => cv.toBlob(r, "image/jpeg", CALIDAD));
      if (!blob) throw new Error("toBlob");
      return { blob, nombre: (file.name || "remito").replace(/\.\w+$/, "") + ".jpg" };
    } catch {
      // HEIC en navegadores que no lo decodifican: se envía el original (la IA lo acepta)
      return { blob: file, nombre: file.name || "remito.heic" };
    }
  }

  async function agregar(fileList) {
    const files = [...(fileList || [])].filter((f) => /^image\//.test(f.type) || /\.(heic|heif)$/i.test(f.name));
    if (!files.length) return;
    if (fotos.length + files.length > 6) { showToast("Máximo 6 fotos por remito", "error"); return; }
    $("camBody").innerHTML = `<div class="vacio"><span class="spinner spinner-dark spinner-lg"></span><p>Preparando las fotos…</p></div>`;
    for (const f of files) {
      const o = await optimizar(f);
      fotos.push({ ...o, url: URL.createObjectURL(o.blob), kb: Math.round(o.blob.size / 1024) });
    }
    pasoFotos();
  }

  // ── Paso 1: elegir origen ────────────────────────────────────
  function pasoInicio() {
    $("camPaso").textContent = "Sacá una foto nítida del remito completo";
    $("camBody").innerHTML = `
      <div class="cam-opciones">
        <button class="cam-op" onclick="Camara.tomar()"><span class="origen-ic tone-violet">${ico("camera")}</span>Sacar foto<small>Abre la cámara</small></button>
        <button class="cam-op" onclick="Camara.galeria()"><span class="origen-ic tone-blue">${ico("image")}</span>Elegir de la galería<small>JPG, PNG o HEIC</small></button>
      </div>
      <ul class="cam-tips">
        <li>Remito apoyado sobre una superficie plana, con buena luz y sin sombras.</li>
        <li>Que se vea completo: encabezado con CUIT, renglones y total.</li>
        <li>Si tiene varias hojas, agregá una foto por hoja.</li>
      </ul>`;
    $("camFoot").innerHTML = "";
  }

  // ── Paso 2: fotos tomadas ────────────────────────────────────
  function pasoFotos() {
    if (!fotos.length) { pasoInicio(); return; }
    $("camPaso").textContent = "Revisá que se lea bien antes de analizar";
    $("camBody").innerHTML = `
      <div class="cam-fotos">${fotos.map((f, i) => `
        <div class="cam-foto"><img src="${f.url}" alt="Foto ${i + 1} del remito">
          <button class="icon-btn" onclick="Camara.quitar(${i})" aria-label="Quitar foto">${ico("trash", "ic-sm")}</button>
          <span class="cam-peso">Hoja ${i + 1} · ${f.kb} KB</span></div>`).join("")}
      </div>
      <div class="chips">
        <button class="chip" onclick="Camara.tomar()">${ico("camera", "ic-sm")} Agregar otra hoja</button>
        <button class="chip" onclick="Camara.galeria()">${ico("image", "ic-sm")} Desde la galería</button>
        <button class="chip" onclick="Camara.repetir()">${ico("refresh", "ic-sm")} Repetir todo</button>
      </div>`;
    $("camFoot").innerHTML = `<button class="main-btn btn-ai-main" id="camBtnAnalizar" onclick="Camara.analizar()">${ico("sparkles")}Leer el remito con IA</button>`;
  }

  // ── Paso 3: análisis ─────────────────────────────────────────
  async function analizar() {
    const btn = $("camBtnAnalizar");
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>Despertando el servidor…`;
    try {
      const ok = await wakeServer();
      if (!ok) throw new Error("El servidor no responde. Probá de nuevo en un minuto.");
      btn.innerHTML = `<span class="spinner"></span>Leyendo el remito…`;
      const fd = new FormData();
      fotos.forEach((f) => fd.append("foto", f.blob, f.nombre));
      const r = await fetchWithRetry(`${BASE}/leer-remito-foto`, { method: "POST", body: fd }, { maxRetries: 2, timeoutMs: 120000 });
      const j = await r.json().catch(() => ({}));
      if (r.status === 404) throw new Error("La lectura de fotos todavía no está habilitada en el servidor.");
      if (!r.ok || !j.ok) throw new Error(j.message || "No se pudo leer el remito");
      datos = normalizar(j.datos || {});
      revisado = false;
      pasoRevision(j.observaciones);
    } catch (e) {
      showToast(e.message || "Error al leer el remito", "error");
      btn.disabled = false;
      btn.innerHTML = `${ico("sparkles")}Leer el remito con IA`;
    }
  }

  function normalizar(d) {
    const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
    return {
      cuit: String(d.cuit || "").replace(/\D/g, ""),
      razonSocial: d.razonSocial || "",
      fecha: d.fecha || "",
      nroRemito: d.nroRemito || "",
      email: d.email || "",
      domicilio: d.domicilio || "",
      descuentoImporte: num(d.descuentoImporte) || 0,
      totalLeido: num(d.total),
      legible: d.legible !== false,
      confianza: d.confianza || {},
      items: (d.items || []).map((it) => ({
        cantidad: num(it.cantidad) || 0,
        descripcion: String(it.descripcion || ""),
        precio: num(it.precioUnitario) || 0,
        confianza: it.confianza || "media",
      })),
    };
  }

  // ── Paso 4: revisión editable ────────────────────────────────
  const conf = (c) => {
    if (!c) return "";
    const txt = { alta: "leído", media: "revisar", baja: "dudoso", falta: "no figura" }[c] || c;
    return `<span class="conf conf-${c}">${txt}</span>`;
  };
  const claseCampo = (c, v) => (!v && c !== "opcional" ? "falta" : (c === "baja" || c === "media" ? "dudoso" : ""));

  function pasoRevision(observaciones) {
    const d = datos, c = d.confianza;
    $("camPaso").textContent = "Revisá y corregí antes de usar los datos";
    $("camBody").innerHTML = `
      ${!d.legible ? `<div class="aviso aviso-err">${ico("alert", "ic-sm")}<span>La foto no se lee bien. Conviene repetirla.</span></div>` : ""}
      ${observaciones ? `<div class="aviso aviso-info">${ico("info", "ic-sm")}<span>${escHtml(observaciones)}</span></div>` : ""}
      <div class="rev-grid">
        <div class="field ${claseCampo(c.cuit, d.cuit)}"><label>CUIT del cliente ${conf(d.cuit ? c.cuit : "falta")}</label><input type="tel" inputmode="numeric" maxlength="11" data-k="cuit" value="${escHtml(d.cuit)}"></div>
        <div class="field"><label>Razón social ${conf(d.razonSocial ? c.razonSocial : "falta")}</label><input type="text" data-k="razonSocial" value="${escHtml(d.razonSocial)}" placeholder="Se toma de ARCA al emitir"></div>
        <div class="field"><label>Fecha del remito ${conf(d.fecha ? c.fecha : "falta")}</label><input type="text" data-k="fecha" value="${escHtml(d.fecha)}" placeholder="dd/mm/aaaa"></div>
        <div class="field"><label>Nº de remito ${conf(d.nroRemito ? c.nroRemito : "falta")}</label><input type="text" data-k="nroRemito" value="${escHtml(d.nroRemito)}"></div>
        <div class="field"><label>Email ${conf(d.email ? c.email : "falta")}</label><input type="email" inputmode="email" data-k="email" value="${escHtml(d.email)}" placeholder="Opcional"></div>
        <div class="field"><label>Domicilio de entrega ${conf(d.domicilio ? c.domicilio : "falta")}</label><input type="text" data-k="domicilio" value="${escHtml(d.domicilio)}" placeholder="Opcional"></div>
      </div>
      <div class="sec-tit">Ítems (precio con IVA incluido)</div>
      <div class="rev-items-list" id="camItems"></div>
      <button class="link-btn" onclick="Camara.agregarItem()">${ico("plus", "ic-sm")}Agregar ítem</button>
      <div class="rev-grid" style="margin-top:8px">
        <div class="field"><label>Descuento (importe) ${conf(c.descuento)}</label><div class="input-prefix"><span>$</span><input type="text" inputmode="decimal" data-k="descuentoImporte" value="${d.descuentoImporte ? String(d.descuentoImporte).replace(".", ",") : ""}" placeholder="0"></div></div>
        <div class="field ${d.totalLeido == null ? "falta" : ""}"><label>Total que figura en el remito ${conf(d.totalLeido != null ? c.total : "falta")}</label><div class="input-prefix"><span>$</span><input type="text" inputmode="decimal" data-k="totalLeido" value="${d.totalLeido != null ? String(d.totalLeido).replace(".", ",") : ""}"></div></div>
      </div>
      <div class="cuadre" id="camCuadre"></div>
      <label class="aviso aviso-warn" id="camChkWrap" style="cursor:pointer"><input type="checkbox" id="camChk" style="width:18px;height:18px;min-height:0;margin-top:1px"><span>Revisé los datos marcados como dudosos o faltantes y están bien.</span></label>`;
    $("camBody").querySelectorAll("[data-k]").forEach((inp) => inp.addEventListener("input", () => {
      const k = inp.dataset.k;
      d[k] = ["descuentoImporte", "totalLeido"].includes(k) ? (inp.value.trim() === "" ? (k === "totalLeido" ? null : 0) : parseAR(inp.value)) : (k === "cuit" ? inp.value.replace(/\D/g, "") : inp.value);
      validar();
    }));
    $("camChk").addEventListener("change", (e) => { revisado = e.target.checked; validar(); });
    $("camFoot").innerHTML = `
      <div class="success-actions">
        <button class="btn btn-secondary" onclick="Camara.volverFotos()">${ico("camera", "ic-sm")}Fotos</button>
        <button class="main-btn" id="camBtnUsar" onclick="Camara.usar()" disabled>${ico("check")}Usar datos</button>
      </div>`;
    pintarItems();
  }

  const parseAR = (v) => {
    const s = String(v).trim().replace(/[$\s]/g, "");
    const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
    return Number.isFinite(n) ? round2(n) : 0;
  };

  function pintarItems() {
    $("camItems").innerHTML = datos.items.map((it, i) => `
      <div class="rev-item${it.confianza === "baja" ? " dudoso" : ""}" data-row="${i}">
        <div class="ri-head"><input type="text" class="ri-desc" value="${escHtml(it.descripcion)}" data-i="${i}" data-f="descripcion" aria-label="Descripción" placeholder="Descripción">${it.confianza !== "alta" ? conf(it.confianza) : ""}</div>
        <div class="ri-row">
          <label>Cant.<input type="text" inputmode="decimal" value="${it.cantidad || ""}" data-i="${i}" data-f="cantidad"></label>
          <label>Precio unit.<input type="text" inputmode="decimal" value="${it.precio ? String(it.precio).replace(".", ",") : ""}" data-i="${i}" data-f="precio"></label>
          <div class="ri-sub"><span>Subtotal</span><strong id="camSub${i}">$${formatMoneyAR(round2(it.cantidad * it.precio))}</strong></div>
          <button class="icon-btn" onclick="Camara.quitarItem(${i})" aria-label="Quitar ítem">${ico("trash", "ic-sm")}</button>
        </div>
      </div>`).join("") || `<div class="muted" style="padding:12px 0">No se detectaron ítems. Agregalos a mano.</div>`;
    $("camItems").querySelectorAll("input").forEach((inp) => inp.addEventListener("input", () => {
      const it = datos.items[inp.dataset.i];
      it[inp.dataset.f] = inp.dataset.f === "descripcion" ? inp.value : parseAR(inp.value);
      it.confianza = "alta";
      const fila = inp.closest(".rev-item");
      fila.classList.remove("dudoso");
      fila.querySelector(".conf")?.remove();
      $(`camSub${inp.dataset.i}`).textContent = `$${formatMoneyAR(round2(it.cantidad * it.precio))}`;
      validar();
    }));
    validar();
  }

  function calcular() {
    const subtotal = round2(datos.items.reduce((s, it) => s + round2(it.cantidad * it.precio), 0));
    const total = round2(subtotal - (datos.descuentoImporte || 0));
    return { subtotal, total };
  }

  function validar() {
    const d = datos, c = d.confianza;
    const { subtotal, total } = calcular();
    const problemas = [];
    if (d.cuit.length !== 11) problemas.push("Falta el CUIT del cliente (11 dígitos).");
    const itemsOk = d.items.length > 0 && d.items.every((it) => it.cantidad > 0 && it.precio > 0 && it.descripcion.trim());
    if (!itemsOk) problemas.push("Cada ítem necesita cantidad, descripción y precio.");
    let difTxt = "";
    if (d.totalLeido == null) problemas.push("Cargá el total que figura en el remito para poder compararlo.");
    else {
      const dif = round2(total - d.totalLeido);
      difTxt = Math.abs(dif) <= TOLERANCIA ? `<strong class="ok">Coincide</strong>` : `<strong class="dif">${dif > 0 ? "+" : "−"}$${formatMoneyAR(Math.abs(dif))}</strong>`;
      if (Math.abs(dif) > TOLERANCIA) problemas.push("El total calculado no coincide con el del remito: corregí cantidades, precios o descuento.");
    }
    const dudosos = [c.cuit, c.total, ...d.items.map((it) => it.confianza)].some((x) => x === "baja" || x === "media") || !d.legible;
    $("camChkWrap").style.display = dudosos ? "" : "none";
    if (dudosos && !revisado) problemas.push("Confirmá que revisaste los datos dudosos.");

    $("camCuadre").innerHTML = `
      <span>Subtotal de ítems</span><strong>$${formatMoneyAR(subtotal)}</strong>
      <span>Descuento</span><strong>${d.descuentoImporte ? "−$" + formatMoneyAR(d.descuentoImporte) : "$0,00"}</strong>
      <span>Total calculado</span><strong>$${formatMoneyAR(total)}</strong>
      <span>Total leído del remito</span><strong>${d.totalLeido != null ? "$" + formatMoneyAR(d.totalLeido) : "—"}</strong>
      <span>Diferencia</span>${difTxt || "<strong>—</strong>"}
      ${problemas.length ? `<span style="grid-column:1/-1;color:var(--red);font-size:12.5px;line-height:1.5">${problemas.map(escHtml).join("<br>")}</span>` : ""}`;
    const btn = $("camBtnUsar");
    if (btn) btn.disabled = problemas.length > 0;
    return problemas.length === 0;
  }

  // ── Paso 5: cargar en el formulario de Facturar ──────────────
  function usar() {
    if (!validar()) return;
    const d = datos;
    const { subtotal, total } = calcular();
    itemsGlobal = d.items.map((it) => ({
      cantidad: it.cantidad, descripcion: it.descripcion.trim(),
      precioConIva: round2(it.precio), subtotalConIva: round2(it.cantidad * it.precio),
    }));
    subtotalBrutoGlobal = d.descuentoImporte > 0 ? subtotal : 0;
    descuentoImporteGlobal = d.descuentoImporte > 0 ? round2(d.descuentoImporte) : 0;
    descuentoPctGlobal = d.descuentoImporte > 0 && subtotal > 0 ? round2((d.descuentoImporte / subtotal) * 100) : 0;
    totalFinalGlobal = total;
    domicilioRemitoGlobal = d.domicilio || "";
    parteActual = 1;
    $("cuit").value = d.cuit;
    $("monto").value = String(total).replace(".", ",");
    if (d.email && d.email.includes("@")) { $("email").value = d.email; saveEmailCuit(d.cuit, d.email); }
    else autoFillEmailSiVacio(d.cuit);
    if (d.nroRemito && !$("detalle").value) $("detalle").value = `Remito ${d.nroRemito}`;
    mostrarResumenExtraccion({ cuit: d.cuit, items: itemsGlobal, domicilioRemito: d.domicilio });
    $("remitoZone").hidden = false;
    window.UI?.marcarOrigen("foto");
    $("cuit").dispatchEvent(new Event("input"));
    triggerPreviewNow();
    cerrar();
    showToast("Datos del remito cargados. Revisá la vista previa y emití.", "success");
  }

  // ── Apertura / cierre ────────────────────────────────────────
  function abrir() {
    fotos.forEach((f) => URL.revokeObjectURL(f.url));
    fotos = []; datos = null; revisado = false;
    pasoInicio();
    window.UI.abrirHoja("cam");
  }
  function cerrar() { window.UI.cerrarHoja("cam"); }

  $("camInputCamara").addEventListener("change", (e) => { agregar(e.target.files); e.target.value = ""; });
  $("camInputGaleria").addEventListener("change", (e) => { agregar(e.target.files); e.target.value = ""; });

  window.Camara = {
    abrir, cerrar, analizar, usar,
    tomar: () => $("camInputCamara").click(),
    galeria: () => $("camInputGaleria").click(),
    quitar: (i) => { URL.revokeObjectURL(fotos[i].url); fotos.splice(i, 1); pasoFotos(); },
    repetir: () => { fotos.forEach((f) => URL.revokeObjectURL(f.url)); fotos = []; pasoInicio(); $("camInputCamara").click(); },
    volverFotos: () => pasoFotos(),
    agregarItem: () => { datos.items.push({ cantidad: 1, descripcion: "", precio: 0, confianza: "alta" }); pintarItems(); },
    quitarItem: (i) => { datos.items.splice(i, 1); pintarItems(); },
  };
})();
