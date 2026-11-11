// api/generar-bom.js
// Endpoint Serverless (Vercel) para detonar la generación del BOM de Fabricación usando pdf-lib nativo

import { createMondayClient, uploadPdfToMonday } from '../services/mondayClient.js';
import { getOrdenFabricacionBomData, COLUMN_FILE_BOM } from '../services/bomFabricacionService.js';
import { generateBomFabricacionPdf } from '../services/pdfService.js';
import webhookComprasHandler from './webhook.js';
import listaAlmacenHandler from './lista-almacen.js';
import ordenCompraHandler from './orden-compra.js';
import { COLUMN_STATUS_ALMACEN } from '../services/listaAlmacenService.js';
import { BOARD_ORDENES_DE_COMPRA, COLUMN_STATUS_OC } from '../services/ordenCompraService.js';

export default async function handler(req, res) {
    console.log("--> [ENDPOINT GENERAR-BOM]:", req.method, JSON.stringify({ body: req.body, query: req.query }));

    // 1. Verificación de Handshake de Monday (Challenge)
    if (req.body?.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }
    if (req.query?.challenge) {
        return res.status(200).json({ challenge: req.query.challenge });
    }

    if (req.method === 'GET') {
        return res.status(200).json({ status: 'ok', service: 'BOM Fabricación Transtools' });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { event } = req.body || {};
    const pulseId = event?.pulseId || event?.itemId || req.query?.pulseId || req.body?.pulseId;

    // Delegación automática: si el evento viene del tablero de Órdenes de Compra (18435123821) o columna color_mm7xx0e8
    if (String(event?.boardId || "") === BOARD_ORDENES_DE_COMPRA || event?.columnId === COLUMN_STATUS_OC) {
        console.log(`[Generar BOM]: Evento detectado para Orden de Compra, delegando a orden-compra...`);
        return await ordenCompraHandler(req, res);
    }

    // Delegación automática: si el evento viene de la columna de Compras color_mm8bdx4x
    if (event?.columnId === 'color_mm8bdx4x') {
        console.log(`[Generar BOM]: Evento detectado para Compras (columna color_mm8bdx4x), delegando a webhook de compras...`);
        return await webhookComprasHandler(req, res);
    }

    // Delegación automática: si el evento viene de la columna de Lista de Almacén color_mm8zwkgh
    if (event?.columnId === COLUMN_STATUS_ALMACEN) {
        console.log(`[Generar BOM]: Evento detectado para Lista de Almacén (columna ${COLUMN_STATUS_ALMACEN}), delegando a lista-almacen...`);
        return await listaAlmacenHandler(req, res);
    }

    console.log(`[Webhook Generar BOM]: Recibido para pulseId: ${pulseId}`);

    if (!pulseId) {
        return res.status(200).json({ message: 'Sin pulseId para procesar' });
    }

    const token = process.env.MONDAY_API_KEY;
    if (!token) {
        console.error("ERROR: MONDAY_API_KEY no definida en variables de entorno.");
        return res.status(500).json({ error: "Falta MONDAY_API_KEY" });
    }

    const fetchMonday = createMondayClient(token);

    try {
        // 2. Extraer datos estructurados de la Orden de Fabricación y sus submódulos
        console.log(`[Generar BOM]: Extrayendo datos de la Orden ID ${pulseId}...`);
        const bomData = await getOrdenFabricacionBomData(fetchMonday, pulseId);

        // 3. Generar el PDF nativo con pdf-lib (sin pdfkit ni React)
        console.log("[Generar BOM]: Generando PDF nativo con pdf-lib...");
        const pdfBytes = await generateBomFabricacionPdf(bomData);
        console.log(`[Generar BOM]: PDF generado con éxito (${pdfBytes.length} bytes).`);

        // 4. Subir el PDF a Monday en la columna exacta file_mm7yxtgh
        const safeFolio = (bomData.orden.folio || `OF_${pulseId}`).replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `BOM_FABRICACION_${safeFolio}.pdf`;
        const targetColumn = bomData.orden.fileColumnId || COLUMN_FILE_BOM || "file_mm7yxtgh";

        console.log(`[Generar BOM]: Subiendo ${fileName} a Monday (columna: ${targetColumn})...`);
        const uploadResult = await uploadPdfToMonday(pulseId, token, pdfBytes, fileName, targetColumn);
        console.log("[Generar BOM]: Resultado subida Monday:", JSON.stringify(uploadResult));

        return res.status(200).json({
            success: true,
            folio: bomData.orden.folio,
            cliente: bomData.orden.cliente,
            modulosProcesados: bomData.modulos.length,
            pdfBytes: pdfBytes.length,
            uploadResult
        });

    } catch (error) {
        console.error("[Generar BOM Error]:", error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
