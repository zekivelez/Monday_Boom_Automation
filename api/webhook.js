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

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Verificación de handshake de Monday (Challenge)
    if (req.body && req.body.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    const { event } = req.body || {};
    if (!event) {
        return res.status(200).json({ message: 'Sin evento en el body' });
    }

    const pulseId = event.pulseId || event.itemId;
    console.log(`[Webhook Evento Recibido]: tipo="${event.type}", pulseId="${pulseId}"`);

    if (!pulseId) {
        console.warn("Evento recibido sin pulseId:", JSON.stringify(event));
        return res.status(200).json({ message: 'Ignorado: sin pulseId' });
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
            const r = await fetchMonday(mutation, {
                boardId,
                itemId,
                columnId,
                value: JSON.stringify({ label })
            });
            if (r.errors) {
                console.warn(`[STATUS]: Advertencia al actualizar estado a "${label}":`, JSON.stringify(r.errors));
            } else {
                console.log(`[STATUS]: Columna ${columnId} actualizada con éxito a "${label}".`);
            }
        } catch (e) {
            console.warn(`[STATUS]: No se pudo actualizar estado a "${label}":`, e.message);
        }
    };

    let currentBoardId = "18433030481";

    try {
        // =========================================================================
        // PASO 1: Leer la orden detonadora en PRUEBA API (18433030481)
        // =========================================================================
        console.log(`[Paso 1]: Consultando PRUEBA API para el ítem ${pulseId}...`);
        const queryGenerador = `query ($itemId: [ID!]) {
            items (ids: $itemId) {
                id
                name
                board { id }
                column_values {
                    id
                    text
                    value
                    type
                }
            }
        }`;

        const resGenerador = await fetchMonday(queryGenerador, { itemId: [pulseId] });
        const generadorItem = resGenerador.data?.items?.[0];
        if (!generadorItem) {
            throw new Error(`No se encontró el ítem con id ${pulseId} en PRUEBA API`);
        }
        if (generadorItem.board?.id) {
            currentBoardId = String(generadorItem.board.id);
        }

        const orderName = generadorItem.name || `Orden #${pulseId}`;
        const genCols = generadorItem.column_values || [];
        const colCantidad = genCols.find(c => c.id === "numeric_mm7m4t8r");
        const colProducto = genCols.find(c => c.id === "dropdown_mm7mhnmc");
        const colConfigDropdown = genCols.find(c => c.id === "dropdown_mm7mqdtg");
        const colConfigText = genCols.find(c => c.id === "text_mm7q5s7x");

        const productoSeleccionado = extractColText(colProducto);
        const configuracionDropdown = extractColText(colConfigDropdown);
        const configuracionTexto = extractColText(colConfigText);

        let cantidadEquipos = extractColNumber(colCantidad, 1);
        if (cantidadEquipos <= 0) cantidadEquipos = 1;

        // Determinar el código técnico de configuración (ej: DOTA-10M-2FMX-1-00101)
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

        console.log(`[PRUEBA API]: Orden="${orderName}", Producto="${productoSeleccionado}", ConfigNombre="${configNombreVisible}", ClaveTecnica="${configCodigoTecnico}", Cantidad=${cantidadEquipos}`);

        // =========================================================================
        // PASO 2 a 6: Explosión multinivel y consolidación de materiales
        // =========================================================================
        const { desgloses, consolidado } = await explodeBom({
            fetchMonday,
            configCodigoTecnico,
            configNombreVisible,
            productoSeleccionado,
            cantidadEquipos
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

        console.log(`[PDF]: Generado (${pdfBytes.length} bytes). Subiendo a PRUEBA API (file_mm7m2b35)...`);
        const safeOrderFile = orderName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const uploadRes = await uploadPdfToMonday(pulseId, token, pdfBytes, `LISTA_COMPRAS_${safeOrderFile}.pdf`);
        const pdfSubido = Boolean(uploadRes && !uploadRes.errors);
        console.log(`[PDF]: Resultado de subida: ${pdfSubido ? 'EXITOSO' : 'FALLIDO'}`);

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
        // PASO 9: Actualizar el estado en el tablero detonador a "Generado"
        // =========================================================================
        console.log(`[Paso 9]: Actualizando columna color_mm7z8wrp a 'Generado'...`);
        await updateStatusColumn(currentBoardId, pulseId, "color_mm7z8wrp", "Generado");

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
        console.error("---> Error crítico en handler:", error);
        try {
            await updateStatusColumn(currentBoardId, pulseId, "color_mm7z8wrp", "Error");
        } catch {}
        return res.status(500).json({ error: error.message });
    }
}