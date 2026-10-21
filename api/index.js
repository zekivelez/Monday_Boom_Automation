// api/index.js
// Handler para la raíz del proyecto en Vercel
export default function handler(req, res) {
    return res.status(200).json({
        service: "Transtools Monday Automation",
        status: "online",
        endpoints: {
            compras: "/api/webhook o /api/generar-compras",
            bomFabricacion: "/api/generar-bom"
        }
    });
}
