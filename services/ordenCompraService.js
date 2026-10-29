// services/ordenCompraService.js
// Servicio de extracción, consulta y cálculo de datos de la Orden de Compra desde Monday.com

import {
    extractColText,
    extractColNumber,
    normalizeStr
} from './mondayClient.js';

export const BOARD_ORDENES_DE_COMPRA = "18435123821";
export const COLUMN_FILE_PDF_OC = "file_mm8fdbd2";
export const COLUMN_STATUS_OC = "color_mm7xx0e8";
export const COLUMN_TOTAL_OC = "numeric_mm8fs1f1";

// Datos fiscales fijos de Transtools Manufacturing (Comprador / Datos de facturación)
export const DATOS_TRANSTOOLS = {
    razonSocial: "TransTools Manufacturing S.A. de C.V.",
    rfc: "TMA0910229Z7",
    direccion: "Carretera México - Veracruz km 175. S/n, Col. Mazatepec, Villa del Carmen Tequexquitla, Tlaxcala, C.P. 90570",
    correos: "facturas_transtools@outlook.com & compras@transtools.com.mx",
};

/**
 * Consulta y estructura toda la información de una Orden de Compra y sus subelementos
 */
export async function getOrdenCompraData({ fetchMonday, itemId }) {
    console.log(`[OC Service]: Consultando datos de la Orden de Compra ID ${itemId}...`);

    const query = `query ($itemId: [ID!]) {
        items(ids: $itemId) {
            id
            name
            board {
                id
                name
            }
            column_values {
                id
                type
                text
                value
                ... on MirrorValue {
                    display_value
                }
                ... on BoardRelationValue {
                    linked_items {
                        id
                        name
                        column_values {
                            id
                            text
                            value
                        }
                    }
                }
            }
            subitems {
                id
                name
                column_values {
                    id
                    type
                    text
                    value
                    ... on MirrorValue {
                        display_value
                    }
                }
            }
        }
    }`;

    const res = await fetchMonday(query, { itemId: [String(itemId)] });
    const item = res.data?.items?.[0];

    if (!item) {
        throw new Error(`No se encontró el elemento con ID ${itemId} en Monday.com`);
    }

    const cols = item.column_values || [];
    const getCol = (id) => cols.find(c => c.id === id);

    // 1. Extraer campos de la cabecera de la Orden de Compra
    const folioOC = item.name || `OC-${item.id}`;
    const idOrdenCompra = extractColText(getCol("pulse_id_mm8ffv4s")) || item.id;
    const prioridad = extractColText(getCol("color_mm8fvdt5")) || "NORMAL";
    const estatusOC = extractColText(getCol("color_mm7xx0e8")) || "GENERADA";

    // Fechas
    const fechaEmisionRaw = extractColText(getCol("date_mm7xytge"));
    const fechaComprometidaRaw = extractColText(getCol("date_mm8f45wm"));
    const fechaEmision = fechaEmisionRaw ? fechaEmisionRaw : new Date().toISOString().split('T')[0];
    const fechaComprometida = fechaComprometidaRaw ? fechaComprometidaRaw : "POR DEFINIR";

    // Condiciones comerciales
    const condicionesPago = extractColText(getCol("color_mm8fwjg7")) || "CONTADO";
    const moneda = extractColText(getCol("color_mm8fsf4m")) || "MXN";
    const compradorResponsable = extractColText(getCol("multiple_person_mm7xv7pt")) || "DEPARTAMENTO DE COMPRAS";
    const metodoPago = extractColText(getCol("color_mm8j46nz")) || "PUE (PAGO EN UNA SOLA EXHIBICIÓN)";
    const formaPago = extractColText(getCol("color_mm8jmev")) || "03 TRANSFERENCIA ELECTRÓNICA";
    const usoCfdi = extractColText(getCol("color_mm8j5cps")) || "G01 ADQUISICIÓN DE MERCANCÍAS";
    const entregaLab = extractColText(getCol("color_mm8j5558")) || "PLANTA MAZATEPEC (L.A.B.)";
    const ordenesFabricacion = extractColText(getCol("text_mm8fvgsb")) || "-";
    const observaciones = extractColText(getCol("long_text_mm7xeqbm")) || "";

    // 2. Extraer datos del Proveedor (board_relation_mm8fk8az)
    const provCol = getCol("board_relation_mm8fk8az");
    const linkedProv = provCol?.linked_items?.[0];
    let proveedorNombre = linkedProv?.name || extractColText(provCol) || "PROVEEDOR GENERAL";
    let proveedorRfc = "-";
    let proveedorDireccion = "-";
    let proveedorContacto = "-";
    let proveedorTelefono = "-";
    let proveedorCorreo = "-";

    if (linkedProv && linkedProv.column_values) {
        for (const pc of linkedProv.column_values) {
            const val = extractColText(pc);
            const idNorm = normalizeStr(pc.id || "");
            if (!val) continue;

            if (idNorm.includes("rfc") && proveedorRfc === "-") {
                proveedorRfc = val;
            } else if ((idNorm.includes("direccion") || idNorm.includes("domicilio")) && proveedorDireccion === "-") {
                proveedorDireccion = val;
            } else if ((idNorm.includes("contacto") || idNorm.includes("atencion")) && proveedorContacto === "-") {
                proveedorContacto = val;
            } else if ((idNorm.includes("telefono") || idNorm.includes("celular") || idNorm.includes("tel")) && proveedorTelefono === "-") {
                proveedorTelefono = val;
            } else if ((idNorm.includes("correo") || idNorm.includes("email") || idNorm.includes("mail")) && proveedorCorreo === "-") {
                proveedorCorreo = val;
            }
        }
    }

    // 3. Procesar subelementos (partidas de la orden de compra)
    const rawSubitems = item.subitems || [];
    const partidas = [];
    let subtotalCalculado = 0;

    for (let i = 0; i < rawSubitems.length; i++) {
        const sub = rawSubitems[i];
        const sc = sub.column_values || [];
        const getSubCol = (id) => sc.find(c => c.id === id);

        const nombreMaterial = sub.name || `Partida ${i + 1}`;

        // Cantidad ordenada: numeric_mm8fhc9y
        let cantOrdenada = extractColNumber(getSubCol("numeric_mm8fhc9y"), 0);
        if (cantOrdenada <= 0) cantOrdenada = 1;

        // Unidad de compra: lookup_mm8fxhk1
        let unidad = extractColText(getSubCol("lookup_mm8fxhk1")) || "PZA";
        if (!isNaN(Number(unidad.trim().replace(',', '.')))) {
            unidad = "PZA";
        }

        // Precios:
        // PRECIO UNITARIO ACTUAL: lookup_mm8ft668
        const precioUnitarioActual = extractColNumber(getSubCol("lookup_mm8ft668"), 0);
        // precio negociado: numeric_mm8fptc1
        const precioNegociado = extractColNumber(getSubCol("numeric_mm8fptc1"), 0);

        // Criterio: Usar precio negociado si > 0; de lo contrario precio unitario actual
        const precioUnitario = (precioNegociado > 0) ? precioNegociado : precioUnitarioActual;
        const importePartida = Number((cantOrdenada * precioUnitario).toFixed(2));
        subtotalCalculado += importePartida;

        // Fecha de llegada: date0
        const fechaLlegada = extractColText(getSubCol("date0")) || fechaComprometida;

        partidas.push({
            partidaNum: i + 1,
            descripcion: nombreMaterial,
            cantidad: cantOrdenada,
            unidad,
            precioUnitarioActual,
            precioNegociado,
            precioUnitario,
            importe: importePartida,
            fechaLlegada
        });
    }

    subtotalCalculado = Number(subtotalCalculado.toFixed(2));
    const ivaCalculado = Number((subtotalCalculado * 0.16).toFixed(2));
    const totalCalculado = Number((subtotalCalculado + ivaCalculado).toFixed(2));

    return {
        id: item.id,
        folio: folioOC,
        idOrdenCompra,
        prioridad,
        estatusOC,
        fechaEmision,
        fechaComprometida,
        condicionesPago,
        moneda,
        compradorResponsable,
        metodoPago,
        formaPago,
        usoCfdi,
        entregaLab,
        ordenesFabricacion,
        observaciones,
        proveedor: {
            nombre: proveedorNombre,
            rfc: proveedorRfc,
            direccion: proveedorDireccion,
            contacto: proveedorContacto,
            telefono: proveedorTelefono,
            correo: proveedorCorreo
        },
        comprador: DATOS_TRANSTOOLS,
        partidas,
        totales: {
            subtotal: subtotalCalculado,
            iva: ivaCalculado,
            total: totalCalculado
        }
    };
}
