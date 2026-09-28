export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Verificación inicial de handshake de Monday (Challenge)
    if (req.body && req.body.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    const { event } = req.body || {};
    if (!event) {
        return res.status(200).json({ message: 'Sin evento en el body' });
    }

    console.log(`[Webhook Evento Recibido]: tipo="${event.type}", pulseId="${event.pulseId || event.itemId}"`);

    // Obtenemos el pulseId (ID del ítem disparador en PRUEBAS API)
    const pulseId = event.pulseId || event.itemId;
    if (!pulseId) {
        console.warn("Evento recibido sin pulseId:", JSON.stringify(event));
        return res.status(200).json({ message: 'Ignorado: sin pulseId' });
    }

    const token = process.env.MONDAY_API_KEY;
    if (!token) {
        console.error("ERROR: MONDAY_API_KEY no configurada en las variables de entorno.");
        return res.status(500).json({ error: "Falta MONDAY_API_KEY" });
    }

    const fetchMonday = async (query, variables = {}) => {
        const response = await fetch("https://api.monday.com/v2", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                'API-Version': '2023-10'
            },
            body: JSON.stringify({ query, variables })
        });
        const result = await response.json();
        if (result.errors) {
            console.error("Error devuelto por Monday API:", JSON.stringify(result.errors));
        }
        return result;
    };

    try {
        // 1. Obtener la cantidad a fabricar del ítem en PRUEBAS API (18433030481)
        const queryGenerador = `query ($itemId: [ID!]) {
            items (ids: $itemId) {
                name
                column_values (ids: ["numeric_mm7m4t8r"]) {
                    id
                    text
                    value
                }
            }
        }`;
        const resGenerador = await fetchMonday(queryGenerador, { itemId: [pulseId] });
        const colCantidad = resGenerador.data?.items?.[0]?.column_values?.[0];
        
        let cantidadEquipos = 1;
        if (colCantidad?.text && !isNaN(Number(colCantidad.text))) {
            cantidadEquipos = Number(colCantidad.text);
        } else if (colCantidad?.value) {
            try {
                const parsed = Number(JSON.parse(colCantidad.value));
                if (!isNaN(parsed) && parsed > 0) cantidadEquipos = parsed;
            } catch {
                const parsed = Number(colCantidad.value);
                if (!isNaN(parsed) && parsed > 0) cantidadEquipos = parsed;
            }
        }
        console.log(`[Item Disparador ${pulseId}]: Cantidad a fabricar = ${cantidadEquipos}`);

        // 2. Extraer del BOM MODULAR (18432584292)
        // Usamos "... on MirrorValue" porque display_value solo existe en columnas Mirror
        const queryBOM = `query {
            boards(ids: [18432584292]) {
                items_page(limit: 500) {
                    items {
                        id
                        name
                        column_values(ids: [
                            "lookup_mm7h5phh",
                            "lookup_mm7gfk5t",
                            "lookup_mm7g5ww3",
                            "lookup_mm7g98np",
                            "numeric_mm7hhd25"
                        ]) {
                            id
                            text
                            value
                            ... on MirrorValue {
                                display_value
                            }
                        }
                    }
                }
            }
        }`;

        const resBOM = await fetchMonday(queryBOM);
        const itemsBOM = resBOM.data?.boards?.[0]?.items_page?.items || [];
        console.log(`[BOM MODULAR]: Leídas ${itemsBOM.length} filas del BOM`);

        let consolidado = {};

        itemsBOM.forEach(item => {
            const cols = item.column_values || [];

            const getVal = (id) => {
                const col = cols.find(c => c.id === id);
                if (!col) return "";
                if (col.display_value) return String(col.display_value).trim();
                if (col.text) return String(col.text).trim();
                if (col.value) {
                    try {
                        const v = JSON.parse(col.value);
                        return typeof v === 'object' ? '' : String(v).trim();
                    } catch {
                        return String(col.value).trim();
                    }
                }
                return "";
            };

            const sku = getVal("lookup_mm7h5phh") || item.name;
            const descripcion = getVal("lookup_mm7gfk5t");
            const familia = getVal("lookup_mm7g5ww3");
            const unidad = getVal("lookup_mm7g98np");
            const reqStr = getVal("numeric_mm7hhd25");

            const cantidadRequerida = reqStr ? parseFloat(reqStr.replace(/,/g, "")) : 0;
            const totalFila = cantidadRequerida * cantidadEquipos;

            if (sku && totalFila > 0) {
                if (consolidado[sku]) {
                    consolidado[sku].cantidadTotal += totalFila;
                } else {
                    consolidado[sku] = { sku, descripcion, familia, unidad, cantidadTotal: totalFila };
                }
            }
        });

        const arrayConsolidado = Object.values(consolidado);
        console.log(`[Consolidación]: ${arrayConsolidado.length} ítems únicos a crear en LISTAS`);

        // 3. Crear ítems en LISTAS (18433034563) utilizando Variables GraphQL
        const mutationQuery = `mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
            create_item (
                board_id: $boardId, 
                group_id: $groupId,
                item_name: $itemName, 
                column_values: $columnValues
            ) { id }
        }`;

        // Inyectamos en lotes de 5 para respetar los límites de concurrencia de Monday
        const batchSize = 5;
        let resultados = [];

        for (let i = 0; i < arrayConsolidado.length; i += batchSize) {
            const batch = arrayConsolidado.slice(i, i + batchSize);
            const batchPromises = batch.map(item => {
                let colVals = {
                    "numeric_mm7makx4": Number(item.cantidadTotal.toFixed(4)).toString()
                };

                if (item.descripcion) colVals["long_text_mm7mrdaj"] = { text: item.descripcion };
                if (item.unidad) colVals["text_mm7mg8bn"] = item.unidad;
                if (item.familia) colVals["dropdown_mm7mbz7a"] = { labels: [item.familia] };
                if (pulseId) colVals["board_relation_mm7me5ha"] = { item_ids: [Number(pulseId)] };

                return fetchMonday(mutationQuery, {
                    boardId: "18433034563",
                    groupId: "topics",
                    itemName: String(item.sku),
                    columnValues: JSON.stringify(colVals)
                });
            });

            const batchResults = await Promise.all(batchPromises);
            resultados = resultados.concat(batchResults);
        }

        const errores = resultados.filter(r => r.errors);
        if (errores.length > 0) {
            console.error(`[Inyección LISTAS]: ${errores.length} mutaciones tuvieron errores.`);
        }

        return res.status(200).json({
            success: true,
            cantidadEquipos,
            procesados: arrayConsolidado.length,
            errores: errores.length
        });

    } catch (error) {
        console.error("---> Error crítico en handler:", error);
        return res.status(500).json({ error: error.message });
    }
}