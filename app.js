// 🔥 URL DE TU MOTOR EN LA NUBE
const BASE = "https://api-mercadolimpio.onrender.com";

let itemsGlobal = [];
let domicilioRemitoGlobal = "";
let subtotalBrutoGlobal = 0, descuentoPctGlobal = 0, descuentoImporteGlobal = 0, totalFinalGlobal = 0;
let facturasEmitidas = [];
let currentWaText = "";

// Elementos UI (Los capturamos cuando cargue la página para evitar nulls)
let inputPdf, loaderUI, statusAlert, btnMainAction, btnShareNative;

document.addEventListener("DOMContentLoaded", () => {
    inputPdf = document.getElementById("inputPdf");
    loaderUI = document.getElementById("loaderUI");
    statusAlert = document.getElementById("statusAlert");
    btnMainAction = document.getElementById("btnMainAction");
    btnShareNative = document.getElementById("btnShareNative");

    // Conectamos el evento al botón invisible de archivos
    inputPdf.addEventListener("change", procesarArchivo);
    
    // Mostramos la pestaña inicial
    switchTab('capture');
});

// NAVEGACIÓN TABS
function switchTab(tabId) {
    ['tab-capture', 'tab-items', 'tab-preview'].forEach(id => document.getElementById(id).classList.add('hidden'));
    ['nav-capture', 'nav-items', 'nav-preview'].forEach(id => {
        document.getElementById(id).classList.remove('text-blue-600');
        document.getElementById(id).classList.add('text-slate-400');
    });

    document.getElementById(`tab-${tabId}`).classList.remove('hidden');
    document.getElementById(`nav-${tabId}`).classList.remove('text-slate-400');
    document.getElementById(`nav-${tabId}`).classList.add('text-blue-600');

    if (tabId === 'preview') buildPreviewRail();
}

// 1. PROCESAR PDF
async function procesarArchivo(e) {
    if (!e.target.files || !e.target.files.length) return;
    
    loaderUI.classList.remove("hidden");
    statusAlert.classList.add("hidden");
    
    // Animación de carga en botón principal
    btnMainAction.disabled = true;
    btnMainAction.classList.add("animate-spin", "opacity-50");

    const formData = new FormData();
    for (let i = 0; i < e.target.files.length; i++) formData.append("remito", e.target.files[i]);

    try {
        const r = await fetch(`${BASE}/leer-remito`, { method: "POST", body: formData });
        const res = await r.json();

        if (!r.ok) throw new Error(res.detail || "Error al procesar");

        document.getElementById("cuit").value = res.cuit || "";
        domicilioRemitoGlobal = res.domicilioRemito || "";
        itemsGlobal = Array.isArray(res.items) ? res.items : [];
        subtotalBrutoGlobal = Number(res.subtotalBruto || 0);
        descuentoPctGlobal = Number(res.descuentoPct || 0);
        descuentoImporteGlobal = Number(res.descuentoImporte || 0);
        totalFinalGlobal = Number(res.total || 0);

        updateItemsListUI();
        loaderUI.classList.add("hidden");
        mostrarAlerta(`✅ ¡Listo! ${itemsGlobal.length} ítems extraídos del PDF.`, "success");
        
        // Auto-navegar al borrador (Preview)
        setTimeout(() => switchTab('preview'), 800);

    } catch (err) {
        loaderUI.classList.add("hidden");
        mostrarAlerta(`❌ Error: ${err.message}`, "error");
    } finally {
        btnMainAction.disabled = false;
        btnMainAction.classList.remove("animate-spin", "opacity-50");
        inputPdf.value = ""; // Resetear para permitir subir el mismo archivo
    }
}

// UI simplificada de ítems
function updateItemsListUI() {
    const list = document.getElementById("itemsList");
    document.getElementById("itemCount").textContent = itemsGlobal.length;
    
    if (itemsGlobal.length === 0) {
        list.innerHTML = `<div class="text-sm text-slate-400 italic text-center py-4">No hay artículos.</div>`;
        return;
    }

    list.innerHTML = itemsGlobal.map(it => `
        <div class="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-100">
            <div class="max-w-[70%]">
                <div class="font-bold text-slate-800 text-sm truncate">${it.descripcion}</div>
                <div class="text-xs text-slate-500">${it.cantidad} unidades</div>
            </div>
            <div class="text-sm font-black text-slate-900">$${(it.subtotalConIva || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}</div>
        </div>
    `).join("");
}

// 2. PREVIEW RAIL
async function buildPreviewRail() {
    const cuit = document.getElementById("cuit").value.trim();
    if (itemsGlobal.length === 0 && (!cuit || cuit.length < 11)) return;

    document.getElementById("txtTotal").textContent = `$${(totalFinalGlobal || 0).toLocaleString('es-AR', {minimumFractionDigits:2})}`;
    
    const bSub = document.getElementById("txtSubtotal");
    const bPct = document.getElementById("txtDescPct");

    if (descuentoPctGlobal > 0 || descuentoImporteGlobal > 0) {
        bSub.textContent = `$${(subtotalBrutoGlobal || 0).toLocaleString('es-AR')}`;
        bSub.classList.remove("hidden");
        bPct.textContent = `DESC ${descuentoPctGlobal}%`;
        bPct.classList.remove("hidden");
    } else {
        bSub.classList.add("hidden");
        bPct.classList.add("hidden");
    }

    const partes = Math.ceil(itemsGlobal.length / 25);
    const rail = document.getElementById("railPartes");
    rail.innerHTML = `
        <div onclick="loadIframe('ALL', this)" class="snap-center shrink-0 w-[40%] bg-slate-950 text-white rounded-2xl p-4 shadow-sm active:scale-95 transition flex flex-col justify-center items-center cursor-pointer border-2 border-slate-950 rail-card-active">
            <span class="block font-black text-lg">VER TODO</span>
            <span class="block text-[10px] text-slate-500 font-bold uppercase">${partes} Partes</span>
        </div>
    `;

    for (let i = 1; i <= partes; i++) {
        rail.innerHTML += `
            <div onclick="loadIframe(${i}, this)" class="snap-center shrink-0 w-[50%] bg-white rounded-2xl p-4 shadow-sm border border-slate-200 active:bg-blue-50 transition cursor-pointer flex flex-col justify-between">
                <div class="flex justify-between items-center mb-1">
                    <span class="text-xs font-black text-blue-600">Parte ${i}</span>
                    <div class="w-2 h-2 rounded-full bg-slate-200 status-dot"></div>
                </div>
                <div class="text-[10px] text-slate-400 font-medium">Toque para ver</div>
            </div>
        `;
    }

    loadIframe('ALL', rail.querySelector('.rail-card-active'));
}

async function loadIframe(parteNum, element) {
    const rail = document.getElementById("railPartes");
    rail.querySelectorAll('.snap-center').forEach(el => {
        el.classList.remove('border-blue-500', 'border-2', 'rail-card-active', 'bg-slate-950', 'text-white');
        el.classList.add('bg-white', 'text-slate-900', 'border-slate-200');
        const dot = el.querySelector('.status-dot');
        if(dot) dot.classList.replace('bg-blue-500', 'bg-slate-200');
    });

    if (parteNum === 'ALL') {
        element.classList.add('bg-slate-950', 'text-white', 'border-slate-950', 'rail-card-active');
    } else {
        element.classList.add('border-blue-500', 'border-2', 'rail-card-active');
        const dot = element.querySelector('.status-dot');
        if(dot) dot.classList.replace('bg-slate-200', 'bg-blue-500');
    }

    const container = document.getElementById("previewContainer");
    container.classList.add("animate-pulse");

    const payload = {
        cuitCliente: document.getElementById("cuit").value.trim(),
        domicilioRemito: domicilioRemitoGlobal,
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
    } catch(e) { console.error(e); }
    finally { container.classList.remove("animate-pulse"); }
}

// 3. ENVIAR NATIVO
async function shareNative() {
    // Si acá se necesita emitir primero, se conecta la lógica de facturar, por ahora manda el texto base
    if (itemsGlobal.length === 0) return mostrarAlerta("No hay factura procesada", "info");

    currentWaText = `*Factura - Mercado Limpio*\n\nTotal: $${totalFinalGlobal.toLocaleString('es-AR')}`;

    if (navigator.share) {
        try { await navigator.share({ title: 'Factura', text: currentWaText }); } 
        catch (err) { console.log('Cancelado'); }
    } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(currentWaText)}`, '_blank');
    }
}

// ALERTAS IOS STYLE
function mostrarAlerta(msg, tipo) {
    statusAlert.innerHTML = msg;
    statusAlert.className = `fixed top-16 left-1/2 transform -translate-x-1/2 z-[100] rounded-full px-5 py-3 text-xs font-black shadow-2xl min-w-[80%] text-center transition-all duration-300 ${
        tipo === 'success' ? 'bg-emerald-600 text-white' : 
        tipo === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
    }`;
    statusAlert.classList.remove("hidden");
    if(tipo !== 'info') setTimeout(() => statusAlert.classList.add("hidden"), 3500);
}
