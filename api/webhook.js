// api/webhook.js
// Controlador principal para detonación y orquestación del flujo BOM -> PDF -> Solicitudes de Compra

import {
    createMondayClient,
    extractColText,
    extractColNumber,
    uploadPdfToMonday,
    normalizeStr
} from '../services/mondayClient.js';
import { explodeBom } from '../services/bomService.js';
import { generateComprasReportPdf } from '../services/pdfService.js';
import { syncSolicitudesDeCompra } from '../services/comprasService.js';

// Mapeo automático de nombres descriptivos a códigos de configuración técnica
const CONFIG_ALIASES = {
    "BOM DOLLY A SCORPION 2 EJES": "DOTA-10M-2FMX-1-00101",
    "DOLLY A SCORPION 2 EJES": "DOTA-10M-2FMX-1-00101",
    "BOM DOLLY A SCORPION": "DOTA-10M-2FMX-1-00101",
    "DOLLY A SCORPION": "DOTA-10M-2FMX-1-00101",
    "DOLLY A": "DOTA-10M-2FMX-1-00101"
};

// Tablero oficial detonador: ÓRDENES DE FABRICACIÓN
export const BOARD_ORDENES_FABRICACION = "18434500734";

// Columnas oficiales en el tablero de Órdenes de Fabricación (18434500734) para Lista de Compras
export const COLUMN_STATUS_COMPRAS = "color_mm8bdx4x";
export const COLUMN_FILE_COMPRAS = "file_mm8bcx7";
export const COLUMN_LINK_COMPRAS = "link_mm8b30hj";

export default async function handler(req, res) {
    console.log("--> [WEBHOOK COMPRAS ENTRADA]:", req.method, JSON.stringify({ body: req.body, query: req.query }));

    // 1. Verificación de handshake de Monday (Challenge)
    if (req.body?.challenge) {
        console.log("[Webhook Compras]: Respondiendo challenge:", req.body.challenge);
        return res.status(200).json({ challenge: req.body.challenge });
    }
    if (req.query?.challenge) {
        console.log("[Webhook Compras]: Respondiendo challenge en query:", req.query.challenge);
        return res.status(200).json({ challenge: req.query.challenge });
    }

    const { event } = req.body || {};
    const pulseId = event?.pulseId || event?.itemId || req.query?.pulseId || req.body?.pulseId;

    if (req.method === 'GET' && !pulseId) {
        return res.status(200).json({
            status: 'ok',
            service: 'Lista de Compras Transtools',
            tip: 'Para detonar manualmente puedes pasar ?pulseId=TU_ID_DE_OF'
        });
    }

    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!pulseId) {
        console.warn("[Webhook Compras]: Evento recibido sin pulseId:", JSON.stringify(req.body));
        return res.status(200).json({ message: 'Ignorado: sin pulseId' });
    }

    // 2. Parseo seguro de event.value (puede venir como objeto o como string JSON)
    let valObj = event?.value;
    if (typeof valObj === 'string') {
        try { valObj = JSON.parse(valObj); } catch {}
    }
    const statusLabel = valObj?.label?.text || valObj?.label?.name || event?.label?.text || "";
    console.log(`[Webhook Compras]: pulseId=${pulseId}, columnId=${event?.columnId}, statusLabel="${statusLabel}"`);

    if (statusLabel) {
        const normStatus = normalizeStr(statusLabel);
        // Si el estado no corresponde a "generar lista" o "generar", evitamos re-ejecución
        if (!normStatus.includes("generar lista") && !normStatus.includes("generar") && !normStatus.includes("lista")) {
            console.log(`[Webhook Compras]: Cambio de estado a "${statusLabel}" ignorado (no es 'Generar lista').`);
            return res.status(200).json({ message: `Ignorado: estado "${statusLabel}"` });
        }
    }

    const token = process.env.MONDAY_API_KEY;
    if (!token) {
        console.error("ERROR: MONDAY_API_KEY no configurada en las variables de entorno.");
        return res.status(500).json({ error: "Falta MONDAY_API_KEY" });
    }

    const fetchMonday = createMondayClient(token);

    const updateStatusColumn = async (boardId, itemId, columnId, label) => {
        try {
            const mutation = `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
                change_column_value (
                    board_id: $boardId,
                    item_id: $itemId,
                    column_id: $columnId,
                    value: $value
                ) {
                    id
                }
            }`;
            let r = await fetchMonday(mutation, {
                boardId,
                itemId,
                columnId,
                value: JSON.stringify({ label })
            });
            // Si la etiqueta no existe en Monday, intentar con "EN PLANEACION" (etiqueta válida en color_mm8bdx4x)
            if (r.errors && JSON.stringify(r.errors).includes("status label doesn't exist")) {
                console.warn(`[STATUS]: Etiqueta "${label}" no existe en ${columnId}, aplicando "EN PLANEACION"...`);
                r = await fetchMonday(mutation, {
                    boardId,
                    itemId,
                    columnId,
                    value: JSON.stringify({ label: "EN PLANEACION" })
                });
            }
            if (r.errors) {
                console.warn(`[STATUS]: Advertencia en columna ${columnId}:`, JSON.stringify(r.errors));
            } else {
                console.log(`[STATUS]: Columna ${columnId} actualizada correctamente.`);
            }
        } catch (e) {
            console.warn(`[STATUS]: Excepción en columna ${columnId}:`, e.message);
        }
    };

    const updateLinkColumn = async (boardId, itemId, columnId, url, text) => {
        try {
            const mutation = `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
                change_column_value (
                    board_id: $boardId,
                    item_id: $itemId,
                    column_id: $columnId,
                    value: $value
                ) {
                    id
                }
            }`;
            const r = await fetchMonday(mutation, {
                boardId,
                itemId,
                columnId,
                value: JSON.stringify({ url, text })
            });
            if (r.errors) {
                console.warn(`[LINK]: Advertencia al actualizar columna link ${columnId}:`, JSON.stringify(r.errors));
            } else {
                console.log(`[LINK]: Columna ${columnId} actualizada con éxito -> "${url}" (${text}).`);
            }
        } catch (e) {
            console.warn(`[LINK]: No se pudo actualizar columna de link ${columnId}:`, e.message);
        }
    };

    let currentBoardId = event?.boardId ? String(event.boardId) : BOARD_ORDENES_FABRICACION;
    let targetStatusColId = event?.columnId || null;

    try {
        // =========================================================================
        // PASO 1: Leer la Orden de Fabricación en Monday (Tablero 18434500734)
        // =========================================================================
        console.log(`[Paso 1]: Consultando ítem ${pulseId} en tablero ${currentBoardId}...`);
        const queryGenerador = `query ($itemId: [ID!]) {
            items (ids: $itemId) {
                id
                name
                board {
                    id
                    name
                    columns { id title type }
                }
                column_values {
                    id
                    text
                    value
                    type
                    ... on MirrorValue { display_value }
                    ... on BoardRelationValue { display_value linked_item_ids linked_items { id name } }
                }
                subitems {
                    id
                    name
                    column_values {
                        id
                        text
                        value
                        type
                        ... on MirrorValue { display_value }
                        ... on BoardRelationValue { display_value linked_item_ids linked_items { id name } }
                    }
                }
            }
        }`;

        const resGenerador = await fetchMonday(queryGenerador, { itemId: [pulseId] });
        const generadorItem = resGenerador.data?.items?.[0];
        if (!generadorItem) {
            throw new Error(`No se encontró el ítem con id ${pulseId} en Monday`);
        }
        if (generadorItem.board?.id) {
            currentBoardId = String(generadorItem.board.id);
        }

        const boardCols = generadorItem.board?.columns || [];
        const genCols = generadorItem.column_values || [];

        // Helper para ubicar columnas por ID o por coincidencia de título
        const findCol = (idPattern, titlePattern) => {
            let c = genCols.find(col => col.id === idPattern);
            if (c) return c;
            if (titlePattern) {
                const bCol = boardCols.find(b => {
                    const t = normalizeStr(b.title || "");
                    return t.includes(normalizeStr(titlePattern));
                });
                if (bCol) return genCols.find(col => col.id === bCol.id);
            }
            return null;
        };

        // Identificar columna de estado: prioridad a event.columnId o a la columna oficial COLUMN_STATUS_COMPRAS (color_mm8bdx4x)
        if (!targetStatusColId) {
            targetStatusColId = COLUMN_STATUS_COMPRAS;
        }

        // El estado se mantiene en 'GENERAR LISTA' tal como fue seleccionado

        // Datos de la orden (priorizando columnas del tablero 18434500734)
        const orderFolio = findCol("text_mm86c6s1", "id orden")?.text || (generadorItem.name.match(/OF[0-9A-Za-z_-]+/i)?.[0]);
        const orderName = orderFolio || generadorItem.name || `Orden #${pulseId}`;
        const colCantidad = findCol("numeric_mm86z5h6", "cantidad") || findCol("numeric_mm7m4t8r", "cantidad");
        const colProducto = findCol("text_mm86hsh9", "codigo de producto") || findCol("dropdown_mm7mhnmc", "producto");
        const colConfigText = findCol("text_mm864yeg", "codigo de configuracion") || findCol("text_mm7q5s7x", "codigo de configuracion");
        const colConfigDropdown = findCol("board_relation_mm86d06q", "catalogo de productos") || findCol("board_relation_mm7xwz6z", "configuracion") || findCol("dropdown_mm7mqdtg", "configuracion");

        const productoSeleccionado = extractColText(colProducto);
        const configuracionDropdown = extractColText(colConfigDropdown);
        const configuracionTexto = extractColText(colConfigText);

        let cantidadEquipos = extractColNumber(colCantidad, 1);
        if (cantidadEquipos <= 0) cantidadEquipos = 1;

        // Determinar código técnico de configuración (ej: DOTA-10M-2FMX-1-00101)
        let configCodigoTecnico = configuracionTexto || "";
        if (!configCodigoTecnico && configuracionDropdown) {
            configCodigoTecnico = CONFIG_ALIASES[configuracionDropdown.trim()] || "";
            if (!configCodigoTecnico) {
                const normDrop = normalizeStr(configuracionDropdown);
                for (const [alias, code] of Object.entries(CONFIG_ALIASES)) {
                    if (normDrop.includes(normalizeStr(alias)) || normalizeStr(alias).includes(normDrop)) {
                        configCodigoTecnico = code;
                        break;
                    }
                }
            }
        }
        if (!configCodigoTecnico && productoSeleccionado) {
            configCodigoTecnico = CONFIG_ALIASES[productoSeleccionado.trim()] || "";
        }
        if (!configCodigoTecnico) {
            configCodigoTecnico = configuracionDropdown || configuracionTexto || "DOTA-10M-2FMX-1-00101";
        }

        const configNombreVisible = configuracionDropdown || configCodigoTecnico;

        console.log(`[Compras]: Orden="${orderName}", Producto="${productoSeleccionado}", ConfigNombre="${configNombreVisible}", ClaveTecnica="${configCodigoTecnico}", Cantidad=${cantidadEquipos}`);

        // =========================================================================
        // PASO 2 a 6: Explosión multinivel y consolidación de materiales
        // =========================================================================
        console.log("[Paso 2]: Iniciando explosión de materiales...");
        const { desgloses, consolidado } = await explodeBom({
            fetchMonday,
            configCodigoTecnico,
            configNombreVisible,
            productoSeleccionado,
            cantidadEquipos,
            orderSubitems: generadorItem.subitems || []
        });

        // =========================================================================
        // PASO 7: Generar y subir el Reporte PDF Oficial de Lista para Compras
        // =========================================================================
        console.log("[Paso 7]: Generando Lista de Compras en PDF...");
        const pdfBytes = await generateComprasReportPdf({
            orderName,
            producto: productoSeleccionado,
            configNombre: configNombreVisible,
            configCodigo: configCodigoTecnico,
            cantidadEquipos,
            consolidado
        });

        // Columna fija y oficial para el archivo PDF de Compras (file_mm8bcx7)
        const fileColId = COLUMN_FILE_COMPRAS;

        console.log(`[PDF Compras]: Generado (${pdfBytes.length} bytes). Subiendo a columna ${fileColId}...`);
        const safeOrderFile = orderName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const uploadRes = await uploadPdfToMonday(pulseId, token, pdfBytes, `LISTA_COMPRAS_${safeOrderFile}.pdf`, fileColId);
        const pdfSubido = Boolean(uploadRes && !uploadRes.errors);
        console.log(`[PDF Compras]: Resultado de subida: ${pdfSubido ? 'EXITOSO' : 'FALLIDO'}`);

        // =========================================================================
        // PASO 8: Sincronizar partidas en el tablero SOLICITUDES DE COMPRA (18434424067)
        // =========================================================================
        console.log("[Paso 8]: Sincronizando partidas en tablero SOLICITUDES DE COMPRA...");
        const comprasSyncResult = await syncSolicitudesDeCompra({
            fetchMonday,
            orderName,
            producto: productoSeleccionado,
            configNombre: configNombreVisible,
            configCodigo: configCodigoTecnico,
            consolidado
        });

        // =========================================================================
        // PASO 8.5: Pegar enlace de Solicitudes de Compra en columna link_mm8b30hj
        // =========================================================================
        const firstPulseId = comprasSyncResult?.itemsIds?.[0];
        const solicitudesUrl = firstPulseId 
            ? `https://transtools.monday.com/boards/18434424067/pulses/${firstPulseId}`
            : `https://transtools.monday.com/boards/18434424067`;
        const linkLabel = `Solicitudes de Compra (${comprasSyncResult?.totalCreados || 0})`;

        console.log(`[Paso 8.5]: Pegando enlace en columna ${COLUMN_LINK_COMPRAS} -> ${solicitudesUrl}...`);
        await updateLinkColumn(currentBoardId, pulseId, COLUMN_LINK_COMPRAS, solicitudesUrl, linkLabel);

        // =========================================================================
        // PASO 9: El estado permanece intacto en "GENERAR LISTA"
        // =========================================================================
        console.log(`[Paso 9]: Proceso completado con éxito. Estado conservado en 'GENERAR LISTA'.`);

        return res.status(200).json({
            success: true,
            orden: orderName,
            producto: productoSeleccionado,
            configuracion: configNombreVisible,
            codigoTecnico: configCodigoTecnico,
            cantidadEquipos,
            submodulosExplosionados: desgloses.length,
            materialesTotales: consolidado.length,
            pdfGenerado: pdfSubido,
            solicitudesCompra: comprasSyncResult
        });

    } catch (error) {
        console.error("---> [Error Crítico Compras]:", error);
        return res.status(500).json({ error: error.message });
    }
}