export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (req.body && req.body.challenge) return res.status(200).send({ challenge: req.body.challenge });

    const { event } = req.body;
    if (!event || event.type !== 'update_column_value') return res.status(200).json({ message: 'Ignorado' });

    const pulseId = event.pulseId;
    const token = process.env.MONDAY_API_KEY;

    const fetchMonday = async (query) => {
        const response = await fetch("https://api.monday.com/v2", {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': token, 'API-Version': '2023-10' },
            body: JSON.stringify({ query })
        });
        return response.json();
    };

    try {
        // 1. Obtener la cantidad a fabricar
        const queryGenerador = `query { items (ids: [${pulseId}]) { column_values (ids: ["numeric_mm7m4t8r"]) { value } } }`;
        const resGenerador = await fetchMonday(queryGenerador);
        const rawValue = resGenerador.data?.items?.[0]?.column_values?.[0]?.value;
        const cantidadEquipos = rawValue ? Number(JSON.parse(rawValue)) : 1;

        // 2. Extraer del BOM (Agregamos display_value para forzar la lectura de las columnas Mirror)
        const queryBOM = `query {
      boards(ids: [18432584292]) {
        items_page(limit: 500) {
          items {
            name
            column_values(ids: ["lookup_mm7h5phh", "lookup_mm7gfk5t", "lookup_mm7g5ww3", "lookup_mm7g98np", "numeric_mm7hhd25"]) {
              id
              text
              display_value
            }
          }
        }
      }
    }`;
        const resBOM = await fetchMonday(queryBOM);
        const itemsBOM = resBOM.data?.boards?.[0]?.items_page?.items || [];

        let consolidado = {};

        itemsBOM.forEach(item => {
            const cols = item.column_values || [];
            // Mejoramos el extractor para columnas Mirror
            const getVal = (id) => {
                const col = cols.find(c => c.id === id);
                return col ? (col.text || col.display_value || "") : "";
            };

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

        // 3. Constructor dinámico de columnas (Evita errores si un campo está vacío)
        const mutaciones = arrayConsolidado.map(item => {
            let colVals = {
                "numeric_mm7makx4": item.cantidadTotal.toString()
            };

            // Solo agregamos los campos si realmente tienen información
            if (item.descripcion) colVals["long_text_mm7mrdaj"] = { text: item.descripcion };
            if (item.unidad) colVals["text_mm7mg8bn"] = item.unidad;
            if (item.familia) colVals["dropdown_mm7mbz7a"] = { labels: [item.familia] };

            // Convertimos el objeto a string y escapamos las comillas para GraphQL
            const columnValuesStr = JSON.stringify(colVals).replace(/"/g, '\\"');

            const mutation = `mutation {
        create_item (
          board_id: 18433034563, 
          group_id: "topics",
          item_name: "${item.sku}", 
          column_values: "${columnValuesStr}"
        ) { id }
      }`;
            return fetchMonday(mutation);
        });

        const resultados = await Promise.all(mutaciones);

        // RAYOS X PARA MONDAY: Imprimir si Monday rechaza alguna fila
        resultados.forEach((res, index) => {
            if (res.errors) {
                console.error(`[Error de Inyección - Fila ${index}]:`, JSON.stringify(res.errors));
            }
        });

        return res.status(200).json({ success: true, procesados: arrayConsolidado.length });

    } catch (error) {
        console.error("---> Error crítico:", error);
        return res.status(500).json({ error: error.message });
    }
}