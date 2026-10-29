// api/orden-compra.js
// Controlador para procesar la detonación y generación de la Orden de Compra en PDF

import {
    createMondayClient,
    uploadPdfToMonday,
    normalizeStr
} from '../services/mondayClient.js';
import {
    getOrdenCompraData,
    BOARD_ORDENES_DE_COMPRA,
    COLUMN_FILE_PDF_OC,
    COLUMN_STATUS_OC,
    COLUMN_TOTAL_OC
} from '../services/ordenCompraService.js';
import { generateOrdenCompraPdf } from '../services/pdfOrdenCompraService.js';

export default async function handler(req, res) {
    console.log("--> [WEBHOOK ORDEN DE COMPRA]:", req.method, JSON.stringify({ body: req.body, query: req.query }));

    // 1. Handshake de Monday (Challenge)
    if (req.body?.challenge) {
        console.log("[Webhook OC]: Respondiendo challenge:", req.body.challenge);
        return res.status(200).json({ challenge: req.body.challenge });
    }
    if (req.query?.challenge) {
        console.log("[Webhook OC]: Respondiendo challenge en query:", req.query.challenge);
        return res.status(200).json({ challenge: req.query.challenge });
    }

    const { event } = req.body || {};
    const pulseId = event?.pulseId || event?.itemId || req.query?.pulseId || req.body?.pulseId;

    if (req.method === 'GET' && !pulseId) {
        return res.status(200).json({
            status: 'ok',
            service: 'Ordenes de Compra Transtools',
            tip: 'Para detonar manualmente puedes pasar ?pulseId=TU_ID_DE_OC'
        });
    }

    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!pulseId) {
        console.warn("[Webhook OC]: Evento recibido sin pulseId:", JSON.stringify(req.body));
        return res.status(200).json({ message: 'Ignorado: sin pulseId' });
    }

    // 2. Parseo y verificación de evento de estado
    let valObj = event?.value;
    if (typeof valObj === 'string') {
        try { valObj = JSON.parse(valObj); } catch {}
    }
    const statusLabel = valObj?.label?.text || valObj?.label?.name || event?.label?.text || "";
    const colTitle = normalizeStr(event?.columnTitle || "");
    const normStatus = normalizeStr(statusLabel);

    console.log(`[Webhook OC]: pulseId=${pulseId}, colId=${event?.columnId}, statusLabel="${statusLabel}", colTitle="${colTitle}"`);

    // Si viene de un evento automático de webhook, validar que el estado sea GENERADA
    if (event) {
        const isOcCol = event.columnId === COLUMN_STATUS_OC || colTitle.includes("estatus de la oc");
        const isGenerada = normStatus.includes("generad");

        if (event.columnId && !isOcCol && !req.query?.force) {
            console.log(`[Webhook OC]: Ignorado: Columna "${event.columnId}" no es de estatus de OC.`);
            return res.status(200).json({ message: "Ignorado: columna no corresponde a estatus de OC" });
        }

        if (statusLabel && !isGenerada && !req.query?.force) {
            console.log(`[Webhook OC]: Ignorado: Estado "${statusLabel}" no es 'GENERADA'.`);
            return res.status(200).json({ message: `Ignorado: estado "${statusLabel}" no es 'GENERADA'` });
        }
    }

    const token = process.env.MONDAY_API_KEY;
    if (!token) {
        console.error("ERROR: MONDAY_API_KEY no configurada en variables de entorno.");
        return res.status(500).json({ error: "Falta MONDAY_API_KEY en variables de entorno" });
    }

    const fetchMonday = createMondayClient(token);

    try {
        // 3. Extraer y calcular información de la OC y sus subelementos
        console.log(`[Webhook OC]: Obteniendo datos para elemento ${pulseId}...`);
        const ordenCompra = await getOrdenCompraData({ fetchMonday, itemId: pulseId });

        console.log(`[Webhook OC]: Folio="${ordenCompra.folio}", Partidas=${ordenCompra.partidas.length}, Subtotal=${ordenCompra.totales.subtotal}, Total=${ordenCompra.totales.total}`);

        // 4. Generar el PDF oficial de la Orden de Compra
        console.log("[Webhook OC]: Generando archivo PDF...");
        const pdfBytes = await generateOrdenCompraPdf({ ordenCompra });

        // 5. Subir el PDF a Monday en la columna file_mm8fdbd2
        const safeFolio = ordenCompra.folio.replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `${safeFolio}.pdf`;
        console.log(`[Webhook OC]: Subiendo ${fileName} (${pdfBytes.length} bytes) a columna ${COLUMN_FILE_PDF_OC}...`);
        
        const uploadRes = await uploadPdfToMonday(pulseId, token, pdfBytes, fileName, COLUMN_FILE_PDF_OC);
        const pdfSubido = Boolean(uploadRes && !uploadRes.errors);
        console.log(`[Webhook OC]: Resultado de subida: ${pdfSubido ? 'EXITOSO' : 'FALLIDO'}`);

        // 6. Actualizar IMPORTE TOTAL DE OC (numeric_mm8fs1f1) en Monday
        try {
            const updateMutation = `mutation ($boardId: ID!, $itemId: ID!, $columnValues: JSON!) {
                change_multiple_column_values (
                    board_id: $boardId,
                    item_id: $itemId,
                    column_values: $columnValues
                ) {
                    id
                }
            }`;
            const colValues = JSON.stringify({
                [COLUMN_TOTAL_OC]: ordenCompra.totales.total
            });
            await fetchMonday(updateMutation, {
                boardId: BOARD_ORDENES_DE_COMPRA,
                itemId: String(pulseId),
                columnValues: colValues
            });
            console.log(`[Webhook OC]: Total actualizado en columna ${COLUMN_TOTAL_OC}: $${ordenCompra.totales.total}`);
        } catch (updErr) {
            console.warn("[Webhook OC]: No se pudo actualizar columna de Total en Monday:", updErr.message);
        }

        return res.status(200).json({
            success: true,
            folio: ordenCompra.folio,
            proveedor: ordenCompra.proveedor.nombre,
            partidas: ordenCompra.partidas.length,
            totales: ordenCompra.totales,
            pdfGenerado: pdfSubido
        });

    } catch (error) {
        console.error("---> [Error Crítico OC]:", error);
        return res.status(500).json({ error: error.message });
    }
}
