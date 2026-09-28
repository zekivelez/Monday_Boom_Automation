export default async function handler(req, res) {
    // 1. Aceptar solo peticiones POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // 2. Validación de seguridad (Challenge) de Monday.com
    if (req.body && req.body.challenge) {
        return res.status(200).send({ challenge: req.body.challenge });
    }

    // 3. Extraer el evento del Webhook
    const { event } = req.body;
    if (!event || event.type !== 'update_column_value') {
        return res.status(200).json({ message: 'Evento ignorado (no es un cambio de estado)' });
    }

    const pulseId = event.pulseId; // El ID de la fila en PRUEBAS API
    const token = process.env.MONDAY_API_KEY;

    if (!token) {
        console.error("Falta la variable de entorno MONDAY_API_KEY");
        return res.status(500).json({ error: 'Configuración del servidor incompleta' });
    }

    // Helper para hacer consultas a Monday
    const fetchMonday = async (query) => {
        const response = await fetch("https://api.monday.com/v2", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                'API-Version': '2023-10'
            },
            body: JSON.stringify({ query })
        });
        return response.json();
    };

    try {
        // 4. Leer la "Cantidad a Fabricar" del tablero PRUEBAS API
        const queryGenerador = `query {
      items (ids: [${pulseId}]) {
        column_values (ids: ["numeric_mm7m4t8r"]) {
          value
        }
      }
    }`;
        const resGenerador = await fetchMonday(queryGenerador);
        const rawValue = resGenerador.data?.items?.[0]?.column_values?.[0]?.value;
        const cantidadEquipos = rawValue ? Number(JSON.parse(rawValue)) : 1;

        // LOG 1: Verificar cuántos equipos vamos a armar
        console.log(`---> Cantidad a fabricar detectada: ${cantidadEquipos}`);

        // 5. Leer los materiales del BOM MODULAR (ID: 18432584292, Grupo: topics)
        const queryBOM = `query {
      boards(ids: [18432584292]) {
        groups(ids: ["topics"]) {
          items_page(limit: 500) {
            items {
              name
              column_values(ids: ["lookup_mm7h5phh", "lookup_mm7gfk5t", "lookup_mm7g5ww3", "lookup_mm7g98np", "numeric_mm7hhd25"]) {
                id
                text
              }
            }
          }
        }
      }
    }`;
        const resBOM = await fetchMonday(queryBOM);
        const itemsBOM = resBOM.data?.boards?.[0]?.groups?.[0]?.items_page?.items || [];

        // LOG 2: Verificar cuántos extrajo de la tabla original
        console.log(`---> Extraídos del BOM Modular: ${itemsBOM.length} artículos`);

        // 6. El Núcleo: Consolidación y Multiplicación
        let consolidado = {};

        itemsBOM.forEach(item => {
            const cols = item.column_values || [];
            const getVal = (id) => cols.find(c => c.id === id)?.text || "";

            const sku = getVal("lookup_mm7h5phh") || item.name;
            const descripcion = getVal("lookup_mm7gfk5t");
            const familia = getVal("lookup_mm7g5ww3");
            const unidad = getVal("lookup_mm7g98np");
            const reqStr = getVal("numeric_mm7hhd25");

            const cantidadRequerida = reqStr ? parseFloat(reqStr) : 0;
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

        // LOG 3: Verificar cuántos quedaron después de multiplicar y agrupar
        console.log(`---> Artículos listos para inyectar en LISTAS: ${arrayConsolidado.length}`);

        // 7. Escritura Rápida en Vercel
        const mutaciones = arrayConsolidado.map(item => {
            // Protecciones por si algún campo en Monday estaba vacío
            const safeDesc = (item.descripcion || "").replace(/"/g, '\\"');
            const safeFamilia = (item.familia || "").replace(/"/g, '\\"');
            const safeUnidad = (item.unidad || "").replace(/"/g, '\\"');

            const mutation = `mutation {
        create_item (
          board_id: 18433034563, 
          group_id: "topics", 
          item_name: "${item.sku}", 
          column_values: "{\\"long_text_mm7mrdaj\\": {\\"text\\": \\"${safeDesc}\\"}, \\"numeric_mm7makx4\\": ${item.cantidadTotal}, \\"text_mm7mg8bn\\": \\"${safeUnidad}\\", \\"dropdown_mm7mbz7a\\": {\\"labels\\": [\\"${safeFamilia}\\"]}}"
        ) { id }
      }`;
            return fetchMonday(mutation);
        });

        await Promise.all(mutaciones);

        console.log(`---> ¡Éxito! Inyectados ${mutaciones.length} artículos en Monday.`);

        // 8. Responder a Monday que todo finalizó con éxito
        return res.status(200).json({ success: true, procesados: arrayConsolidado.length });

    } catch (error) {
        console.error("---> Error crítico procesando BOM:", error);
        return res.status(500).json({ error: error.message });
    }
}