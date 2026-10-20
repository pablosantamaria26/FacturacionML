# Auditoría previa — Rediseño Facturación ML (oct-2026)

**Estado inicial (punto de restauración):** etiqueta `pre-rediseno-2026-10`
- FacturacionML `main` = `a577d5f` (publicado en GitHub Pages: `pablosantamaria26.github.io/FacturacionML/`)
- afip-worker `main` = `aea3680` (Render: `api-mercadolimpio.onrender.com`)

**Rama de trabajo:** `rediseno-2026-10` en ambos repos. Nada se fusiona a `main` sin autorización.

## Arquitectura relevada

| Pieza | Archivo | Notas |
|---|---|---|
| Pantallas + estilos | `index.html` (1.570 líneas, ~1.000 de CSS inline) | Emojis como íconos, estilos inline en muchas plantillas |
| Lógica | `app.js` (2.155 líneas) | 128 IDs de DOM; funciones globales `window.*` llamadas desde `onclick` |
| Service Worker | `sw.js` | Cachea solo GET propios; no intercepta la API (fix iOS multipart) |
| Manifest / ícono | `manifest.json`, `icon.png` | **Ícono de 2048×2048 y 6,7 MB** para 192/512 → se reemplaza por íconos livianos |
| Backend | `afip-worker/index.js` | Reglas fiscales; el frontend solo consume endpoints |

### Endpoints que usa el frontend
`/health`, `/leer-remito` (PDF), `/debug/preview`, `/facturar`, `/procesar-extracto` + `/estado-procesar/:id`, `/facturar-extracto` + `/estado-extracto/:id`, `/historial`, `/admin/facturas-mes`, `/anular-comprobante`, `/reenviar-email`, `/enviar-resumen`. Nuevo en backend (oct-2026): `/padron/:cuit`.

### Datos guardados en el dispositivo (localStorage)
`ml_emails_cuit` (email por CUIT), `ml_historial` (cache por mes), `ml_pending_emission` (emisión en curso), `ml_last_result` (último resultado), `ml_kpis_cache`, `ml_email_contactos`, `ml_email_send_history`.

## Matriz de preservación

| Módulo | Función actual | Cambio propuesto | Riesgo | Prueba |
|---|---|---|---|---|
| Facturar | CUIT + monto, condición de venta (4), email recordado por CUIT, descripción, atajos Make/Romil/Varios | Rediseño visual, mismos IDs y funciones | Bajo | Regresión: emitir manual (simulado) |
| Facturar | Subir 1+ remitos PDF → `/leer-remito` (IA) | Igual; se agrega acceso rápido | Bajo | Regresión con fixture |
| Facturar | Vista previa automática (debounce 1,5 s), partes de 25 ítems | En PC: vista previa fija a la derecha; en celular: hoja inferior | Medio (se mueve el iframe) | Vista previa 1 y >25 ítems |
| Facturar | Letra A/B la decide el backend | Se muestra en el resumen vía `/padron/:cuit` (solo lectura) | Bajo | CUIT RI y CF |
| Facturar | Pasos animados de emisión, recuperación de emisión pendiente (10 min), último resultado (30 min) | Igual, rediseñado | Medio | Recuperación interrumpida |
| Facturar | Pantalla de éxito: WhatsApp, compartir, abrir PDF, link PDF, Avisar a Oficina, emitir otra | Confirmación profesional: tipo, número, cliente, monto, CAE, estado ARCA, estado email + reenviar email | Medio | Email OK / email falló |
| Facturar | Anular factura de otro mes (letra, PV, nro, CUIT, monto, fecha, motivo) | Igual | Bajo | Modal y payload |
| **Facturar** | — | **NUEVO: foto de remito** (cámara/galería → revisión → mismo circuito de emisión) | Medio | Ver sección cámara |
| Extracto | Subir xlsx/PDF/imagen, despertar servidor, análisis en 2º plano con polling | Rediseño | Bajo | Fixture de análisis |
| Extracto | Lista con CUIT editable, incluir/excluir, "ya facturada" | Celular: tarjetas; PC: tabla | Medio | CUIT incompleto, ya facturada |
| Extracto | Facturar seleccionadas / Facturar todo (con revisión) | Igual | Medio | Payload idéntico (referencia incluida) |
| Extracto | Progreso, interrumpido, aviso de secuencia, resultados con PDF y errores | Rediseño | Bajo | Fixture con errores |
| Historial | Mes ‹ ›, búsqueda nombre/CUIT, stats, detalle, PDF, reenviar, NC | Tabla en PC, tarjetas en celular; **filtros por letra, origen y estado; búsqueda también por número, monto y fecha** (sobre datos reales del mes) | Medio | Búsquedas y filtros |
| Resumen | Modal mensual: KPIs, lista con PDF/NC/Email, ranking por cliente, cache local | Rediseño | Bajo | Mes con datos / sin datos |
| Email | Mes, destinatarios (Pablo, Contador, agregar/quitar), enviar resumen, historial de envíos | Rediseño | Bajo | Envío simulado |
| ARCA / fiscal | Todo en backend (tipo A/B/M, fechas, secuencia, dedup, leyendas, QR) | **Sin cambios** | Alto si se toca | No se toca |
| PWA | SW, manifest, ícono | Íconos livianos, apple-touch-icon, pantalla de inicio, SW con nombre de caché por entorno | Medio | Instalación |
| Global | Toasts, overlay de NC, banner de servidor iniciando, keep-alive 9 min | Rediseño | Bajo | Arranque en frío |

## Riesgos detectados

1. **Mismo dominio prueba/producción:** un sitio de prueba en `pablosantamaria26.github.io` comparte localStorage y Cache Storage con la app real. Además, el SW actual borra todas las cachés que no son la suya.
   - Medida: la versión de prueba prefija su localStorage y el SW nuevo solo borra cachés propias.
2. **Pruebas sin emitir:** en modo prueba, las operaciones que escriben (emitir, facturar extracto, anular, reenviar email, enviar resumen) se **simulan**. Lecturas reales (historial, KPIs, padrón, vista previa).
3. **Foto de remito necesita backend nuevo:** `/leer-remito` solo lee texto de PDF. Se agrega `/leer-remito-foto` (aditivo). Requiere publicar el backend → **pedir autorización**.
4. **`email_status = pending`** es el estado normal de las facturas de extracto (no se manda email individual). Solo `failed` es falla real: el centro de pendientes usa solo `failed`.
5. **Historial ordena por número**, con series A, B y M mezcladas → el frontend ordena por fecha.
