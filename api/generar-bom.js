// api/generar-bom.js
// Endpoint Serverless (Next.js / Vercel) para detonar la generación del BOM de Fabricación

import path from 'path';
import fs from 'fs';
import React from 'react';
import { renderToStream } from '@react-pdf/renderer';
import { createMondayClient, uploadPdfToMonday } from '../services/mondayClient.js';
import { getOrdenFabricacionBomData, BOARD_ORDENES_FABRICACION } from '../services/bomFabricacionService.js';
import { BomFabricacionPdf } from '../components/BomFabricacionPdf.js';

export default async function handler(req, res) {
    // 1. Verificación de Handshake de Monday (Challenge)
    if (req.method === 'POST' && req.body?.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { event } = req.body || {};
    const pulseId = event?.pulseId || event?.itemId || req.query?.pulseId || req.body?.pulseId;

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

        // 3. Ubicar el Logo corporativo Transtools si está en el sistema de archivos
        let logoPath = path.resolve('Logo-azul.png');
        if (!fs.existsSync(logoPath)) {
            logoPath = path.resolve(process.cwd(), 'Logo-azul.png');
            if (!fs.existsSync(logoPath)) logoPath = null;
        }

        // 4. Renderizar el PDF a Stream con @react-pdf/renderer
        console.log("[Generar BOM]: Renderizando PDF estructurado con @react-pdf/renderer...");
        const doc = React.createElement(BomFabricacionPdf, {
            data: bomData,
            logoPath
        });

        const stream = await renderToStream(doc);
        const chunks = [];
        for await (const chunk of stream) {
            chunks.push(chunk);
        }
        const pdfBuffer = Buffer.concat(chunks);
        console.log(`[Generar BOM]: PDF renderizado con éxito (${pdfBuffer.length} bytes).`);

        // 5. Determinar la columna de archivos en la Orden de Fabricación
        // Por defecto busca la columna "BOM DE FABRICACION" o tipo "file"
        const safeFolio = (bomData.orden.folio || `OF_${pulseId}`).replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `BOM_FABRICACION_${safeFolio}.pdf`;

        // 6. Subir el PDF a Monday en la columna correspondiente
        const targetFileColumn = bomData.orden.fileColumnId || "file_mm7m2b35";
        console.log(`[Generar BOM]: Subiendo ${fileName} a Monday (columna: ${targetFileColumn})...`);
        const uploadResult = await uploadPdfToMonday(pulseId, token, pdfBuffer, fileName, targetFileColumn);
        console.log("[Generar BOM]: Resultado subida Monday:", JSON.stringify(uploadResult));

        return res.status(200).json({
            success: true,
            folio: bomData.orden.folio,
            cliente: bomData.orden.cliente,
            modulosProcesados: bomData.modulos.length,
            pdfBytes: pdfBuffer.length,
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
