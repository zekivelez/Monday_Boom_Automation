// api/index.js
// Handler para la raíz del proyecto en Vercel
import webhookComprasHandler from './webhook.js';

export default async function handler(req, res) {
    // Si viene una petición POST (webhook de Monday), challenge o pulseId en query, procesar directamente el webhook
    if (req.method === 'POST' || req.body?.challenge || req.query?.challenge || req.body?.event || req.query?.pulseId) {
        return await webhookComprasHandler(req, res);
    }

    return res.status(200).json({
        service: "Transtools Monday Automation",
        status: "online",
        endpoints: {
            compras: "/api/webhook o /api/generar-compras",
            bomFabricacion: "/api/generar-bom"
        }
    });
}
