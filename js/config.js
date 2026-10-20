// Entorno de la app. Producción = únicamente el sitio publicado desde main.
// Cualquier otro lugar (sitio de prueba, localhost) es PRUEBA: las operaciones que
// emiten o envían se simulan y los datos locales van separados de los de producción.
(function () {
  const esProduccion =
    location.hostname === "pablosantamaria26.github.io" &&
    location.pathname.startsWith("/FacturacionML/");

  const API = "https://api-mercadolimpio.onrender.com";
  window.ML_CONFIG = {
    ENV: esProduccion ? "produccion" : "prueba",
    BASE: API,
    CACHE_PREFIX: esProduccion ? "mercadolimpio-" : "ml-prueba-",
    OFICINA_WA: "5491133395487",
  };
  if (esProduccion) return;

  document.documentElement.classList.add("env-prueba");

  // ── Datos locales separados (mismo dominio que producción) ──
  const PREF = "prueba__";
  const st = Storage.prototype;
  const conPrefijo = (k) => (typeof k === "string" && k.startsWith("ml_") ? PREF + k : k);
  const get = st.getItem, set = st.setItem, del = st.removeItem;
  st.getItem = function (k) { return get.call(this, this === window.localStorage ? conPrefijo(k) : k); };
  st.setItem = function (k, v) { return set.call(this, this === window.localStorage ? conPrefijo(k) : k, v); };
  st.removeItem = function (k) { return del.call(this, this === window.localStorage ? conPrefijo(k) : k); };

  // ── Simulación de operaciones que escriben ──
  const realFetch = window.fetch.bind(window);
  const jsonResp = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  const espera = (ms) => new Promise((r) => setTimeout(r, ms));
  let simNro = 900000 + Math.floor(Math.random() * 9000);
  const pad = (n, l) => String(n).padStart(l, "0");
  const jobs = new Map();

  async function letraPara(cuit) {
    try {
      const r = await realFetch(`${API}/padron/${cuit}`, { signal: AbortSignal.timeout(15000) });
      const j = await r.json();
      return { letra: j?.comprobante?.letra || "A", nombre: j?.nombre || `CUIT ${cuit}` };
    } catch { return { letra: "A", nombre: `CUIT ${cuit}` }; }
  }

  async function simular(path, method, body, url) {
    if (method === "POST" && path === "/facturar") {
      await espera(2500);
      const { letra, nombre } = await letraPara(body.cuitCliente);
      const total = Number(body.total || 0);
      const nro = ++simNro;
      return jsonResp({
        ok: true, simulado: true,
        mensaje: "SIMULACIÓN: no se emitió nada en ARCA ni se envió email.",
        emailEnviado: false, emailError: "simulación (no se envió)",
        facturas: [{ nroFactura: nro, cae: "SIMULADO", total, pdfUrl: "", comprobante: `FA-${letra}-00005-${pad(nro, 8)}` }],
        receptor: { cuit: body.cuitCliente, nombre, domicilio: body.domicilioRemito || "" },
        waLink: "",
      });
    }
    if (method === "POST" && path === "/facturar-extracto") {
      const id = `sim_${Date.now()}`;
      jobs.set(id, { body, inicio: Date.now() });
      return jsonResp({ ok: true, jobId: id, estado: "procesando", total: body.transferencias.length });
    }
    if (method === "GET" && path.startsWith("/estado-extracto/sim_")) {
      const job = jobs.get(path.split("/").pop());
      if (!job) return jsonResp({ ok: false, message: "Job simulado no encontrado" }, 404);
      const ts = job.body.transferencias;
      const hechos = Math.min(ts.length, Math.floor((Date.now() - job.inicio) / 1500));
      const resultados = ts.slice(0, hechos).map((t) => ({
        ok: true, nombre: t.nombre, cuit: t.cuit, total: t.monto, pdfUrl: "",
        cae: "SIMULADO", comprobante: `A-00005-${pad(++simNro, 8)}`,
      }));
      const terminado = hechos >= ts.length;
      return jsonResp({
        ok: true, simulado: true, estado: terminado ? "terminado" : "procesando",
        progreso: hechos, total: ts.length, porcentaje: Math.round((hechos / ts.length) * 100),
        facturasEmitidas: hechos, omitidas: 0, errores: 0,
        totalFacturado: resultados.reduce((s, r) => s + Number(r.total || 0), 0), resultados,
      });
    }
    if (method === "POST" && path === "/anular-comprobante") {
      await espera(2000);
      return jsonResp({ ok: true, simulado: true, notaCredito: { comprobante: `NC-SIM-00005-${pad(++simNro, 8)}`, cae: "SIMULADO", total: Number(body.montoTotal || 0), pdfUrl: "" } });
    }
    if (method === "POST" && path === "/reenviar-email") {
      await espera(800);
      return jsonResp({ ok: true, simulado: true });
    }
    if (method === "POST" && path === "/enviar-resumen") {
      await espera(1200);
      return jsonResp({ ok: true, simulado: true, resultados: (body.destinatarios || []).map((email) => ({ email, ok: true })) });
    }
    return null;
  }

  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith(API)) {
      const u = new URL(url);
      const method = String(init.method || "GET").toUpperCase();
      let body = {};
      if (typeof init.body === "string") { try { body = JSON.parse(init.body); } catch {} }
      const sim = await simular(u.pathname, method, body, u);
      if (sim) return sim;
    }
    return realFetch(input, init);
  };
})();
