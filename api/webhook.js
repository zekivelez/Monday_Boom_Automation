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

    // Funciones auxiliares de extracción y normalización
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

    const normalizeStr = (s) => {
        if (!s) return "";
        return String(s)
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    };

    // Limpieza de claves alfanuméricas (ej: "DOTA-10M-2FMX-1-00101" -> "DOTA10M2FMX100101")
    const cleanCode = (s) => {
        if (!s) return "";
        return String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
    };

    // Mapeo automático de nombres descriptivos a códigos de configuración técnica
    const CONFIG_ALIASES = {
        "BOM DOLLY A SCORPION 2 EJES": "DOTA-10M-2FMX-1-00101",
        "DOLLY A SCORPION 2 EJES": "DOTA-10M-2FMX-1-00101",
        "BOM DOLLY A SCORPION": "DOTA-10M-2FMX-1-00101",
        "DOLLY A SCORPION": "DOTA-10M-2FMX-1-00101",
        "DOLLY A": "DOTA-10M-2FMX-1-00101"
    };

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
        const colConfigDropdown = genCols.find(c => c.id === "dropdown_mm7mqdtg");
        const colConfigText = genCols.find(c => c.id === "text_mm7q5s7x"); // ID de configuración texto

        const productoSeleccionado = extractColText(colProducto);
        const configuracionDropdown = extractColText(colConfigDropdown);
        const configuracionTexto = extractColText(colConfigText);

        let cantidadEquipos = extractColNumber(colCantidad, 1);
        if (cantidadEquipos <= 0) cantidadEquipos = 1;

        // Determinar el código técnico de configuración (ej: DOTA-10M-2FMX-1-00101)
        let configCodigoTecnico = configuracionTexto || "";
        if (!configCodigoTecnico && configuracionDropdown) {
            configCodigoTecnico = CONFIG_ALIASES[configuracionDropdown.trim()] || "";
            if (!configCodigoTecnico) {
                const normDrop = normalizeStr(configuracionDropdown);
                for (const [alias, code] of Object.entries(CONFIG_ALIASES)) {
                    if (normDrop.includes(normalizeStr(alias)) || normalizeStr(alias).includes(normDrop)) {
                        configCodigoTecnico = code;
                        break;
                    }
                }
            }
        }
        if (!configCodigoTecnico && productoSeleccionado) {
            configCodigoTecnico = CONFIG_ALIASES[productoSeleccionado.trim()] || "";
        }
        if (!configCodigoTecnico) {
            configCodigoTecnico = configuracionDropdown || configuracionTexto || "DOTA-10M-2FMX-1-00101";
        }

        const configNombreVisible = configuracionDropdown || configCodigoTecnico;

        console.log(`[PRUEBA API]: Orden="${orderName}", Producto="${productoSeleccionado}", ConfigNombre="${configNombreVisible}", ClaveTecnica="${configCodigoTecnico}", Cantidad=${cantidadEquipos}`);

        // =========================================================================
        // PASO 2: Consultar Tablero MODULOS (18432845727) con grupos y subelementos
        // =========================================================================
        console.log(`[Paso 2]: Consultando Tablero MODULOS (18432845727)...`);
        const queryModulos = `query {
            boards(ids: [18432845727]) {
                groups {
                    id
                    title
                }
                items_page(limit: 500) {
                    items {
                        id
                        name
                        group {
                            id
                            title
                        }
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
        }`;

        const resModulos = await fetchMonday(queryModulos);
        const boardModulos = resModulos.data?.boards?.[0];
        const allModulosItems = boardModulos?.items_page?.items || [];
        const gruposModulos = boardModulos?.groups || [];

        console.log(`[MODULOS]: ${gruposModulos.length} grupos detectados:`, gruposModulos.map(g => `"${g.title}"`).join(", "));
        console.log(`[MODULOS]: ${allModulosItems.length} filas totales en catálogo`);

        // Identificar las filas de MODULOS que pertenecen al grupo de la configuración técnica
        const targetCleanCode = cleanCode(configCodigoTecnico);
        console.log(`[MODULOS]: Buscando filas para Clave Normalizada="${targetCleanCode}"...`);

        let filasModulosConfig = allModulosItems.filter(item => {
            const gTitle = item.group?.title || "";
            const gClean = cleanCode(gTitle);
            if (gClean && targetCleanCode) {
                if (gClean === targetCleanCode || gClean.includes(targetCleanCode) || targetCleanCode.includes(gClean)) {
                    return true;
                }
            }
            const gNorm = normalizeStr(gTitle);
            const targetNorm = normalizeStr(configNombreVisible);
            if (gNorm && targetNorm && (gNorm.includes(targetNorm) || targetNorm.includes(gNorm))) {
                return true;
            }
            return false;
        });

        if (filasModulosConfig.length === 0) {
            console.warn(`[MODULOS]: No se encontraron filas por coincidencia estricta de grupo. Intentando respaldo por primer grupo disponible.`);
            if (gruposModulos.length > 0) {
                const primerGrupoId = gruposModulos[0].id;
                filasModulosConfig = allModulosItems.filter(item => item.group?.id === primerGrupoId);
            }
        }

        console.log(`[MODULOS]: ${filasModulosConfig.length} filas seleccionadas dentro del grupo "${configCodigoTecnico}"`);

        // =========================================================================
        // PASO 3: Consultar Tablero SUBMODULOS (18432844380) con sus Materiales (Subelementos)
        // =========================================================================
        console.log(`[Paso 3]: Consultando Tablero SUBMODULOS (18432844380)...`);
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
        console.log(`[SUBMODULOS]: ${allSubmodulosItems.length} submódulos disponibles en catálogo`);

        // Indexar submódulos por ID y por nombre para enlace instantáneo
        const submodulosMapById = new Map();
        const submodulosMapByName = new Map();
        allSubmodulosItems.forEach(item => {
            submodulosMapById.set(String(item.id), item);
            submodulosMapByName.set(normalizeStr(item.name), item);
            const codigoSub = extractColText(item.column_values?.find(c => c.id === "text_mm7jphz6"));
            if (codigoSub) submodulosMapByName.set(normalizeStr(codigoSub), item);
        });

        // =========================================================================
        // PASO 4: Construir la Estructura de Explosión (Submódulos -> Materiales)
        // =========================================================================
        const desgloses = [];
        const consolidadoMateriales = {};

        for (const filaMod of filasModulosConfig) {
            const cols = filaMod.column_values || [];
            const colSubmodulo = cols.find(c => c.id === "board_relation_mm7j1vcf" || c.type === "board_relation");
            const colCant = cols.find(c => c.id === "numeric_mm7j6c8r" || c.type === "numbers");

            let cantSubmodulo = extractColNumber(colCant, 1);
            if (cantSubmodulo <= 0) cantSubmodulo = 1;

            // Extraer ID y Nombre del Submódulo vinculado
            const linkedId = colSubmodulo?.linked_item_ids?.[0];
            const linkedName = colSubmodulo?.linked_items?.[0]?.name || extractColText(colSubmodulo) || filaMod.name;

            let submoduloEncontrado = linkedId ? submodulosMapById.get(String(linkedId)) : null;
            if (!submoduloEncontrado && linkedName) {
                submoduloEncontrado = submodulosMapByName.get(normalizeStr(linkedName));
            }
            if (!submoduloEncontrado && linkedName) {
                const normL = normalizeStr(linkedName);
                submoduloEncontrado = allSubmodulosItems.find(sm => {
                    const smNorm = normalizeStr(sm.name);
                    return smNorm.includes(normL) || normL.includes(smNorm);
                });
            }

            const nombreFinalSubmodulo = submoduloEncontrado?.name || linkedName || `Submódulo #${filaMod.name}`;
            const subCols = submoduloEncontrado?.column_values || [];
            const codigoSub = extractColText(subCols.find(c => c.id === "text_mm7jphz6")) || nombreFinalSubmodulo;

            const subItemObj = {
                filaNumero: filaMod.name,
                nombre: nombreFinalSubmodulo,
                codigo: codigoSub,
                cantidadPorEquipo: cantSubmodulo,
                cantidadTotalParaOrden: cantSubmodulo * cantidadEquipos,
                materiales: []
            };

            // Extraer los Materiales / Piezas desde los Subelementos del Submódulo
            if (submoduloEncontrado?.subitems && submoduloEncontrado.subitems.length > 0) {
                for (const mat of submoduloEncontrado.subitems) {
                    const mCols = mat.column_values || [];
                    const numCol = mCols.find(c => c.type === "numbers" || c.id?.includes("cant") || c.id?.includes("numeric"));
                    const umCol = mCols.find(c => c.id?.includes("unidad") || c.id?.includes("medida") || c.type === "text" || c.type === "dropdown");

                    const cantUnit = extractColNumber(numCol, 1);
                    const unidad = extractColText(umCol) || "PZA";
                    const sku = mat.name;
                    const cantTotalMat = cantUnit * cantSubmodulo * cantidadEquipos;

                    const matObj = {
                        sku,
                        nombre: mat.name,
                        unidad,
                        cantUnitaria: cantUnit,
                        cantTotal: cantTotalMat
                    };

                    subItemObj.materiales.push(matObj);

                    // Consolidar en lista de compras/almacén
                    if (consolidadoMateriales[sku]) {
                        consolidadoMateriales[sku].cantTotal += cantTotalMat;
                    } else {
                        consolidadoMateriales[sku] = {
                            sku,
                            nombre: mat.name,
                            unidad,
                            cantTotal: cantTotalMat
                        };
                    }
                }
            }

            desgloses.push(subItemObj);
        }

        console.log(`[Consolidación]: ${desgloses.length} submódulos procesados. ${Object.keys(consolidadoMateriales).length} materiales únicos consolidados.`);

        // =========================================================================
        // PASO 5: Generar el Documento PDF Oficial de Producción
        // =========================================================================
        console.log("[Paso 5]: Generando documento PDF corporativo...");
        const arrayConsolidado = Object.values(consolidadoMateriales);

        const pdfBytes = await generateBOMReportPdf({
            orderName,
            producto: productoSeleccionado,
            configNombre: configNombreVisible,
            configCodigo: configCodigoTecnico,
            cantidadEquipos,
            desgloses,
            consolidado: arrayConsolidado
        });

        console.log(`[PDF]: Generado (${pdfBytes.length} bytes). Subiendo a PRUEBA API (file_mm7m2b35)...`);
        const safeOrderFile = orderName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const uploadRes = await uploadPdfToMonday(pulseId, token, pdfBytes, `BOM_${safeOrderFile}.pdf`);

        const pdfSubido = Boolean(uploadRes && !uploadRes.errors);
        console.log(`[PDF]: Resultado de subida: ${pdfSubido ? 'EXITOSO' : 'FALLIDO'}`);

        return res.status(200).json({
            success: true,
            orden: orderName,
            producto: productoSeleccionado,
            configuracion: configNombreVisible,
            codigoTecnico: configCodigoTecnico,
            cantidadEquipos,
            submodulosExplosionados: desgloses.length,
            materialesTotales: arrayConsolidado.length,
            pdfGenerado: pdfSubido
        });

    } catch (error) {
        console.error("---> Error crítico en handler:", error);
        return res.status(500).json({ error: error.message });
    }
}

// Función para subir el PDF generado a Monday
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

// Función de diseño y generación del reporte PDF corporativo
async function generateBOMReportPdf({ orderName, producto, configNombre, configCodigo, cantidadEquipos, desgloses, consolidado }) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]); // Tamaño Carta estándar
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

        y -= 40;

        // Fila 1 de Metadatos
        page.drawText(`Orden: ${safeText(orderName)}`, { x: 38, y, size: 9, font: fontBold, color: darkGray });
        page.drawText(`Fecha: ${new Date().toLocaleDateString('es-MX')}`, { x: width - 150, y, size: 8.5, font: fontRegular, color: darkGray });
        y -= 13;

        // Fila 2 de Metadatos
        const prodTxt = producto ? `Producto: ${safeText(producto)}` : "";
        page.drawText(prodTxt, { x: 38, y, size: 8.5, font: fontRegular, color: darkGray });
        page.drawText(`Cant. a Fabricar: ${cantidadEquipos}`, { x: width - 170, y, size: 9, font: fontBold, color: primaryColor });
        y -= 13;

        // Fila 3 de Metadatos: Configuración y Código Técnico
        const confTxt = `Configuración: ${safeText(configNombre)} (${safeText(configCodigo)})`;
        page.drawText(confTxt, { x: 38, y, size: 8.5, font: fontBold, color: secondaryColor });
        y -= 18;

        page.drawLine({
            start: { x: 35, y },
            end: { x: width - 35, y },
            color: borderColor,
            thickness: 0.8
        });
        y -= 14;
    };

    drawHeader();

    // =========================================================================
    // SECCIÓN 1: Desglose por Submódulos y sus Materiales
    // =========================================================================
    for (const sub of desgloses) {
        if (y < 75) {
            page = pdfDoc.addPage([612, 792]);
            y = 750;
            drawHeader();
        }

        // Barra de Submódulo
        page.drawRectangle({
            x: 35,
            y: y - 3,
            width: width - 70,
            height: 17,
            color: secondaryColor
        });

        const subTitle = `${safeText(sub.filaNumero)}. ${safeText(sub.nombre)} | Cant. x Equipo: ${sub.cantidadPorEquipo} | Total Req: ${sub.cantidadTotalParaOrden}`;
        page.drawText(subTitle, { x: 42, y: y + 2, size: 8, font: fontBold, color: rgb(1, 1, 1) });
        y -= 18;

        if (sub.materiales && sub.materiales.length > 0) {
            // Encabezados de tabla de materiales
            page.drawText("MATERIAL / PIEZA", { x: 45, y, size: 7, font: fontBold, color: darkGray });
            page.drawText("U.M.", { x: 370, y, size: 7, font: fontBold, color: darkGray });
            page.drawText("CANT. UNIT.", { x: 420, y, size: 7, font: fontBold, color: darkGray });
            page.drawText("TOTAL ORDEN", { x: 490, y, size: 7, font: fontBold, color: primaryColor });
            y -= 10;

            sub.materiales.forEach(mat => {
                if (y < 42) {
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
            page.drawText("    (Submódulo sin desglose atómico en subelementos)", { x: 45, y, size: 7.5, font: fontRegular, color: darkGray });
            y -= 12;
        }

        y -= 5;
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

        page.drawText("RESUMEN CONSOLIDADO DE MATERIALES (TOTALES PARA PRODUCCIÓN)", {
            x: 45,
            y: y + 2,
            size: 9,
            font: fontBold,
            color: rgb(1, 1, 1)
        });
        y -= 22;

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
            if (y < 42) {
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