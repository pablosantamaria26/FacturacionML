// 🔥 URL DE TU MOTOR EN LA NUBE
const BASE = "https://api-mercadolimpio.onrender.com";

// Variables globales estrictas
let itemsGlobal = [];
let domicilioRemitoGlobal = "";
let subtotalBrutoGlobal = 0, descuentoPctGlobal = 0, descuentoImporteGlobal = 0, totalFinalGlobal = 0;
let emailGlobal = "";
let facturasEmitidas = [];
let currentWaText = "";

// Referencias UI (Cargadas al inicio)
let statusAlert, btnMainAction, inputPdf, loaderUI, lblMainBtn;

document.addEventListener("DOMContentLoaded", () => {
    statusAlert = document.getElementById("statusAlert");
    btnMainAction = document.getElementById("btnMainAction");
    lblMainBtn = document.getElementById("lblMainBtn");
    inputPdf = document.getElementById("inputPdf");
    loaderUI = document.getElementById("loaderUI");

    inputPdf.addEventListener("change", procesarPDF);
    
    // Cargar Tema Guardado
    const savedTheme = localStorage.getItem("ml_theme") || "light";
    setTheme(savedTheme);

    switchTab('fast');
});

// ==========================================
// CONTROL DE TEMAS (GLADIADOR)
// ==========================================
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem("ml_theme", theme);
    
    // Cambiar Título si es gladiador
    const title = document.getElementById("mainTitle");
    if(theme === 'gladiator') title.innerText = "MAXIMUS LIMPIO";
    else title.innerText = "Mercado Limpio";
}

// ==========================================
// CONTROL DE TABS Y BOTÓN CENTRAL
// ==========================================
let currentTab = 'fast';

function switchTab(tabId) {
    currentTab = tabId;
    ['tab-fast', 'tab-capture', 'tab-preview', 'tab-settings'].forEach(id => document.getElementById(id).classList.add('hidden'));
    ['nav-fast', 'nav-capture', 'nav-preview', 'nav-settings'].forEach(id => {
        document.getElementById(id).classList.remove('text-[var(--accent)]', 'opacity-100');
        document.getElementById(id).classList.add('text-muted', 'opacity-60');
    });

    document.getElementById(`tab-${tabId}`).classList.remove('hidden');
    document.getElementById(`nav-${tabId}`).classList.remove('text-muted', 'opacity-60');
    document.getElementById(`nav-${tabId}`).classList.add('text-[var(--accent)]', 'opacity-100');

    // Adaptar botón central según pestaña
    btnMainAction.classList.remove('bg-green-600', 'bg-blue-600', 'animate-pulse');
    
    if (tabId === 'fast') {
        lblMainBtn.innerText = "Generar";
        btnMainAction.onclick = procesarFastYVer;
        btnMainAction.innerHTML = `<svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg><span class="text-[7px] font-black mt-1 uppercase tracking-widest">Borrador</span>`;
    } 
    else if (tabId === 'preview') {
        if (facturasEmitidas.length > 0) {
            btnMainAction.onclick = shareNative;
            btnMainAction.innerHTML = `<svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg><span class="text-[7px] font-black mt-1 uppercase tracking-widest">Enviar</span>`;
        } else {
            btnMainAction.onclick = emitirFactura;
            btnMainAction.innerHTML = `<svg class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path></svg><span class="text-[7px] font-black mt-1 uppercase tracking-widest">Emitir</span>`;
        }
    }
}

// ==========================================
// FACTURACIÓN RÁPIDA (MANUAL)
// ==========================================
function setDesc(texto) {
    document.getElementById("fastDesc").value = texto;
}

function pedirMarcaManual() {
    const marca = prompt("Escriba la marca del artículo:");
    if (marca) setDesc(`ARTICULOS VARIOS MARCA ${marca.toUpperCase()} DE LIMPIEZA Y BAZAR`);
}

function procesarFastYVer() {
    const cuit = document.getElementById("fastCuit").value.trim();
    const strMonto = document.getElementById("fastMonto").value.trim().replace(',', '.');
    const monto = parseFloat(strMonto);
    const desc = document.getElementById("fastDesc").value.trim() || "Artículos varios";
    
    if (cuit.length !== 11) return mostrarAlerta("El CUIT debe tener 11 números exactos.", "error");
    if (isNaN(monto) || monto <= 0) return mostrarAlerta("Ingrese un monto válido.", "error");

    // Construir Datos Compatibles con Backend
    document.getElementById("cuit") = { value: cuit }; // Mocking for preview
    domicilioRemitoGlobal = ""; // Lo sacará del padrón
    totalFinalGlobal = monto;
    subtotalBrutoGlobal = monto;
    descuentoPctGlobal = 0;
    descuentoImporteGlobal = 0;
    emailGlobal = document.getElementById("fastEmail").value.trim();
    facturasEmitidas = []; // Reset

    // 1 Item que engloba el total
    itemsGlobal = [{
        cantidad: 1,
        descripcion: desc,
        precioConIva: monto,
        subtotalConIva: monto
    }];

    mostrarAlerta("✅ Borrador generado.", "success");
    switchTab('preview');
    buildPreviewRail();
}

// ==========================================
// IMPORTAR PDF WSP (Flujo anterior)
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
        
        switchTab('preview');
        buildPreviewRail();

    } catch (err) {
        loaderUI.classList.add("hidden");
        mostrarAlerta(`❌ Error: ${err.message}`, "error");
    } finally {
        inputPdf.value = "";
    }
}

// ==========================================
// PREVIEW IFRAME
// ==========================================
async function buildPreviewRail() {
    const cuit = document.getElementById("fastCuit").value;
    if (itemsGlobal.length === 0) return;

    document.getElementById("txtTotal").textContent = `$${totalFinalGlobal.toLocaleString('es-AR', {minimumFractionDigits:2})}`;
    
    const partes = Math.ceil(itemsGlobal.length / 25);
    const rail = document.getElementById("railPartes");
    
    rail.innerHTML = `
        <div onclick="loadIframe('ALL', this)" class="snap-center shrink-0 w-[40%] bg-[var(--text-main)] text-[var(--bg-app)] rounded-2xl p-4 active:scale-95 transition flex flex-col justify-center items-center border border-transparent rail-card-active cursor-pointer">
            <span class="block font-black text-lg font-epic">VER TODO</span>
        </div>
    `;

    for (let i = 1; i <= partes; i++) {
        rail.innerHTML += `
            <div onclick="loadIframe(${i}, this)" class="snap-center shrink-0 w-[50%] bg-transparent border border-[var(--border-color)] text-[var(--text-main)] rounded-2xl p-4 active:opacity-50 transition cursor-pointer">
                <div class="text-xs font-black uppercase tracking-widest">Parte ${i}</div>
            </div>
        `;
    }

    loadIframe('ALL', rail.querySelector('.rail-card-active'));
}

async function loadIframe(parteNum, element) {
    const rail = document.getElementById("railPartes");
    rail.querySelectorAll('.snap-center').forEach(el => {
        el.classList.remove('bg-[var(--text-main)]', 'text-[var(--bg-app)]', 'rail-card-active');
        el.classList.add('bg-transparent', 'text-[var(--text-main)]', 'border-[var(--border-color)]');
    });

    element.classList.remove('bg-transparent', 'text-[var(--text-main)]');
    element.classList.add('bg-[var(--text-main)]', 'text-[var(--bg-app)]', 'rail-card-active');

    const container = document.getElementById("previewContainer");
    container.classList.add("animate-pulse");

    const payload = {
        cuitCliente: document.getElementById("fastCuit").value,
        domicilioRemito: domicilioRemitoGlobal,
        condicionVenta: document.getElementById("fastCondicion").value,
        items: itemsGlobal,
        subtotalBruto: subtotalBrutoGlobal,
        descuentoPct: descuentoPctGlobal,
        descuentoImporte: descuentoImporteGlobal,
        total: totalFinalGlobal,
        previewParte: parteNum
    };

    try {
        const r = await fetch(`${BASE}/debug/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (r.ok) {
            const htmlStr = await r.text();
            const doc = document.getElementById("previewFrame").contentWindow.document;
            doc.open(); doc.write(htmlStr); doc.close();
        }
    } catch(e) { console.error(e); }
    finally { container.classList.remove("animate-pulse"); }
}

// ==========================================
// EMITIR Y COMPARTIR NATIVO
// ==========================================
async function emitirFactura() {
    const cuit = document.getElementById("fastCuit").value;
    btnMainAction.classList.add("animate-pulse");
    
    try {
        const payload = {
            cuitCliente: cuit,
            emailCliente: emailGlobal,
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
        
        facturasEmitidas.forEach((f, i) => currentWaText += `📑 *Parte ${i+1}:* Comp. Nro ${String(f.nroFactura).padStart(8,'0')} (CAE ${f.cae})\n`);
        
        currentWaText += `\nLos PDFs te fueron enviados por correo electrónico. ¡Muchas gracias por elegirnos! 🙌`;

        mostrarAlerta(`✅ Autorizada en AFIP.`, "success");
        
        // Cambiar botón a Enviar
        switchTab('preview'); 

    } catch (e) {
        mostrarAlerta(`❌ ${e.message}`, "error");
    } finally {
        btnMainAction.classList.remove("animate-pulse");
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

// ALERTAS GLOBALES
function mostrarAlerta(msg, tipo) {
    statusAlert.innerHTML = msg;
    statusAlert.className = `fixed top-12 left-1/2 transform -translate-x-1/2 z-[100] rounded-full px-5 py-3 text-xs font-black shadow-2xl min-w-[80%] text-center transition-all duration-300 ${
        tipo === 'success' ? 'bg-emerald-600 text-white' : 
        tipo === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
    }`;
    statusAlert.classList.remove("hidden");
    setTimeout(() => statusAlert.classList.add("hidden"), 3000);
}
