import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 1. Verificación de handshake de Monday (Challenge)
    if (req.body && req.body.challenge) {
        return res.status(200).json({ challenge: req.body.challenge });
    }

    const { event } = req.body || {};
    if (!event) {
        return res.status(200).json({ message: 'Sin evento en el body' });
    }

    const pulseId = event.pulseId || event.itemId;
    console.log(`[Webhook Evento Recibido]: tipo="${event.type}", pulseId="${pulseId}"`);

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

    // Funciones auxiliares de extracción de datos de columnas
    const extractColText = (col) => {
        if (!col) return "";
        if (col.display_value && String(col.display_value).trim() !== "") {
            return String(col.display_value).trim();
        }
        if (col.text && String(col.text).trim() !== "") {
            return String(col.text).trim();
        }
        if (col.linked_items && col.linked_items.length > 0) {
            return col.linked_items.map(li => li.name).filter(Boolean).join(", ");
        }
        if (col.value) {
            try {
                const v = JSON.parse(col.value);
                if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
                if (v && typeof v === 'object') {
                    if (v.text) return String(v.text).trim();
                    if (v.label) return String(v.label).trim();
                    if (Array.isArray(v.labels)) return v.labels.join(", ").trim();
                    if (v.item_ids && Array.isArray(v.item_ids)) return v.item_ids.join(", ");
                }
            } catch {}
        }
        return "";
    };

    const extractColNumber = (col, defaultVal = 0) => {
        if (!col) return defaultVal;
        const txt = extractColText(col);
        if (!txt) return defaultVal;
        const clean = txt.replace(/[^0-9.-]/g, "");
        const num = parseFloat(clean);
        return isNaN(num) ? defaultVal : num;
    };

    const cleanStr = (s) => (s || "").toLowerCase().trim();

    try {
        // =========================================================================
        // PASO 1: Leer la orden detonadora en PRUEBA API (18433030481)
        // =========================================================================
        console.log(`[Paso 1]: Consultando PRUEBA API para el ítem ${pulseId}...`);
        const queryGenerador = `query ($itemId: [ID!]) {
            items (ids: $itemId) {
                id
                name
                column_values {
                    id
                    text
                    value
                    type
                }
            }
        }`;

        const resGenerador = await fetchMonday(queryGenerador, { itemId: [pulseId] });
        const generadorItem = resGenerador.data?.items?.[0];
        if (!generadorItem) {
            throw new Error(`No se encontró el ítem con id ${pulseId} en PRUEBA API`);
        }

        const orderName = generadorItem.name || `Orden #${pulseId}`;
        const genCols = generadorItem.column_values || [];
        const colCantidad = genCols.find(c => c.id === "numeric_mm7m4t8r");
        const colProducto = genCols.find(c => c.id === "dropdown_mm7mhnmc");
        const colConfiguracion = genCols.find(c => c.id === "dropdown_mm7mqdtg");

        const productoSeleccionado = extractColText(colProducto);
        const configuracionSeleccionada = extractColText(colConfiguracion);
        let cantidadEquipos = extractColNumber(colCantidad, 1);
        if (cantidadEquipos <= 0) cantidadEquipos = 1;

        console.log(`[PRUEBA API]: Orden="${orderName}", Producto="${productoSeleccionado}", Config="${configuracionSeleccionada}", Cantidad=${cantidadEquipos}`);

        // =========================================================================
        // PASO 2: Consultar BOM MODULAR (18432584292) y sus subelementos
        // =========================================================================
        console.log(`[Paso 2]: Consultando BOM MODULAR (18432584292)...`);
        const queryBOM = `query {
            boards(ids: [18432584292]) {
                items_page(limit: 100) {
                    items {
                        id
                        name
                        column_values {
                            id
                            text
                            value
                            type
                        }
                        subitems {
                            id
                            name
                            column_values {
                                id
                                text
                                value
                                type
                            }
                        }
                    }
                }
            }
        }`;

        const resBOM = await fetchMonday(queryBOM);
        const itemsBOM = resBOM.data?.boards?.[0]?.items_page?.items || [];
        console.log(`[BOM MODULAR]: ${itemsBOM.length} productos/filas encontradas`);

        // Encontrar la fila del producto en BOM MODULAR
        const targetProd = cleanStr(productoSeleccionado);
        const targetConf = cleanStr(configuracionSeleccionada);

        let bomItem = itemsBOM.find(item => {
            const iName = cleanStr(item.name);
            const iConf = cleanStr(extractColText(item.column_values?.find(c => c.id === "dropdown_mm7ht1rb")));
            const prodMatch = !targetProd || iName.includes(targetProd) || targetProd.includes(iName);
            const confMatch = !targetConf || iConf.includes(targetConf) || targetConf.includes(iConf);
            return prodMatch && confMatch;
        });

        if (!bomItem && targetProd) {
            bomItem = itemsBOM.find(item => cleanStr(item.name).includes(targetProd) || targetProd.includes(cleanStr(item.name)));
        }
        if (!bomItem && itemsBOM.length > 0) {
            bomItem = itemsBOM[0];
            console.warn(`[BOM MODULAR]: No hubo coincidencia exacta para "${productoSeleccionado}". Usando ítem por defecto: "${bomItem.name}"`);
        }

        if (!bomItem) {
            throw new Error(`No se encontró ninguna configuración en BOM MODULAR para el producto ${productoSeleccionado}`);
        }

        console.log(`[BOM MODULAR]: Ítem seleccionado -> "${bomItem.name}" (ID: ${bomItem.id})`);

        // Extraer Módulos desde subelementos de BOM MODULAR
        let modulosRequeridos = [];
        if (bomItem.subitems && bomItem.subitems.length > 0) {
            console.log(`[BOM MODULAR]: Encontrados ${bomItem.subitems.length} módulos en subelementos.`);
            modulosRequeridos = bomItem.subitems.map(sub => {
                const subCols = sub.column_values || [];
                const cant = extractColNumber(subCols.find(c => c.id === "numeric_mm7gwjyz" || c.id === "numeric_mm7hhd25" || c.type === "numbers"), 1);
                const codigo = extractColText(subCols.find(c => c.id === "text_mm7q8m7r")) || sub.name;
                return {
                    id: sub.id,
                    name: sub.name,
                    codigo,
                    cantidad: cant > 0 ? cant : 1
                };
            });
        } else {
            // Respaldo: Revisar columnas de sistemas si no tuviera subelementos cargados
            console.log(`[BOM MODULAR]: Sin subelementos directos, revisando columnas de subsistemas...`);
            const systemColIds = [
                "text_mm7q7qmg", "text_mm7q6xes", "text_mm7qrxyp", "text_mm7qfs6e",
                "text_mm7qc3tv", "text_mm7q1ef3", "text_mm7qqrdg", "text_mm7qfrem",
                "text_mm7q4589", "text_mm7qncwp", "text_mm7qxdxh", "text_mm7qqn7",
                "text_mm7qpawg", "text_mm7qm3r3", "text_mm7q1ptq"
            ];
            (bomItem.column_values || []).forEach(col => {
                if (systemColIds.includes(col.id)) {
                    const val = extractColText(col);
                    if (val) {
                        modulosRequeridos.push({
                            id: null,
                            name: val,
                            codigo: val,
                            cantidad: 1
                        });
                    }
                }
            });
        }

        console.log(`[Módulos Requeridos]: ${modulosRequeridos.length} módulos identificados:`, modulosRequeridos.map(m => `${m.name} (x${m.cantidad})`).join(", "));

        // =========================================================================
        // PASO 3: Consultar Tablero MODULOS (18432845727) y sus Subelementos
        // =========================================================================
        console.log(`[Paso 3]: Consultando Tablero MODULOS (18432845727)...`);
        const queryModulos = `query {
            boards(ids: [18432845727]) {
                items_page(limit: 300) {
                    items {
                        id
                        name
                        column_values {
                            id
                            text
                            value
                            type
                            ... on BoardRelationValue {
                                linked_item_ids
                                linked_items { id name }
                            }
                        }
                        subitems {
                            id
                            name
                            column_values {
                                id
                                text
                                value
                                type
                                ... on BoardRelationValue {
                                    linked_item_ids
                                    linked_items { id name }
                                }
                            }
                        }
                    }
                }
            }
        }`;

        const resModulos = await fetchMonday(queryModulos);
        const allModulosItems = resModulos.data?.boards?.[0]?.items_page?.items || [];
        console.log(`[MODULOS]: ${allModulosItems.length} módulos disponibles en el catálogo`);

        // =========================================================================
        // PASO 4: Consultar Tablero SUBMODULOS (18432844380) y sus Subelementos (Materiales)
        // =========================================================================
        console.log(`[Paso 4]: Consultando Tablero SUBMODULOS (18432844380)...`);
        const querySubmodulos = `query {
            boards(ids: [18432844380]) {
                items_page(limit: 500) {
                    items {
                        id
                        name
                        column_values {
                            id
                            text
                            value
                            type
                            ... on MirrorValue {
                                display_value
                            }
                        }
                        subitems {
                            id
                            name
                            column_values {
                                id
                                text
                                value
                                type
                                ... on MirrorValue {
                                    display_value
                                }
                            }
                        }
                    }
                }
            }
        }`;

        const resSubmodulos = await fetchMonday(querySubmodulos);
        const allSubmodulosItems = resSubmodulos.data?.boards?.[0]?.items_page?.items || [];
        console.log(`[SUBMODULOS]: ${allSubmodulosItems.length} submódulos disponibles en el catálogo`);

        // Indexar submódulos por ID y por nombre normalizado para búsqueda ultra rápida
        const submodulosMapById = new Map();
        const submodulosMapByName = new Map();
        allSubmodulosItems.forEach(item => {
            submodulosMapById.set(String(item.id), item);
            submodulosMapByName.set(cleanStr(item.name), item);
            const codigoSub = extractColText(item.column_values?.find(c => c.id === "text_mm7jphz6"));
            if (codigoSub) submodulosMapByName.set(cleanStr(codigoSub), item);
        });

        // =========================================================================
        // PASO 5: Construir Jerarquía: Módulos -> Submódulos -> Materiales / Piezas
        // =========================================================================
        const jerarquia = [];
        const consolidadoMateriales = {};

        for (const reqMod of modulosRequeridos) {
            const cleanModName = cleanStr(reqMod.name);
            const cleanModCod = cleanStr(reqMod.codigo);

            // Localizar el módulo en el tablero MODULOS
            const moduloItem = allModulosItems.find(m => {
                const mName = cleanStr(m.name);
                return mName === cleanModName || mName === cleanModCod || mName.includes(cleanModName) || cleanModName.includes(mName);
            });

            const modObj = {
                nombre: reqMod.name,
                codigo: reqMod.codigo || reqMod.name,
                cantidadModulo: reqMod.cantidad,
                submodulos: []
            };

            if (moduloItem) {
                // Caso A: El módulo tiene SUBELEMENTOS (cada subelemento es un Submódulo)
                if (moduloItem.subitems && moduloItem.subitems.length > 0) {
                    for (const subItem of moduloItem.subitems) {
                        const subCols = subItem.column_values || [];
                        const cantSub = extractColNumber(subCols.find(c => c.id === "numeric_mm7j6c8r" || c.type === "numbers"), 1);

                        // Buscar relación hacia SUBMODULOS o empatar por nombre
                        const relCol = subCols.find(c => c.id === "board_relation_mm7j1vcf" || c.type === "board_relation");
                        const linkedId = relCol?.linked_item_ids?.[0];

                        let matchedSub = linkedId ? submodulosMapById.get(String(linkedId)) : null;
                        if (!matchedSub) {
                            matchedSub = submodulosMapByName.get(cleanStr(subItem.name));
                        }

                        const subObj = procesarSubmodulo(matchedSub, subItem.name, cantSub, reqMod.cantidad, cantidadEquipos, consolidadoMateriales);
                        modObj.submodulos.push(subObj);
                    }
                } 
                // Caso B: El módulo tiene la columna de relación SUBMODULO directamente en sus columnas principales
                else {
                    const relCol = moduloItem.column_values?.find(c => c.id === "board_relation_mm7j1vcf");
                    const cantSub = extractColNumber(moduloItem.column_values?.find(c => c.id === "numeric_mm7j6c8r"), 1);
                    const linkedIds = relCol?.linked_item_ids || [];

                    if (linkedIds.length > 0) {
                        for (const lid of linkedIds) {
                            const matchedSub = submodulosMapById.get(String(lid));
                            const subName = matchedSub?.name || `Submódulo #${lid}`;
                            const subObj = procesarSubmodulo(matchedSub, subName, cantSub, reqMod.cantidad, cantidadEquipos, consolidadoMateriales);
                            modObj.submodulos.push(subObj);
                        }
                    } else if (relCol?.linked_items && relCol.linked_items.length > 0) {
                        for (const li of relCol.linked_items) {
                            const matchedSub = submodulosMapById.get(String(li.id)) || submodulosMapByName.get(cleanStr(li.name));
                            const subObj = procesarSubmodulo(matchedSub, li.name, cantSub, reqMod.cantidad, cantidadEquipos, consolidadoMateriales);
                            modObj.submodulos.push(subObj);
                        }
                    }
                }
            } else {
                console.warn(`[Aviso]: No se encontró el módulo "${reqMod.name}" en el tablero MODULOS.`);
            }

            jerarquia.push(modObj);
        }

        // =========================================================================
        // PASO 6: Generar y Subir el PDF Oficial de Producción
        // =========================================================================
        console.log("[Paso 6]: Generando documento PDF corporativo con desglose completo...");
        const arrayConsolidado = Object.values(consolidadoMateriales);

        const pdfBytes = await generateDetailedBOMPdf({
            orderName,
            producto: productoSeleccionado,
            configuracion: configuracionSeleccionada,
            cantidadEquipos,
            jerarquia,
            consolidado: arrayConsolidado
        });

        console.log(`[PDF]: Generado con éxito (${pdfBytes.length} bytes). Subiendo a PRUEBA API (file_mm7m2b35)...`);
        const safeOrderFile = orderName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const uploadRes = await uploadPdfToMonday(pulseId, token, pdfBytes, `BOM_${safeOrderFile}.pdf`);

        const pdfSubido = Boolean(uploadRes && !uploadRes.errors);
        console.log(`[PDF]: Resultado de subida: ${pdfSubido ? 'EXITOSO' : 'FALLIDO'}`);

        return res.status(200).json({
            success: true,
            orden: orderName,
            producto: productoSeleccionado,
            configuracion: configuracionSeleccionada,
            cantidadEquipos,
            modulosProcesados: jerarquia.length,
            materialesTotales: arrayConsolidado.length,
            pdfGenerado: pdfSubido
        });

    } catch (error) {
        console.error("---> Error crítico en handler:", error);
        return res.status(500).json({ error: error.message });
    }
}

// Función auxiliar para procesar los subelementos (materiales) de un submódulo
function procesarSubmodulo(submoduloItem, fallbackName, cantSub, cantMod, cantEquipos, consolidado) {
    const subName = submoduloItem?.name || fallbackName;
    const subCols = submoduloItem?.column_values || [];
    const codigoSub = subCols.find(c => c.id === "text_mm7jphz6")?.text || "";

    const subObj = {
        nombre: subName,
        codigo: codigoSub || subName,
        cantidadSubmodulo: cantSub > 0 ? cantSub : 1,
        materiales: []
    };

    if (submoduloItem?.subitems && submoduloItem.subitems.length > 0) {
        for (const matItem of submoduloItem.subitems) {
            const mCols = matItem.column_values || [];
            
            // Buscar cantidad unitaria del material
            let cantUnit = 1;
            const numCol = mCols.find(c => c.type === "numbers" || c.id?.includes("cant") || c.id?.includes("numeric"));
            if (numCol?.text && !isNaN(parseFloat(numCol.text))) {
                cantUnit = parseFloat(numCol.text);
            }

            // Buscar unidad de medida y código/sku
            const umCol = mCols.find(c => c.id?.includes("unidad") || c.id?.includes("medida") || c.type === "text" || c.type === "dropdown");
            const unidad = umCol?.text || "PZA";
            const sku = matItem.name;

            const totalMat = cantUnit * subObj.cantidadSubmodulo * cantMod * cantEquipos;

            const matObj = {
                sku,
                nombre: matItem.name,
                unidad,
                cantUnitaria: cantUnit,
                cantTotal: totalMat
            };

            subObj.materiales.push(matObj);

            // Acumular en el consolidado general
            if (consolidado[sku]) {
                consolidado[sku].cantTotal += totalMat;
            } else {
                consolidado[sku] = {
                    sku,
                    nombre: matItem.name,
                    unidad,
                    cantTotal: totalMat
                };
            }
        }
    }

    return subObj;
}

// Función para subir el PDF generado a la columna de Monday (file_mm7m2b35)
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

// Generador de PDF elegante con desglose jerárquico completo
async function generateDetailedBOMPdf({ orderName, producto, configuracion, cantidadEquipos, jerarquia, consolidado }) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]); // Carta Estándar
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const { width, height } = page.getSize();
    let y = height - 35;

    const primaryColor = rgb(0.08, 0.2, 0.42);   // Azul Corporativo Transtools
    const secondaryColor = rgb(0.18, 0.35, 0.65);
    const darkGray = rgb(0.2, 0.2, 0.2);
    const lightGray = rgb(0.94, 0.95, 0.97);
    const borderColor = rgb(0.8, 0.83, 0.88);

    const safeText = (text) => {
        if (!text) return "";
        return String(text).replace(/[^\x20-\x7E\xA0-\xFF]/g, " ").trim();
    };

    const truncate = (text, maxWidth, font, size) => {
        let str = safeText(text);
        if (font.widthOfTextAtSize(str, size) <= maxWidth) return str;
        while (str.length > 0 && font.widthOfTextAtSize(str + '...', size) > maxWidth) {
            str = str.slice(0, -1);
        }
        return str + '...';
    };

    const drawHeader = () => {
        page.drawRectangle({
            x: 35,
            y: y - 5,
            width: width - 70,
            height: 36,
            color: primaryColor
        });

        page.drawText("TRANSTOOLS - EXPLOSIÓN DE MATERIALES (BOM MODULAR)", {
            x: 48,
            y: y + 9,
            size: 11.5,
            font: fontBold,
            color: rgb(1, 1, 1)
        });

        y -= 42;

        // Fila de metadatos
        page.drawText(`Orden: ${safeText(orderName)}`, { x: 38, y, size: 9, font: fontBold, color: darkGray });
        page.drawText(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, { x: width - 150, y, size: 8.5, font: fontRegular, color: darkGray });
        y -= 14;

        if (producto) {
            page.drawText(`Producto: ${safeText(producto)}`, { x: 38, y, size: 8.5, font: fontRegular, color: darkGray });
        }
        if (configuracion) {
            page.drawText(`Configuración: ${safeText(configuracion)}`, { x: 230, y, size: 8.5, font: fontRegular, color: darkGray });
        }
        page.drawText(`Cant. a Fabricar: ${cantidadEquipos}`, { x: width - 170, y, size: 9, font: fontBold, color: primaryColor });
        y -= 20;

        page.drawLine({
            start: { x: 35, y },
            end: { x: width - 35, y },
            color: borderColor,
            thickness: 0.8
        });
        y -= 15;
    };

    drawHeader();

    // =========================================================================
    // SECCIÓN 1: Desglose Jerárquico (Módulos -> Submódulos -> Materiales)
    // =========================================================================
    for (const mod of jerarquia) {
        if (y < 80) {
            page = pdfDoc.addPage([612, 792]);
            y = 750;
            drawHeader();
        }

        // Barra de Módulo
        page.drawRectangle({
            x: 35,
            y: y - 3,
            width: width - 70,
            height: 18,
            color: secondaryColor
        });

        const modTitle = `MÓDULO: ${safeText(mod.nombre)} (Cant. unitaria en equipo: ${mod.cantidadModulo})`;
        page.drawText(modTitle, { x: 42, y: y + 2, size: 8.5, font: fontBold, color: rgb(1, 1, 1) });
        y -= 19;

        if (!mod.submodulos || mod.submodulos.length === 0) {
            page.drawText("  (Sin submódulos o componentes registrados)", { x: 45, y, size: 7.5, font: fontRegular, color: darkGray });
            y -= 14;
            continue;
        }

        for (const sub of mod.submodulos) {
            if (y < 65) {
                page = pdfDoc.addPage([612, 792]);
                y = 750;
                drawHeader();
            }

            // Sub-encabezado de Submódulo
            page.drawRectangle({
                x: 40,
                y: y - 2,
                width: width - 80,
                height: 15,
                color: lightGray
            });

            const subTitle = `Submódulo: ${safeText(sub.nombre)} | Cant. requerida en módulo: ${sub.cantidadSubmodulo}`;
            page.drawText(subTitle, { x: 46, y: y + 2, size: 8, font: fontBold, color: primaryColor });
            y -= 16;

            // Tabla de Materiales del Submódulo
            if (sub.materiales && sub.materiales.length > 0) {
                // Header tabla materiales
                page.drawText("MATERIAL / PIEZA", { x: 45, y, size: 7, font: fontBold, color: darkGray });
                page.drawText("U.M.", { x: 370, y, size: 7, font: fontBold, color: darkGray });
                page.drawText("CANT. UNIT.", { x: 420, y, size: 7, font: fontBold, color: darkGray });
                page.drawText("CANT. TOTAL", { x: 490, y, size: 7, font: fontBold, color: primaryColor });
                y -= 10;

                sub.materiales.forEach((mat) => {
                    if (y < 45) {
                        page = pdfDoc.addPage([612, 792]);
                        y = 750;
                        drawHeader();
                    }

                    const matName = truncate(mat.nombre, 310, fontRegular, 7.5);
                    const matUm = safeText(mat.unidad);
                    const matUnit = mat.cantUnitaria.toLocaleString('es-MX', { maximumFractionDigits: 2 });
                    const matTot = mat.cantTotal.toLocaleString('es-MX', { maximumFractionDigits: 2 });

                    page.drawText(matName, { x: 45, y, size: 7.5, font: fontRegular, color: darkGray });
                    page.drawText(matUm, { x: 370, y, size: 7.5, font: fontRegular, color: darkGray });
                    page.drawText(matUnit, { x: 425, y, size: 7.5, font: fontRegular, color: darkGray });
                    page.drawText(matTot, { x: 495, y, size: 7.5, font: fontBold, color: primaryColor });

                    page.drawLine({
                        start: { x: 40, y: y - 2 },
                        end: { x: width - 40, y: y - 2 },
                        color: borderColor,
                        thickness: 0.3
                    });

                    y -= 12;
                });
            } else {
                page.drawText("    (Sin materiales individuales en subelementos)", { x: 45, y, size: 7.5, font: fontRegular, color: darkGray });
                y -= 12;
            }

            y -= 4;
        }

        y -= 6;
    }

    // =========================================================================
    // SECCIÓN 2: Resumen Consolidado de Materiales (Almacén / Compras)
    // =========================================================================
    if (consolidado && consolidado.length > 0) {
        if (y < 120) {
            page = pdfDoc.addPage([612, 792]);
            y = 750;
            drawHeader();
        }

        y -= 10;
        page.drawRectangle({
            x: 35,
            y: y - 4,
            width: width - 70,
            height: 20,
            color: primaryColor
        });

        page.drawText("RESUMEN CONSOLIDADO DE MATERIALES (TOTALES DE PRODUCCIÓN)", {
            x: 45,
            y: y + 2,
            size: 9,
            font: fontBold,
            color: rgb(1, 1, 1)
        });
        y -= 22;

        // Encabezados del consolidado
        page.drawRectangle({
            x: 35,
            y: y - 3,
            width: width - 70,
            height: 16,
            color: lightGray,
            borderColor,
            borderWidth: 0.5
        });

        page.drawText("DESCRIPCIÓN / MATERIAL", { x: 42, y: y + 2, size: 7.5, font: fontBold, color: primaryColor });
        page.drawText("U.M.", { x: 410, y: y + 2, size: 7.5, font: fontBold, color: primaryColor });
        page.drawText("CANTIDAD TOTAL", { x: 470, y: y + 2, size: 7.5, font: fontBold, color: primaryColor });
        y -= 18;

        consolidado.forEach((item, index) => {
            if (y < 45) {
                page = pdfDoc.addPage([612, 792]);
                y = 750;
                drawHeader();
            }

            if (index % 2 === 1) {
                page.drawRectangle({
                    x: 35,
                    y: y - 3,
                    width: width - 70,
                    height: 14,
                    color: rgb(0.98, 0.98, 0.99)
                });
            }

            const itemDesc = truncate(item.nombre || item.sku, 355, fontRegular, 7.5);
            const itemUm = safeText(item.unidad || "PZA");
            const itemTot = item.cantTotal.toLocaleString('es-MX', { maximumFractionDigits: 2 });

            page.drawText(itemDesc, { x: 42, y, size: 7.5, font: fontRegular, color: darkGray });
            page.drawText(itemUm, { x: 410, y, size: 7.5, font: fontRegular, color: darkGray });
            page.drawText(itemTot, { x: 475, y, size: 8, font: fontBold, color: primaryColor });

            page.drawLine({
                start: { x: 35, y: y - 3 },
                end: { x: width - 35, y: y - 3 },
                color: borderColor,
                thickness: 0.4
            });

            y -= 14;
        });
    }

    return await pdfDoc.save();
}