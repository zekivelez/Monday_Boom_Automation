import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
        // 1. Obtener la orden de PRUEBAS API (18433030481)
        const queryGenerador = `query ($itemId: [ID!]) {
            items (ids: $itemId) {
                id
                name
                column_values (ids: ["numeric_mm7m4t8r", "dropdown_mm7mhnmc"]) {
                    id
                    text
                    value
                }
            }
        }`;
        const resGenerador = await fetchMonday(queryGenerador, { itemId: [pulseId] });
        const generadorItem = resGenerador.data?.items?.[0];
        const orderName = generadorItem?.name || `Orden #${pulseId}`;
        const colCantidad = generadorItem?.column_values?.find(c => c.id === "numeric_mm7m4t8r");
        const colProducto = generadorItem?.column_values?.find(c => c.id === "dropdown_mm7mhnmc");
        
        const productoSeleccionado = colProducto?.text || "";

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
        console.log(`[Item Disparador ${pulseId}]: Orden="${orderName}", Producto="${productoSeleccionado}", Cantidad=${cantidadEquipos}`);

        // 2. Extraer del BOM MODULAR (18432584292) con soporte profundo para MirrorValue y BoardRelationValue
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
                            "numeric_mm7hhd25",
                            "board_relation_mm7gch9y",
                            "dropdown_mm7h5xq1"
                        ]) {
                            id
                            text
                            value
                            ... on MirrorValue {
                                display_value
                                mirrored_items {
                                    linked_item {
                                        id
                                        name
                                    }
                                    mirrored_value {
                                        ... on TextValue { text }
                                        ... on LongTextValue { text }
                                        ... on NumbersValue { number text }
                                        ... on StatusValue { label }
                                        ... on DropdownValue { values { label } }
                                    }
                                }
                            }
                            ... on BoardRelationValue {
                                display_value
                                linked_items {
                                    id
                                    name
                                }
                            }
                        }
                    }
                }
            }
        }`;

        const resBOM = await fetchMonday(queryBOM);
        const itemsBOM = resBOM.data?.boards?.[0]?.items_page?.items || [];
        console.log(`[BOM MODULAR]: Leídas ${itemsBOM.length} filas del BOM`);

        // Extractor inteligente que maneja tanto display_value como mirrored_items y board_relation
        const extractVal = (col) => {
            if (!col) return "";

            // 1. Extraer desde mirrored_items si es Mirror
            if (col.mirrored_items && col.mirrored_items.length > 0) {
                const vals = col.mirrored_items.map(m => {
                    const mv = m.mirrored_value;
                    if (!mv) return m.linked_item?.name || "";
                    if (mv.text !== undefined && mv.text !== null && mv.text !== "") return String(mv.text);
                    if (mv.label !== undefined && mv.label !== null && mv.label !== "") return String(mv.label);
                    if (mv.number !== undefined && mv.number !== null) return String(mv.number);
                    if (mv.values && Array.isArray(mv.values)) return mv.values.map(v => v.label).join(", ");
                    return m.linked_item?.name || "";
                }).filter(Boolean);
                if (vals.length > 0) return vals.join(", ").trim();
            }

            // 2. Extraer desde linked_items si es BoardRelation
            if (col.linked_items && col.linked_items.length > 0) {
                const names = col.linked_items.map(li => li.name).filter(Boolean);
                if (names.length > 0) return names.join(", ").trim();
            }

            // 3. display_value
            if (col.display_value && String(col.display_value).trim() !== "") {
                return String(col.display_value).trim();
            }

            // 4. text
            if (col.text && String(col.text).trim() !== "") {
                return String(col.text).trim();
            }

            // 5. value (JSON string)
            if (col.value) {
                try {
                    const v = JSON.parse(col.value);
                    if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
                    if (v && typeof v === 'object') {
                        if (v.text) return String(v.text).trim();
                        if (v.label) return String(v.label).trim();
                    }
                } catch {
                    return String(col.value).trim();
                }
            }

            return "";
        };

        let consolidado = {};

        itemsBOM.forEach(item => {
            const cols = item.column_values || [];

            // Si hay un producto seleccionado en la orden, filtrar si la fila especifica otro producto
            const itemProducto = extractVal(cols.find(c => c.id === "dropdown_mm7h5xq1"));
            if (productoSeleccionado && itemProducto && itemProducto.toLowerCase() !== productoSeleccionado.toLowerCase()) {
                return;
            }

            // Nombre del artículo vinculado en la columna ARTICULOS
            const articuloRelacionado = extractVal(cols.find(c => c.id === "board_relation_mm7gch9y"));
            
            // SKU o Código del artículo: Espejo ITEM o Nombre en ARTICULOS
            const itemMirror = extractVal(cols.find(c => c.id === "lookup_mm7h5phh"));
            const sku = itemMirror || articuloRelacionado || item.name;

            const descripcion = extractVal(cols.find(c => c.id === "lookup_mm7gfk5t"));
            const familia = extractVal(cols.find(c => c.id === "lookup_mm7g5ww3"));
            const unidad = extractVal(cols.find(c => c.id === "lookup_mm7g98np"));

            const reqStr = extractVal(cols.find(c => c.id === "numeric_mm7hhd25"));
            const cantidadRequerida = reqStr ? parseFloat(reqStr.replace(/,/g, "")) : 0;
            const totalFila = cantidadRequerida * cantidadEquipos;

            if (sku && totalFila > 0) {
                if (consolidado[sku]) {
                    consolidado[sku].cantidadTotal += totalFila;
                    if (!consolidado[sku].descripcion && descripcion) consolidado[sku].descripcion = descripcion;
                    if (!consolidado[sku].familia && familia) consolidado[sku].familia = familia;
                    if (!consolidado[sku].unidad && unidad) consolidado[sku].unidad = unidad;
                } else {
                    consolidado[sku] = {
                        sku,
                        descripcion,
                        familia,
                        unidad,
                        cantidadRequerida,
                        cantidadTotal: totalFila
                    };
                }
            }
        });

        const arrayConsolidado = Object.values(consolidado);
        console.log(`[Consolidación]: ${arrayConsolidado.length} artículos únicos calculados para LISTAS`);

        // 3. Crear artículos en LISTAS (18433034563)
        const mutationQuery = `mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
            create_item (
                board_id: $boardId, 
                group_id: $groupId,
                item_name: $itemName, 
                column_values: $columnValues
            ) { id }
        }`;

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

        // 4. Generar Documento PDF de la Lista de Materiales
        let pdfSubido = false;
        try {
            console.log("[PDF]: Iniciando generación del documento PDF...");
            const pdfBytes = await generateBOMPdf({
                orderName,
                producto: productoSeleccionado,
                cantidadEquipos,
                items: arrayConsolidado
            });

            console.log(`[PDF]: Generado con éxito (${pdfBytes.length} bytes). Subiendo a Monday...`);
            const uploadRes = await uploadPdfToMonday(pulseId, token, pdfBytes, `BOM_${orderName.replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`);
            if (uploadRes && !uploadRes.errors) {
                pdfSubido = true;
                console.log("[PDF]: Documento PDF subido exitosamente a la columna file_mm7m2b35");
            }
        } catch (pdfError) {
            console.error("[PDF Error]: No se pudo generar o subir el PDF:", pdfError);
        }

        return res.status(200).json({
            success: true,
            orden: orderName,
            cantidadEquipos,
            procesados: arrayConsolidado.length,
            errores: errores.length,
            pdfGenerado: pdfSubido
        });

    } catch (error) {
        console.error("---> Error crítico en handler:", error);
        return res.status(500).json({ error: error.message });
    }
}

// Función auxiliar para subir el archivo a la columna de Monday (file_mm7m2b35)
async function uploadPdfToMonday(itemId, token, pdfBytes, fileName) {
    const form = new FormData();
    const mutation = `mutation ($file: File!) {
        add_file_to_column (
            item_id: ${itemId}, 
            column_id: "file_mm7m2b35", 
            file: $file
        ) {
            id
        }
    }`;

    form.append("query", mutation);
    form.append("map", JSON.stringify({ "file": "variables.file" }));
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    form.append("file", blob, fileName);

    const response = await fetch("https://api.monday.com/v2/file", {
        method: "POST",
        headers: {
            "Authorization": token
        },
        body: form
    });

    const result = await response.json();
    if (result.errors) {
        console.error("[Error Monday /v2/file]:", JSON.stringify(result.errors));
    }
    return result;
}

// Función para diseñar y generar el PDF con pdf-lib
async function generateBOMPdf({ orderName, producto, cantidadEquipos, items }) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]); // Tamaño Carta estándar
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { width, height } = page.getSize();
    let y = height - 40;

    const primaryColor = rgb(0.1, 0.22, 0.44); // Azul Transtools
    const textColor = rgb(0.15, 0.15, 0.15);
    const headerBg = rgb(0.92, 0.94, 0.98);
    const borderColor = rgb(0.82, 0.85, 0.9);

    // Encabezado corporativo
    page.drawRectangle({
        x: 35,
        y: y - 8,
        width: width - 70,
        height: 38,
        color: primaryColor,
    });

    page.drawText("TRANSTOOLS - EXPLOSIÓN DE MATERIALES (BOM)", {
        x: 48,
        y: y + 8,
        size: 13,
        font: fontBold,
        color: rgb(1, 1, 1),
    });

    y -= 46;

    // Resumen de la Orden
    page.drawText(`Orden: ${orderName}`, { x: 38, y, size: 9.5, font: fontBold, color: textColor });
    page.drawText(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, { x: width - 160, y, size: 9, font: fontRegular, color: textColor });
    y -= 15;

    if (producto) {
        page.drawText(`Producto: ${producto}`, { x: 38, y, size: 9, font: fontRegular, color: textColor });
    }
    page.drawText(`Cantidad a Fabricar: ${cantidadEquipos}`, { x: width - 210, y, size: 9.5, font: fontBold, color: primaryColor });
    y -= 25;

    // Definición de columnas
    // Ancho útil = width - 70 = 542
    const cols = [
        { label: "ARTÍCULO / SKU", x: 35, width: 110 },
        { label: "DESCRIPCIÓN TÉCNICA", x: 145, width: 185 },
        { label: "FAMILIA", x: 330, width: 85 },
        { label: "U.M.", x: 415, width: 45 },
        { label: "CANT. TOTAL", x: 460, width: 82, align: 'right' },
    ];

    const drawTableHeader = (curY) => {
        page.drawRectangle({
            x: 35,
            y: curY - 5,
            width: width - 70,
            height: 20,
            color: headerBg,
            borderColor: borderColor,
            borderWidth: 0.5,
        });

        cols.forEach(c => {
            const textWidth = fontBold.widthOfTextAtSize(c.label, 8);
            const posX = c.align === 'right' ? c.x + c.width - textWidth - 5 : c.x + 5;
            page.drawText(c.label, {
                x: posX,
                y: curY,
                size: 8,
                font: fontBold,
                color: primaryColor,
            });
        });
    };

    drawTableHeader(y);
    y -= 20;

    const truncate = (text, maxWidth, font, size) => {
        let str = String(text || '');
        if (font.widthOfTextAtSize(str, size) <= maxWidth) return str;
        while (str.length > 0 && font.widthOfTextAtSize(str + '...', size) > maxWidth) {
            str = str.slice(0, -1);
        }
        return str + '...';
    };

    items.forEach((item, index) => {
        if (y < 55) {
            page = pdfDoc.addPage([612, 792]);
            y = 745;
            drawTableHeader(y);
            y -= 20;
        }

        if (index % 2 === 1) {
            page.drawRectangle({
                x: 35,
                y: y - 4,
                width: width - 70,
                height: 16,
                color: rgb(0.98, 0.98, 0.99),
            });
        }

        page.drawLine({
            start: { x: 35, y: y - 4 },
            end: { x: width - 35, y: y - 4 },
            color: borderColor,
            thickness: 0.5,
        });

        const skuText = truncate(item.sku, cols[0].width - 8, fontBold, 8);
        const descText = truncate(item.descripcion, cols[1].width - 8, fontRegular, 7.5);
        const famText = truncate(item.familia, cols[2].width - 8, fontRegular, 7.5);
        const umText = truncate(item.unidad, cols[3].width - 8, fontRegular, 8);
        const qtyText = item.cantidadTotal.toLocaleString('es-MX', { maximumFractionDigits: 4 });

        page.drawText(skuText, { x: cols[0].x + 5, y, size: 8, font: fontBold, color: textColor });
        page.drawText(descText, { x: cols[1].x + 5, y, size: 7.5, font: fontRegular, color: textColor });
        page.drawText(famText, { x: cols[2].x + 5, y, size: 7.5, font: fontRegular, color: textColor });
        page.drawText(umText, { x: cols[3].x + 5, y, size: 8, font: fontRegular, color: textColor });

        const qtyWidth = fontBold.widthOfTextAtSize(qtyText, 8);
        page.drawText(qtyText, { x: cols[4].x + cols[4].width - qtyWidth - 5, y, size: 8, font: fontBold, color: primaryColor });

        y -= 16;
    });

    if (y < 45) {
        page = pdfDoc.addPage([612, 792]);
        y = 745;
    }
    y -= 10;
    page.drawText(`Total de artículos listados: ${items.length}`, {
        x: 38,
        y,
        size: 9,
        font: fontBold,
        color: primaryColor,
    });

    return await pdfDoc.save();
}