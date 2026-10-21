// api/index.js
// Router principal para la raíz del proyecto en Vercel
import webhookComprasHandler from './webhook.js';
import generarBomHandler from './generar-bom.js';
import { normalizeStr } from '../services/mondayClient.js';

export default async function handler(req, res) {
    // 1. Handshake de Monday (Challenge)
    if (req.body?.challenge) return res.status(200).json({ challenge: req.body.challenge });
    if (req.query?.challenge) return res.status(200).json({ challenge: req.query.challenge });

    const { event } = req.body || {};
    const colId = event?.columnId || "";
    const colTitle = normalizeStr(event?.columnTitle || "");

    // Parsear event.value de forma segura (Monday suele enviarlo como string JSON)
    let valObj = event?.value;
    if (typeof valObj === 'string') {
        try { valObj = JSON.parse(valObj); } catch {}
    }
    const statusText = normalizeStr(
        valObj?.label?.text || 
        valObj?.label?.name || 
        event?.label?.text || 
        (typeof event?.value === 'string' && !event?.value.startsWith('{') ? event.value : "")
    );

    console.log(`[Router]: POST recibido colId="${colId}", colTitle="${colTitle}", statusText="${statusText}"`);

    // Si el evento es un cambio de columna de archivo (ej. borraron o subieron un PDF), ignorar de inmediato
    if (colId.startsWith("file_") || event?.columnType === "file") {
        console.log(`[Router]: Cambio en columna de archivo "${colId}", ignorado.`);
        return res.status(200).json({ message: "Ignorado: evento de columna de archivo" });
    }

    // 2. Si el evento corresponde a "GENERAR LISTA" (Lista de Compras)
    if (
        colId === 'color_mm8bdx4x' || 
        colTitle.includes("lista") || 
        statusText.includes("lista") || 
        req.query?.tipo === 'compras'
    ) {
        console.log("[Router]: Petición detectada para LISTA DE COMPRAS (GENERAR LISTA).");
        return await webhookComprasHandler(req, res);
    }

    // 3. Si el evento corresponde a "GENERAR OF" (BOM de Fabricación para taller)
    if (
        colTitle.includes("of") || 
        colTitle.includes("fabricacion") || 
        statusText.includes("of") || 
        statusText.includes("generar of") || 
        req.query?.tipo === 'bom' ||
        (event?.pulseId && colId && colId !== 'color_mm8bdx4x')
    ) {
        console.log("[Router]: Petición detectada para BOM DE FABRICACIÓN (GENERAR OF).");
        return await generarBomHandler(req, res);
    }

    // 4. Si no coincide con ninguno, responder OK sin ejecutar nada
    console.log(`[Router]: Evento ignorado (no coincide con GENERAR OF ni GENERAR LISTA).`);
    return res.status(200).json({
        message: "Ignorado: no coincide con eventos configurados",
        service: "Transtools Monday Automation"
    });
}
