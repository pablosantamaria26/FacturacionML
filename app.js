// 🔥 URL DE TU MOTOR EN LA NUBE
const BASE = "https://api-mercadolimpio.onrender.com";

// Variables globales estrictas
let itemsGlobal = [];
let domicilioRemitoGlobal = "";
let subtotalBrutoGlobal = 0, descuentoPctGlobal = 0, descuentoImporteGlobal = 0, totalFinalGlobal = 0;
let emailGlobal = "";
let facturasEmitidas = [];
let currentWaText = "";

let parteActual = 1;
let totalPartes = 1;
const ITEMS_POR_FACTURA = 25; // Sincronizado con backend

// Referencias UI
let statusAlert, btnMainAction, lblMainBtn, iconMainBtn, inputPdf, loaderUI;
let txtTotal, txtClientName, txtDescPct, lblParteActual, lblTotalPartes, btnPrevParte, btnNextParte;

document.addEventListener("DOMContentLoaded", () => {
    // Vincular DOM
    statusAlert = document.getElementById("statusAlert");
    btnMainAction = document.getElementById("btnMainAction");
    lblMainBtn = document.getElementById("lblMainBtn");
    iconMainBtn = document.getElementById("iconMainBtn");
    inputPdf = document.getElementById("inputPdf");
    loaderUI = document.getElementById("loaderUI");
    
    txtTotal = document.getElementById("txtTotal");
    txtClientName = document.getElementById("txtClientName");
    txtDescPct = document.getElementById("txtDescPct");
    lblParteActual = document.getElementById("lblParteActual");
    lblTotalPartes = document.getElementById("lblTotalPartes");
    btnPrevParte = document.getElementById("btnPrevParte");
    btnNextParte = document.getElementById("btnNextParte");

    inputPdf.addEventListener("change", procesarPDF);
    
    // Cargar Tema Guardado
    const savedTheme = localStorage.getItem("ml_theme") || "light";
    setTheme(savedTheme);

    switchTab('fast');
});

// ==========================================
// CONTROL DE TEMAS
// ==========================================
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem("ml_theme", theme);
    const title = document.getElementById("mainTitle");
    if(theme === 'gladiator') title.innerText = "MAXIMUS LIMPIO";
    else title.innerText = "Mercado Limpio";
}

// ==========================================
// CONTROL DE TABS NATIVO
// ==========================================
let currentTab = 'fast';

function switchTab(tabId) {
    currentTab = tabId;
    
    // Ocultar todos con animacion
    ['tab-fast', 'tab-capture', 'tab-preview', 'tab-settings'].forEach(id => {
        const el = document.getElementById(id);
        el.classList.remove('tab-active');
        el.classList.add('tab-hidden');
    });

    // Reset Dock
    ['nav-fast', 'nav-capture', 'nav-settings'].forEach(id => {
        const el = document.getElementById(id);
        el.classList.remove('text-[var(--accent)]', 'opacity-100');
        el.classList.add('text-muted', 'opacity-50');
    });

    // Mostrar Activo
    const activeTab = document.getElementById(`tab-${tabId}`);
    activeTab.classList.remove('tab-hidden');
    activeTab.classList.add('tab-active');

    if(tabId !== 'preview') {
        const activeNav = document.getElementById(`nav-${tabId}`);
        activeNav.classList.remove('text-muted', 'opacity-50');
        activeNav.classList.add('text-[var(--accent)]', 'opacity-100');
    }

    actualizarBotonCentral();
}

function actualizarBotonCentral() {
    btnMainAction.classList.remove('animate-pulse', 'bg-emerald-600', 'border-emerald-600', 'bg-slate-900', 'border-slate-900');
    
    if (currentTab === 'fast' || currentTab === 'capture' || currentTab === 'settings') {
        // Modo Borrador / Preview
        lblMainBtn.innerText = "Preview";
        btnMainAction.onclick = procesarYPrevisualizar;
        iconMainBtn.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>`;
    } 
    else if (currentTab === 'preview') {
        if (facturasEmitidas.length > 0) {
            // Modo Enviar WhatsApp
            lblMainBtn.innerText = "Enviar";
            btnMainAction.onclick = shareNative;
            btnMainAction.classList.add('bg-emerald-600', 'border-emerald-600');
            iconMainBtn.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path>`;
        } else {
            // Modo Emitir AFIP
            lblMainBtn.innerText = "Emitir";
            btnMainAction.onclick = emitirFactura;
            btnMainAction.classList.add('bg-slate-900', 'border-slate-900');
            iconMainBtn.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>`;
        }
    }
}

// ==========================================
// LOGICA DE CARGA MANUAL (FAST)
// ==========================================
function setDesc(texto) { document.getElementById("fastDesc").value = texto; }

function pedirMarcaManual() {
    const marca = prompt("Escriba la marca del artículo:");
    if (marca) setDesc(`ARTICULOS VARIOS MARCA ${marca.toUpperCase()} DE LIMPIEZA Y BAZAR`);
}

function procesarYPrevisualizar() {
    if (currentTab === 'fast') {
        const cuit = document.getElementById("fastCuit").value.trim();
        const strMonto = document.getElementById("fastMonto").value.trim().replace(',', '.');
        const monto = parseFloat(strMonto);
        const desc = document.getElementById("fastDesc").value.trim() || "Artículos varios";
        
        if (cuit.length !== 11) return mostrarAlerta("El CUIT debe tener 11 números.", "error");
        if (isNaN(monto) || monto <= 0) return mostrarAlerta("Ingrese un monto válido.", "error");

        // Setear Globales
        domicilioRemitoGlobal = ""; 
        totalFinalGlobal = monto;
        subtotalBrutoGlobal = monto;
        descuentoPctGlobal = 0;
        descuentoImporteGlobal = 0;
        emailGlobal = document.getElementById("fastEmail").value.trim();
        facturasEmitidas = [];
        
        itemsGlobal = [{ cantidad: 1, descripcion: desc, precioConIva: monto, subtotalConIva: monto }];
    }

    if (itemsGlobal.length === 0) return mostrarAlerta("No hay datos para previsualizar.", "error");

    switchTab('preview');
    generarVistaPrevia(1); // Carga la parte 1
}

// ==========================================
// LOGICA PDF (WSP)
// ==========================================
async function procesarPDF(e) {
    if (!e.target.files || !e.target.files.length) return;
    
    loaderUI.classList.remove("hidden");
    const formData = new FormData();
    for (let i = 0; i < e.target.files.length; i++) formData.append("remito", e.target.files[i]);

    try {
        const r = await fetch(`${BASE}/leer-remito`, { method: "POST", body: formData });
        const res = await r.json();

        if (!r.ok) throw new Error(res.detail || "Error al leer PDF");

        document.getElementById("fastCuit").value = res.cuit || "";
        domicilioRemitoGlobal = res.domicilioRemito || "";
        itemsGlobal = Array.isArray(res.items) ? res.items : [];
        subtotalBrutoGlobal = Number(res.subtotalBruto || 0);
        descuentoPctGlobal = Number(res.descuentoPct || 0);
        descuentoImporteGlobal = Number(res.descuentoImporte || 0);
        totalFinalGlobal = Number(res.total || 0);
        
        document.getElementById("fastMonto").value = totalFinalGlobal;
        facturasEmitidas = [];

        loaderUI.classList.add("hidden");
        mostrarAlerta(`✅ ¡PDF Procesado! (${itemsGlobal.length} ítems)`, "success");
        
        procesarYPrevisualizar();

    } catch (err) {
        loaderUI.classList.add("hidden");
        mostrarAlerta(`❌ Error: ${err.message}`, "error");
    } finally {
        inputPdf.value = "";
    }
}

// ==========================================
// PREVIEW IFRAME & CONTROL DE PARTES
// ==========================================
function cambiarParte(dir) {
    const nuevaParte = parteActual + dir;
    if (nuevaParte >= 1 && nuevaParte <= totalPartes) {
        generarVistaPrevia(nuevaParte);
    }
}

async function generarVistaPrevia(parteReq) {
    parteActual = parteReq;
    totalPartes = Math.max(1, Math.ceil(itemsGlobal.length / ITEMS_POR_FACTURA));
    
    const cuit = document.getElementById("fastCuit").value.trim();

    // Actualizar UI Header
    txtTotal.textContent = `$${(totalFinalGlobal || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}`;
    txtClientName.textContent = cuit ? `Cuit: ${cuit}` : "Borrador sin CUIT";
    
    if (descuentoPctGlobal > 0) {
        txtDescPct.textContent = `Dto ${descuentoPctGlobal}%`;
        txtDescPct.classList.remove("hidden");
    } else {
        txtDescPct.classList.add("hidden");
    }

    // Actualizar Botonera
    lblParteActual.textContent = parteActual;
    lblTotalPartes.textContent = totalPartes;
    btnPrevParte.disabled = parteActual <= 1;
    btnNextParte.disabled = parteActual >= totalPartes;

    // Loading State Iframe
    const container = document.getElementById("previewContainer");
    container.classList.add("animate-pulse");

    const payload = {
        cuitCliente: cuit,
        domicilioRemito: domicilioRemitoGlobal,
        condicionVenta: document.getElementById("fastCondicion").value,
        items: itemsGlobal,
        subtotalBruto: subtotalBrutoGlobal,
        descuentoPct: descuentoPctGlobal,
        descuentoImporte: descuentoImporteGlobal,
        total: totalFinalGlobal,
        previewParte: parteActual
    };

    try {
        const r = await fetch(`${BASE}/debug/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (r.ok) {
            const htmlStr = await r.text();
            const doc = document.getElementById("previewFrame").contentWindow.document;
            doc.open(); doc.write(htmlStr); doc.close();
            
            // Intento extraer el nombre del cliente desde el HTML devuelto por ARCA/AFIP
            const matchName = htmlStr.match(/Apellido y Nombre \/ Razón Social:\s*<strong>(.*?)<\/strong>/);
            if(matchName && matchName[1]) txtClientName.textContent = matchName[1];
        }
    } catch(e) { console.error("Error cargando iframe:", e); }
    finally { container.classList.remove("animate-pulse"); }
}

// ==========================================
// EMITIR Y COMPARTIR NATIVO
// ==========================================
async function emitirFactura() {
    const cuit = document.getElementById("fastCuit").value;
    btnMainAction.classList.add("animate-pulse");
    btnMainAction.disabled = true;
    
    try {
        const payload = {
            cuitCliente: cuit,
            emailCliente: document.getElementById("fastEmail").value.trim(),
            domicilioRemito: domicilioRemitoGlobal,
            condicionVenta: document.getElementById("fastCondicion").value,
            items: itemsGlobal,
            subtotalBruto: subtotalBrutoGlobal,
            descuentoPct: descuentoPctGlobal,
            descuentoImporte: descuentoImporteGlobal,
            total: totalFinalGlobal
        };

        const r = await fetch(`${BASE}/facturar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const j = await r.json();

        if (!r.ok) throw new Error(j.message || "Error AFIP");

        facturasEmitidas = j.facturas || [];
        
        // MENSAJE DE WHATSAPP PROFESIONAL
        currentWaText = `¡Hola! Somos *Mercado Limpio Distribuidora* 🧹✨\n\nTe compartimos la factura electrónica oficial correspondiente a tu compra.\n\n*Cliente:* ${j.receptor?.nombre}\n*CUIT:* ${cuit}\n*Importe Total:* $${totalFinalGlobal.toLocaleString('es-AR', {minimumFractionDigits:2})}\n\n`;
        
        facturasEmitidas.forEach((f, i) => {
            currentWaText += `📑 *Parte ${i+1}:* Comp. Nro ${String(f.nroFactura).padStart(8,'0')} (CAE ${f.cae})\n`;
            if (f.pdfUrl) currentWaText += `Descargar PDF: ${f.pdfUrl}\n`;
        });
        
        currentWaText += `\n¡Muchas gracias por elegirnos! 🙌`;

        mostrarAlerta(`✅ Emitida en AFIP.`, "success");
        actualizarBotonCentral(); 

    } catch (e) {
        mostrarAlerta(`❌ ${e.message}`, "error");
    } finally {
        btnMainAction.classList.remove("animate-pulse");
        btnMainAction.disabled = false;
    }
}

async function shareNative() {
    if (!currentWaText) return;
    if (navigator.share) {
        try { await navigator.share({ title: 'Factura Mercado Limpio', text: currentWaText }); } 
        catch (err) { console.log('Cancelado'); }
    } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(currentWaText)}`, '_blank');
    }
}

// Descargar Borrador actual de Iframe
function descargarBorrador() {
    try {
        const iframe = document.getElementById("previewFrame");
        iframe.contentWindow.print();
    } catch(e) {
        mostrarAlerta("No se pudo descargar.", "error");
    }
}

// ALERTAS GLOBALES NATIVAS
function mostrarAlerta(msg, tipo) {
    statusAlert.innerHTML = msg;
    statusAlert.className = `fixed top-12 left-1/2 transform -translate-x-1/2 -translate-y-4 z-[100] rounded-full px-6 py-4 text-xs font-black shadow-2xl min-w-[85%] text-center transition-all duration-300 ${
        tipo === 'success' ? 'bg-emerald-500 text-white' : 
        tipo === 'error' ? 'bg-rose-500 text-white' : 'bg-slate-900 text-white'
    }`;
    
    // Animar entrada
    requestAnimationFrame(() => {
        statusAlert.classList.remove("opacity-0", "-translate-y-4");
        statusAlert.classList.add("opacity-100", "translate-y-0");
    });

    setTimeout(() => {
        statusAlert.classList.remove("opacity-100", "translate-y-0");
        statusAlert.classList.add("opacity-0", "-translate-y-4");
    }, 3500);
}
