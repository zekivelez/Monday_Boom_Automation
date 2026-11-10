// api/lista-almacen.js
// Endpoint independiente para generar el PDF de Lista de Almacén por Submódulo
// Se detona cuando la columna color_mm8zwkgh cambia a "GENARAR LISTA ALMACEN" / "GENERAR LISTA ALMACEN"
// Sube el PDF resultante en la columna file_mm8zwsx3

import {
    createMondayClient,
    uploadPdfToMonday,
    normalizeStr
} from '../services/mondayClient.js';
import {
    getListaAlmacenData,
    generateListaAlmacenPdf,
    COLUMN_STATUS_ALMACEN,
    COLUMN_FILE_ALMACEN
} from '../services/listaAlmacenService.js';

export default async function handler(req, res) {
    console.log("--> [WEBHOOK LISTA ALMACÉN]:", req.method, JSON.stringify({ body: req.body, query: req.query }));

    // 1. Handshake de Monday (Challenge)
    if (req.body?.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }
    if (req.query?.challenge) {
        return res.status(200).json({ challenge: req.query.challenge });
    }

    const { event } = req.body || {};
    const pulseId = event?.pulseId || event?.itemId || req.query?.pulseId || req.body?.pulseId;

    if (req.method === 'GET' && !pulseId) {
        return res.status(200).json({
            status: 'ok',
            service: 'Lista de Almacén por Submódulo Transtools',
            tip: 'Para detonar manualmente puedes pasar ?pulseId=TU_ID_DE_OF'
        });
    }

    if (req.method !== 'POST' && req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!pulseId) {
        return res.status(200).json({ message: 'Ignorado: sin pulseId' });
    }

    // 2. Validar columna de estado (color_mm8zwkgh) y etiqueta ("GENARAR LISTA ALMACEN" o "GENERAR LISTA ALMACEN")
    let valObj = event?.value;
    if (typeof valObj === 'string') {
        try { valObj = JSON.parse(valObj); } catch {}
    }
    const statusLabel = valObj?.label?.text || valObj?.label?.name || event?.label?.text || "";
    const colTitle = normalizeStr(event?.columnTitle || "");
    const normStatus = normalizeStr(statusLabel);

    console.log(`[Webhook Almacén]: pulseId=${pulseId}, colId=${event?.columnId}, statusLabel="${statusLabel}", colTitle="${colTitle}"`);

    if (event && !req.query?.force) {
        const isAlmacenCol = event.columnId === COLUMN_STATUS_ALMACEN || colTitle.includes("almacen");
        const isGenerarAlmacenStatus =
            normStatus.includes("almacen") ||
            normStatus.includes("genarar lista") ||
            normStatus.includes("generar lista almacen");

        if (event.columnId && !isAlmacenCol && !isGenerarAlmacenStatus) {
            console.log(`[Webhook Almacén]: Ignorado: Columna "${event.columnId}" no pertenece a Lista Almacén.`);
            return res.status(200).json({ message: "Ignorado: evento no pertenece a Lista Almacén" });
        }

        if (statusLabel && !isGenerarAlmacenStatus) {
            console.log(`[Webhook Almacén]: Estado "${statusLabel}" ignorado (no es 'GENERAR LISTA ALMACEN').`);
            return res.status(200).json({ message: `Ignorado: estado "${statusLabel}" no dispara Lista Almacén` });
        }
    }

    const token = process.env.MONDAY_API_KEY;
    if (!token) {
        console.error("ERROR: MONDAY_API_KEY no configurada en las variables de entorno.");
        return res.status(500).json({ error: "Falta MONDAY_API_KEY" });
    }

    const fetchMonday = createMondayClient(token);

    try {
        // 3. Consultar la Orden de Fabricación y desglosar cada Submódulo con sus materiales
        console.log(`[Lista Almacén]: Extrayendo submódulos y materiales de la OF ${pulseId}...`);
        const almacenData = await getListaAlmacenData({ fetchMonday, pulseId });

        // 4. Generar el PDF de Lista de Almacén por Submódulo
        console.log(`[Lista Almacén]: Generando PDF para ${almacenData.submodulos.length} submódulos...`);
        const pdfBytes = await generateListaAlmacenPdf({
            orden: almacenData.orden,
            submodulos: almacenData.submodulos
        });

        // 5. Subir el PDF a Monday en la columna file_mm8zwsx3 con el Folio exacto de la Orden de Fabricación
        const safeFolio = (almacenData.orden.folio || `OF_${pulseId}`).replace(/[^a-zA-Z0-9_-]/g, '_');
        const fileName = `LISTA_ALMACEN_${safeFolio}.pdf`;

        console.log(`[Lista Almacén]: Subiendo ${fileName} (${pdfBytes.length} bytes) a columna ${COLUMN_FILE_ALMACEN}...`);
        const uploadRes = await uploadPdfToMonday(pulseId, token, pdfBytes, fileName, COLUMN_FILE_ALMACEN);
        const pdfSubido = Boolean(uploadRes && !uploadRes.errors);
        console.log(`[Lista Almacén]: Resultado de subida: ${pdfSubido ? 'EXITOSO' : 'FALLIDO'}`);

        return res.status(200).json({
            success: true,
            orden: almacenData.orden.folio,
            submodulosProcesados: almacenData.submodulos.length,
            pdfBytes: pdfBytes.length,
            pdfSubido,
            uploadRes
        });

    } catch (error) {
        console.error("---> [Error Crítico Lista Almacén]:", error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

