/* ═══════════════════════════════════════════════════════════════════
   ACTUALIZADOR DE LA APP (24/11/2026)

   Cada publicación cambia la versión del Service Worker (sw.js, CACHE_NAME). Este módulo:
     · registra el Service Worker y busca versión nueva al abrir, al volver a la app (pestaña visible / foco) y cada 10 min;
     · cuando la versión nueva toma el control: si no estás trabajando, recarga sola («Actualizando a la versión nueva…»);
       si estás en medio de algo (revisando un extracto, emitiendo, con datos cargados en un formulario, con una hoja abierta),
       NO te pisa la pantalla: muestra un aviso con «Actualizar ahora» y se actualiza sola apenas quedás libre;
     · expone la versión que está corriendo (MLActualizador.version()) para mostrarla en el menú.
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;
  const habiaControlador = !!navigator.serviceWorker.controller;   // primera instalación: no se recarga
  let reg = null, pendiente = false, version = "", espera = null;

  /* ¿Se ve de verdad? (hay indicadores de carga que viven en la página escondidos con opacidad, visibilidad o fuera de pantalla) */
  function seVe(el) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) return false;
    for (let x = el; x && x !== document.documentElement; x = x.parentElement) {
      const cs = getComputedStyle(x);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
    }
    return true;
  }
  /* ¿Estás en medio de algo? Entonces no se recarga sola. */
  function ocupado() {
    if ([...document.querySelectorAll(".spinner")].some(seVe)) return true;                     // procesando / emitiendo
    const paso2 = document.getElementById("extStep2"); if (paso2 && paso2.classList.contains("active")) return true;   // revisando un extracto
    if ([...document.querySelectorAll(".sheet.active, .modal.active, .backdrop.active, .modal-backdrop.active")].some(seVe)) return true;  // hoja o modal abierto
    return [...document.querySelectorAll("main input:not([type=hidden]):not([type=file]):not([type=checkbox]), main textarea")]
      .some(x => seVe(x) && String(x.value || "").trim() !== "");                                // datos cargados a mano
  }

  function pedirVersion(sw) {
    return new Promise(res => {
      if (!sw) return res("");
      const ch = new MessageChannel(); const t = setTimeout(() => res(""), 4000);
      ch.port1.onmessage = e => { clearTimeout(t); res(String(e.data || "")); };
      try { sw.postMessage("version", [ch.port2]); } catch (e) { clearTimeout(t); res(""); }
    });
  }
  async function leerVersion() {
    let v = await pedirVersion(navigator.serviceWorker.controller);
    if (!v) v = await pedirVersion(navigator.serviceWorker.controller);   // el Service Worker pudo estar dormido: un reintento
    const m = v.match(/v(\d+)$/); version = m ? "v" + m[1] : "";
    window.ML_VERSION = version;
  }

  function aviso() {
    if (document.getElementById("mlActualizar")) return;
    const d = document.createElement("div");
    d.id = "mlActualizar"; d.setAttribute("role", "status");
    d.style.cssText = "position:fixed;left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:9999;max-width:520px;margin:0 auto;" +
      "background:#142A47;color:#fff;border-radius:14px;padding:12px 14px;display:flex;gap:10px;align-items:center;box-shadow:0 10px 30px rgba(0,0,0,.3);font:600 14px/1.3 inherit";
    d.innerHTML = '<span style="flex:1">Hay una versión nueva de la app. Se actualiza sola cuando termines; si querés, ahora.</span>' +
      '<button type="button" style="background:#C97A3A;color:#fff;border:0;border-radius:10px;padding:9px 12px;font:700 13px inherit;cursor:pointer;white-space:nowrap">Actualizar ahora</button>';
    d.querySelector("button").onclick = () => location.reload();
    document.body.appendChild(d);
  }
  function recargarAvisando() {
    if (typeof window.showToast === "function") { try { showToast("Actualizando a la versión nueva…", "success"); } catch (e) {} }
    setTimeout(() => location.reload(), 900);
  }
  function aplicar() {
    if (!habiaControlador) { leerVersion(); return; }   // la app se acaba de instalar: ya es la última
    pendiente = true;
    if (!ocupado()) return recargarAvisando();
    aviso();
    clearInterval(espera);
    espera = setInterval(() => { if (!ocupado()) { clearInterval(espera); recargarAvisando(); } }, 5000);
  }

  navigator.serviceWorker.addEventListener("controllerchange", aplicar);
  navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" })
    .then(r => { reg = r; r.update().catch(() => {}); return leerVersion(); })
    .catch(() => {});
  const revisar = () => { if (reg && document.visibilityState === "visible") reg.update().catch(() => {}); };
  document.addEventListener("visibilitychange", revisar);
  window.addEventListener("focus", revisar);
  setInterval(revisar, 10 * 60 * 1000);

  window.MLActualizador = { version: () => version, hayNueva: () => pendiente, revisar, ocupado, leerVersion: () => leerVersion().then(() => version) };
})();
