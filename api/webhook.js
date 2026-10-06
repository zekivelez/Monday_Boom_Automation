import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

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

        // Fragmento común de columnas (relaciones y espejos devuelven text=null, por eso se pide display_value)
        const COLS_FRAGMENT = `column_values {
            id text value type
            ... on MirrorValue { display_value }
            ... on BoardRelationValue { display_value linked_item_ids linked_items { id name } }
        }`;

        const BOARD_MODULOS = "18432845727";
        const BOARD_SUBMODULOS = "18432844380";
        const BOARD_ARTICULOS = "18432236328"; // Catálogo de Artículos de la Planta (SKU)

        const getLinkedIds = (col) => {
            if (!col) return [];
            if (Array.isArray(col.linked_item_ids) && col.linked_item_ids.length) return col.linked_item_ids.map(String);
            if (Array.isArray(col.linked_items) && col.linked_items.length) return col.linked_items.map(li => String(li.id));
            try {
                const v = JSON.parse(col.value || "null");
                if (Array.isArray(v?.linkedPulseIds)) return v.linkedPulseIds.map(l => String(l.linkedPulseId));
            } catch {}
            return [];
        };

        // Consulta ítems por ID (en bloques de 100) con columnas y subelementos
        const fetchItemsByIds = async (ids) => {
            const unique = [...new Set(ids.map(String))];
            const out = [];
            for (let i = 0; i < unique.length; i += 100) {
                const chunk = unique.slice(i, i + 100);
                const q = `query ($ids: [ID!]) {
                    items(ids: $ids, limit: 100) {
                        id name
                        board { id }
                        group { id title }
                        ${COLS_FRAGMENT}
                        subitems { id name ${COLS_FRAGMENT} }
                    }
                }`;
                const r = await fetchMonday(q, { ids: chunk });
                out.push(...(r.data?.items || []));
            }
            return out;
        };

        const STOP_WORDS = new Set(["bom", "modular", "de", "del", "la", "el"]);
        const tokens = (s) => normalizeStr(s).split(" ").filter(t => t && !STOP_WORDS.has(t));

        // =========================================================================
        // PASO 2: BOM MODULAR (18432584292) -> filas de la configuración
        // =========================================================================
        console.log(`[Paso 2]: Consultando BOM MODULAR (18432584292)...`);
        const queryBom = `query {
            boards(ids: [18432584292]) {
                columns { id title }
                items_page(limit: 500) {
                    items {
                        id name
                        group { id title }
                        ${COLS_FRAGMENT}
                        subitems { id name ${COLS_FRAGMENT} }
                    }
                }
            }
        }`;
        const resBom = await fetchMonday(queryBom);
        const boardBom = resBom.data?.boards?.[0];
        const bomItems = boardBom?.items_page?.items || [];
        const colConfigBomId = (boardBom?.columns || []).find(c => normalizeStr(c.title) === "configuracion")?.id;
        console.log(`[BOM MODULAR]: ${bomItems.length} filas. Columna CONFIGURACION="${colConfigBomId || "NO ENCONTRADA"}"`);

        const targetClean = cleanCode(configCodigoTecnico);
        const targetTokens = new Set([...tokens(configNombreVisible), ...tokens(productoSeleccionado)]);

        const filasBom = bomItems.filter(item => {
            const cfg = extractColText(item.column_values?.find(c => c.id === colConfigBomId));
            if (cfg && targetClean && cleanCode(cfg) === targetClean) return true;
            if (cfg && normalizeStr(cfg) === normalizeStr(configNombreVisible)) return true;
            // Respaldo: título del grupo (ej. "BOM MODULAR DOLLY A SCORPION") contenido en el nombre de la configuración
            const gTok = tokens(item.group?.title);
            return gTok.length > 0 && gTok.every(t => targetTokens.has(t));
        });

        if (filasBom.length === 0) {
            const msg = `No se encontraron filas en BOM MODULAR para la configuración "${configCodigoTecnico}" / "${configNombreVisible}".`;
            console.error(`[BOM MODULAR]: ${msg}`);
            return res.status(200).json({ success: false, error: msg });
        }

        const configsEnBom = [...new Set(filasBom.map(f => extractColText(f.column_values?.find(c => c.id === colConfigBomId))).filter(Boolean))];
        console.log(`[BOM MODULAR]: ${filasBom.length} filas seleccionadas (grupo "${filasBom[0].group?.title}", CONFIGURACION=${configsEnBom.join(" | ")}): ${filasBom.map(f => f.name).join(" | ")}`);
        if (targetClean && !configsEnBom.some(c => cleanCode(c) === targetClean)) {
            console.warn(`[BOM MODULAR]: La clave de PRUEBA API "${configCodigoTecnico}" no coincide con la CONFIGURACION de BOM MODULAR (${configsEnBom.join(" | ")}). Se enlazó por nombre de grupo.`);
        }

        // Módulos referenciados en los subelementos de BOM MODULAR (columna MODULOS = board_relation_mm7qyye2)
        const refsModulos = [];
        for (const fila of filasBom) {
            for (const sub of (fila.subitems || [])) {
                const sCols = sub.column_values || [];
                const ids = getLinkedIds(sCols.find(c => c.id === "board_relation_mm7qyye2"));
                if (!ids.length) {
                    console.warn(`[BOM MODULAR]: Subelemento "${sub.name}" de "${fila.name}" no tiene MODULO vinculado (board_relation_mm7qyye2 vacío).`);
                    continue;
                }
                let cant = extractColNumber(sCols.find(c => c.type === "numbers"), 1);
                if (cant <= 0) cant = 1;
                ids.forEach(id => refsModulos.push({ moduloId: id, cantidad: cant, bomFila: fila.name }));
            }
        }

        if (refsModulos.length === 0) {
            const msg = `Las filas de BOM MODULAR no tienen módulos vinculados en la columna MODULOS (board_relation_mm7qyye2).`;
            console.error(`[BOM MODULAR]: ${msg}`);
            return res.status(200).json({ success: false, error: msg });
        }

        // =========================================================================
        // PASO 3: MODULOS (18432845727) -> enlaces a SUBMODULOS
        // =========================================================================
        console.log(`[Paso 3]: Consultando ${refsModulos.length} módulos vinculados en MODULOS...`);
        const modulosItems = await fetchItemsByIds(refsModulos.map(r => r.moduloId));
        const modulosById = new Map(modulosItems.map(m => [String(m.id), m]));
        console.log(`[MODULOS]: ${modulosItems.length} módulos leídos: ${modulosItems.map(m => m.name).join(" | ")}`);

        const refsSub = [];
        for (const ref of refsModulos) {
            const mod = modulosById.get(ref.moduloId);
            if (!mod) {
                console.warn(`[MODULOS]: No se pudo leer el módulo ${ref.moduloId} (fila BOM "${ref.bomFila}").`);
                continue;
            }
            const candidatos = [];
            // Los submódulos se conectan desde los SUBELEMENTOS del módulo (cada subelemento = 1 submódulo)
            if (!(mod.subitems || []).length) {
                console.warn(`[MODULOS]: El módulo "${mod.name}" no tiene subelementos con submódulos.`);
            }
            for (const s of (mod.subitems || [])) {
                const sc = s.column_values || [];
                const cantSub = extractColNumber(sc.find(c => c.id === "numeric_mm7j6c8r") || sc.find(c => c.type === "numbers"), 1);
                sc.filter(c => c.type === "board_relation").forEach(c => {
                    getLinkedIds(c).forEach(id => candidatos.push({ id, cant: cantSub }));
                });
            }
            candidatos.forEach(c => refsSub.push({
                submoduloId: c.id,
                cantidad: (c.cant > 0 ? c.cant : 1) * ref.cantidad,
                moduloNombre: mod.name,
                bomFila: ref.bomFila
            }));
        }

        // =========================================================================
        // PASO 4: SUBMODULOS (18432844380) -> materiales en subelementos
        // =========================================================================
        console.log(`[Paso 4]: Consultando ${refsSub.length} enlaces a SUBMODULOS...`);
        const submodulosItems = (await fetchItemsByIds(refsSub.map(r => r.submoduloId)))
            .filter(it => String(it.board?.id) === BOARD_SUBMODULOS);
        const submodulosMapById = new Map(submodulosItems.map(s => [String(s.id), s]));
        console.log(`[SUBMODULOS]: ${submodulosItems.length} submódulos leídos: ${submodulosItems.map(s => s.name).join(" | ")}`);

        const refsSubValidas = refsSub.filter(r => submodulosMapById.has(r.submoduloId));
        if (refsSubValidas.length === 0) {
            const msg = `Los módulos (${modulosItems.map(m => m.name).join(" | ")}) no tienen submódulos vinculados del tablero SUBMODULOS.`;
            console.error(`[MODULOS]: ${msg}`);
            return res.status(200).json({ success: false, error: msg });
        }

        // =========================================================================
        // PASO 5: Consultar SKUs de Materiales desde CATÁLOGO DE ARTÍCULOS (18432236328)
        // =========================================================================
        const todosMaterialesIds = [];
        for (const entrada of refsSubValidas) {
            const sm = submodulosMapById.get(entrada.submoduloId);
            for (const mat of (sm?.subitems || [])) {
                const mCols = mat.column_values || [];
                const relMat = mCols.find(c => c.id === "board_relation_mm7jcgm0") || mCols.find(c => c.type === "board_relation");
                getLinkedIds(relMat).forEach(id => todosMaterialesIds.push(id));
            }
        }

        console.log(`[Paso 5]: Consultando SKUs y Proveedores para ${todosMaterialesIds.length} materiales en Catálogo (18432236328)...`);
        const catalogoArticulos = await fetchItemsByIds(todosMaterialesIds);
        const articulosMap = new Map();
        catalogoArticulos.forEach(art => {
            const skuCol = art.column_values?.find(c => c.id === "text_mm7ebpck");
            const provPrinCol = art.column_values?.find(c => c.id === "dropdown_mm7ezyff");
            const provAltCol = art.column_values?.find(c => c.id === "dropdown_mm7epfbk");
            const codProvCol = art.column_values?.find(c => c.id === "text_mm7epwa2");

            const skuVal = extractColText(skuCol);
            const provPrincipalVal = extractColText(provPrinCol);
            const provAlternoVal = extractColText(provAltCol);
            const codProvVal = extractColText(codProvCol);

            const artData = {
                id: art.id,
                name: art.name,
                sku: skuVal || "",
                proveedorPrincipal: provPrincipalVal || "SIN ASIGNAR",
                proveedorAlterno: provAlternoVal || "-",
                codigoProveedor: codProvVal || "-"
            };

            articulosMap.set(String(art.id), artData);
            if (skuVal) {
                articulosMap.set(normalizeStr(art.name), artData);
            }
        });
        console.log(`[ARTICULOS]: ${articulosMap.size} artículos indexados con SKU y Proveedores.`);

        // =========================================================================
        // PASO 6: Construir la Estructura de Explosión (Submódulos -> Materiales)
        // =========================================================================
        const desgloses = [];
        const consolidadoMateriales = {};
        let filaContador = 0;

        for (const entrada of refsSubValidas) {
            const submoduloEncontrado = submodulosMapById.get(entrada.submoduloId);
            filaContador++;
            const cantSubmodulo = entrada.cantidad;
            const subCols = submoduloEncontrado.column_values || [];
            const codigoSub = extractColText(subCols.find(c => c.id === "text_mm7jphz6")) || submoduloEncontrado.name;

            const subItemObj = {
                filaNumero: String(filaContador),
                moduloNombre: entrada.moduloNombre,
                submoduloNombre: submoduloEncontrado.name,
                codigo: codigoSub,
                cantidadPorEquipo: cantSubmodulo,
                cantidadTotalParaOrden: cantSubmodulo * cantidadEquipos,
                materiales: []
            };

            // Extraer los Materiales / Piezas desde los Subelementos del Submódulo
            if (submoduloEncontrado?.subitems && submoduloEncontrado.subitems.length > 0) {
                for (const mat of submoduloEncontrado.subitems) {
                    const mCols = mat.column_values || [];
                    // IDs reales de subelementos en SUBMODULOS
                    const numCol = mCols.find(c => c.id === "numeric_mm7jbpty") || mCols.find(c => c.type === "numbers");
                    const umCol = mCols.find(c => c.id?.includes("unidad") || c.id?.includes("medida") || c.type === "text" || c.type === "dropdown");

                    // 1. Extraer nombre del Material desde la columna de relación board_relation_mm7jcgm0
                    const relMaterialCol = mCols.find(c => c.id === "board_relation_mm7jcgm0") || mCols.find(c => c.type === "board_relation");
                    if (!relMaterialCol?.linked_item_ids?.length) {
                        console.warn(`[SUBMODULOS]: Subelemento "${mat.name}" de "${submoduloEncontrado.name}" no tiene material vinculado (board_relation_mm7jcgm0 vacío).`);
                    }
                    let nombreMaterial = "";
                    if (relMaterialCol) {
                        if (relMaterialCol.linked_items && relMaterialCol.linked_items.length > 0) {
                            nombreMaterial = relMaterialCol.linked_items.map(li => li.name).filter(Boolean).join(", ");
                        }
                        if (!nombreMaterial) {
                            nombreMaterial = extractColText(relMaterialCol);
                        }
                    }

                    // Respaldo en columnas espejo (mirror) o texto si la relación no devolvió texto directo
                    if (!nombreMaterial) {
                        const mirrorCol = mCols.find(c => c.type === "mirror" || c.id?.includes("lookup"));
                        if (mirrorCol) {
                            nombreMaterial = extractColText(mirrorCol);
                        }
                    }
                    if (!nombreMaterial) {
                        const textCol = mCols.find(c => c.type === "text" && extractColText(c));
                        if (textCol) {
                            nombreMaterial = extractColText(textCol);
                        }
                    }

                    // Si no se encuentra columna, usar mat.name
                    if (!nombreMaterial) {
                        nombreMaterial = mat.name;
                    }

                    // Formato: "1. NOMBRE DEL MATERIAL"
                    const nombreConNumero = (!isNaN(Number(mat.name)) && nombreMaterial !== mat.name)
                        ? `${mat.name}. ${nombreMaterial}`
                        : nombreMaterial;

                    // Extraer SKU y datos de Proveedor desde el catálogo consultado
                    let skuFinal = "";
                    let provPrincipalFinal = "SIN ASIGNAR";
                    let provAlternoFinal = "-";
                    let codProveedorFinal = "-";

                    const linkedArtId = relMaterialCol ? getLinkedIds(relMaterialCol)[0] : null;
                    let artInfo = null;
                    if (linkedArtId && articulosMap.has(String(linkedArtId))) {
                        artInfo = articulosMap.get(String(linkedArtId));
                    } else if (nombreMaterial && articulosMap.has(normalizeStr(nombreMaterial))) {
                        artInfo = articulosMap.get(normalizeStr(nombreMaterial));
                    }

                    if (artInfo) {
                        skuFinal = artInfo.sku || "";
                        provPrincipalFinal = artInfo.proveedorPrincipal || "SIN ASIGNAR";
                        provAlternoFinal = artInfo.proveedorAlterno || "-";
                        codProveedorFinal = artInfo.codigoProveedor || "-";
                    }

                    const cantUnit = extractColNumber(numCol, 1);
                    const unidad = extractColText(umCol) || "PZA";
                    const cantTotalMat = cantUnit * cantSubmodulo * cantidadEquipos;

                    const matObj = {
                        sku: skuFinal || "S/SKU",
                        codigoProveedor: codProveedorFinal || "-",
                        nombre: nombreConNumero,
                        nombreBase: nombreMaterial,
                        unidad,
                        cantUnitaria: cantUnit,
                        cantTotal: cantTotalMat,
                        proveedorPrincipal: provPrincipalFinal || "SIN ASIGNAR",
                        proveedorAlterno: provAlternoFinal || "-"
                    };

                    subItemObj.materiales.push(matObj);

                    // Consolidar en lista de compras/almacén agrupado por clave única (SKU o Nombre)
                    const claveConsolidado = skuFinal ? `${skuFinal}_${nombreMaterial}` : nombreMaterial;
                    if (consolidadoMateriales[claveConsolidado]) {
                        consolidadoMateriales[claveConsolidado].cantTotal += cantTotalMat;
                    } else {
                        consolidadoMateriales[claveConsolidado] = {
                            sku: skuFinal || "S/SKU",
                            codigoProveedor: codProveedorFinal || "-",
                            nombre: nombreMaterial,
                            unidad,
                            cantTotal: cantTotalMat,
                            proveedorPrincipal: provPrincipalFinal || "SIN ASIGNAR",
                            proveedorAlterno: provAlternoFinal || "-"
                        };
                    }
                }
            }

            desgloses.push(subItemObj);
        }

        console.log(`[Consolidación]: ${desgloses.length} submódulos procesados. ${Object.keys(consolidadoMateriales).length} materiales únicos consolidados.`);

        // =========================================================================
        // PASO 7: Generar el Documento PDF Oficial de Lista para Compras
        // =========================================================================
        console.log("[Paso 7]: Generando Lista de Compras en PDF (agrupada por proveedor)...");
        const arrayConsolidado = Object.values(consolidadoMateriales);

        const pdfBytes = await generateComprasReportPdf({
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
        const uploadRes = await uploadPdfToMonday(pulseId, token, pdfBytes, `LISTA_COMPRAS_${safeOrderFile}.pdf`);

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
// Función de diseño y generación del reporte PDF corporativo para Lista de Compras
async function generateComprasReportPdf({ orderName, producto, configNombre, configCodigo, cantidadEquipos, consolidado }) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]); // Tamaño Carta estándar
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Cargar e incrustar logotipo oficial
    let logoImage = null;
    try {
        const logoPath = path.resolve(process.cwd(), 'Logo-azul.png');
        if (fs.existsSync(logoPath)) {
            const logoBytes = fs.readFileSync(logoPath);
            logoImage = await pdfDoc.embedPng(logoBytes);
        }
    } catch (e) {
        console.warn("[PDF]: No se pudo cargar Logo-azul.png:", e.message);
    }

    const { width, height } = page.getSize();
    let y = height - 30;

    // Colores corporativos Transtools
    const primaryColor = rgb(13 / 255, 114 / 255, 183 / 255);       // Azul oficial #0D72B7
    const secondaryColor = rgb(0.10, 0.22, 0.38);                     // Azul marino institucional
    const headerBgLight = rgb(0.93, 0.96, 0.99);                      // Fondo tenue azul para tablas
    const alertAmberColor = rgb(0.85, 0.45, 0.12);                    // Ámbar/Naranja para ítems sin proveedor
    const darkGray = rgb(0.18, 0.18, 0.18);
    const lightGray = rgb(0.96, 0.97, 0.98);
    const borderColor = rgb(0.80, 0.84, 0.90);
    const white = rgb(1, 1, 1);

    const safeText = (text) => {
        if (!text) return "";
        return String(text)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "") // Quitar diacríticos/acentos
            .replace(/[^\x20-\x7E]/g, " ")     // Solo caracteres ASCII seguros para WinAnsi estándar
            .replace(/\s+/g, " ")
            .trim();
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
        const headerHeight = 44;
        
        // Caja superior blanca para logo y encabezado
        page.drawRectangle({
            x: 35,
            y: y - 10,
            width: width - 70,
            height: headerHeight,
            color: white,
            borderColor: borderColor,
            borderWidth: 0.8
        });

        // Línea de acento superior corporativa #0D72B7
        page.drawRectangle({
            x: 35,
            y: y + headerHeight - 13,
            width: width - 70,
            height: 3,
            color: primaryColor
        });

        // Logotipo Oficial
        if (logoImage) {
            const logoDims = logoImage.scaleToFit(140, 32);
            page.drawImage(logoImage, {
                x: 45,
                y: y - 4,
                width: logoDims.width,
                height: logoDims.height
            });
        }

        // Título del documento a la derecha
        const titleText = "LISTA DE MATERIALES PARA COMPRAS";
        const titleWidth = fontBold.widthOfTextAtSize(titleText, 11);
        page.drawText(titleText, {
            x: width - 45 - titleWidth,
            y: y + 9,
            size: 11,
            font: fontBold,
            color: primaryColor
        });

        const subtitleText = "REQUERIMIENTO CONSOLIDADO DE PRODUCCION";
        const subtitleWidth = fontRegular.widthOfTextAtSize(subtitleText, 7.5);
        page.drawText(subtitleText, {
            x: width - 45 - subtitleWidth,
            y: y - 2,
            size: 7.5,
            font: fontRegular,
            color: darkGray
        });

        y -= 48;

        // Metadatos de la Orden de Trabajo
        page.drawText(`Orden: ${safeText(orderName)}`, { x: 38, y, size: 9, font: fontBold, color: darkGray });
        page.drawText(`Fecha Emision: ${new Date().toLocaleDateString('es-MX')}`, { x: width - 165, y, size: 8.5, font: fontRegular, color: darkGray });
        y -= 13;

        const prodTxt = producto ? `Producto: ${safeText(producto)}` : "";
        page.drawText(prodTxt, { x: 38, y, size: 8.5, font: fontRegular, color: darkGray });
        page.drawText(`Cant. a Fabricar: ${cantidadEquipos} ${cantidadEquipos === 1 ? 'Equipo' : 'Equipos'}`, { x: width - 165, y, size: 9, font: fontBold, color: primaryColor });
        y -= 13;

        const confTxt = `Configuracion: ${safeText(configNombre)} (${safeText(configCodigo)})`;
        page.drawText(confTxt, { x: 38, y, size: 8.5, font: fontBold, color: primaryColor });
        page.drawText(`Partidas Totales: ${consolidado.length}`, { x: width - 165, y, size: 8.5, font: fontBold, color: darkGray });
        y -= 16;

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
    // AGRUPACIÓN INTELIGENTE POR PROVEEDOR PRINCIPAL
    // =========================================================================
    const gruposPorProveedor = {};
    for (const mat of consolidado) {
        const rawProv = (mat.proveedorPrincipal && String(mat.proveedorPrincipal).trim() !== "" && mat.proveedorPrincipal !== "SIN ASIGNAR")
            ? String(mat.proveedorPrincipal).trim()
            : "SIN PROVEEDOR ASIGNADO (POR COTIZAR)";
        if (!gruposPorProveedor[rawProv]) {
            gruposPorProveedor[rawProv] = [];
        }
        gruposPorProveedor[rawProv].push(mat);
    }

    // Ordenar alfabéticamente dejando "SIN PROVEEDOR ASIGNADO" al final
    const nombresProveedores = Object.keys(gruposPorProveedor).sort((a, b) => {
        const aSin = a.startsWith("SIN PROVEEDOR");
        const bSin = b.startsWith("SIN PROVEEDOR");
        if (aSin && !bSin) return 1;
        if (!aSin && bSin) return -1;
        return a.localeCompare(b, 'es');
    });

    // Ordenar materiales dentro de cada proveedor por nombre
    for (const p of nombresProveedores) {
        gruposPorProveedor[p].sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", 'es'));
    }

    // Función auxiliar para dibujar los encabezados de columnas de la tabla
    const drawTableColumnHeaders = () => {
        page.drawRectangle({
            x: 35,
            y: y - 3,
            width: width - 70,
            height: 14,
            color: headerBgLight
        });

        page.drawText("#", { x: 39, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("COD. PROVEEDOR", { x: 56, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("SKU INTERNO", { x: 135, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("DESCRIPCION DEL MATERIAL", { x: 200, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("U.M.", { x: 385, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("TOTAL REQ.", { x: 418, y: y + 2, size: 6.8, font: fontBold, color: primaryColor });
        page.drawText("PROV. ALTERNO", { x: 470, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("[ ]", { x: 558, y: y + 2, size: 6.8, font: fontBold, color: darkGray });

        page.drawLine({
            start: { x: 35, y: y - 3 },
            end: { x: width - 35, y: y - 3 },
            color: borderColor,
            thickness: 0.5
        });

        y -= 15;
    };

    let partidaGlobalContador = 0;

    for (const prov of nombresProveedores) {
        const itemsProv = gruposPorProveedor[prov];
        const isSinProveedor = prov.startsWith("SIN PROVEEDOR");

        // Espacio vertical mínimo requerido para banner + columnas + 1 renglón (~55 pt)
        if (y < 85) {
            page = pdfDoc.addPage([612, 792]);
            y = 750;
            drawHeader();
        }

        // Banner de encabezado del Proveedor
        page.drawRectangle({
            x: 35,
            y: y - 6,
            width: width - 70,
            height: 18,
            color: isSinProveedor ? alertAmberColor : primaryColor
        });

        const bannerTitle = isSinProveedor
            ? ">> MATERIALES SIN PROVEEDOR ASIGNADO (REQUIERE COTIZACION)"
            : `>> PROVEEDOR PRINCIPAL: ${safeText(prov).toUpperCase()}`;

        page.drawText(truncate(bannerTitle, 400, fontBold, 8), {
            x: 42,
            y: y,
            size: 8,
            font: fontBold,
            color: white
        });

        const countTxt = `${itemsProv.length} ${itemsProv.length === 1 ? 'partida' : 'partidas'}`;
        page.drawText(countTxt, {
            x: width - 110,
            y: y,
            size: 7.5,
            font: fontBold,
            color: white
        });

        y -= 21;

        // Encabezados de la tabla
        drawTableColumnHeaders();

        // Renglones de materiales del proveedor
        let subIndex = 0;
        for (const mat of itemsProv) {
            partidaGlobalContador++;
            subIndex++;

            if (y < 42) {
                page = pdfDoc.addPage([612, 792]);
                y = 750;
                drawHeader();
                drawTableColumnHeaders();
            }

            // Fondo alternado (cebra) para facilitar lectura
            if (subIndex % 2 === 0) {
                page.drawRectangle({
                    x: 35,
                    y: y - 3,
                    width: width - 70,
                    height: 13,
                    color: lightGray
                });
            }

            const numStr = String(partidaGlobalContador);
            const codProvStr = truncate(mat.codigoProveedor || "-", 72, fontRegular, 6.8);
            const skuStr = truncate(mat.sku || "S/SKU", 58, fontBold, 6.8);
            const descStr = truncate(mat.nombre, 180, fontRegular, 7);
            const umStr = safeText(mat.unidad);
            const cantStr = mat.cantTotal.toLocaleString('es-MX', { maximumFractionDigits: 2 });
            const altProvStr = truncate(mat.proveedorAlterno || "-", 82, fontRegular, 6.8);

            page.drawText(numStr, { x: 39, y, size: 6.8, font: fontRegular, color: darkGray });
            page.drawText(codProvStr, { x: 56, y, size: 6.8, font: fontRegular, color: darkGray });
            page.drawText(skuStr, { x: 135, y, size: 6.8, font: fontBold, color: primaryColor });
            page.drawText(descStr, { x: 200, y, size: 7, font: fontRegular, color: darkGray });
            page.drawText(umStr, { x: 385, y, size: 6.8, font: fontRegular, color: darkGray });
            page.drawText(cantStr, { x: 420, y, size: 7, font: fontBold, color: primaryColor });
            page.drawText(altProvStr, { x: 470, y, size: 6.8, font: fontRegular, color: rgb(0.35, 0.35, 0.35) });

            // Casilla de verificación para compras / almacén [ ]
            page.drawRectangle({
                x: 559,
                y: y - 1,
                width: 8,
                height: 8,
                borderColor: rgb(0.65, 0.65, 0.65),
                borderWidth: 0.7,
                color: white
            });

            // Línea divisoria suave
            page.drawLine({
                start: { x: 35, y: y - 3 },
                end: { x: width - 35, y: y - 3 },
                color: borderColor,
                thickness: 0.3
            });

            y -= 13;
        }

        y -= 8; // Separación entre proveedores
    }

    // =========================================================================
    // SECCIÓN FINAL: Resumen de Requisición y Cuadro de Firmas
    // =========================================================================
    if (y < 95) {
        page = pdfDoc.addPage([612, 792]);
        y = 750;
        drawHeader();
    }

    const totalProveedoresAsignados = nombresProveedores.filter(p => !p.startsWith("SIN PROVEEDOR")).length;
    const totalPiezasVal = consolidado.reduce((acc, m) => acc + (m.cantTotal || 0), 0);

    // Caja de Resumen
    page.drawRectangle({
        x: 35,
        y: y - 8,
        width: width - 70,
        height: 20,
        color: headerBgLight,
        borderColor: borderColor,
        borderWidth: 0.6
    });

    const summaryTxt = `RESUMEN DE REQUISICION:  ${totalProveedoresAsignados} Proveedores Asignados  |  ${consolidado.length} Partidas Unicas  |  ${totalPiezasVal.toLocaleString('es-MX', { maximumFractionDigits: 2 })} Unidades Requeridas`;
    page.drawText(summaryTxt, {
        x: 45,
        y: y - 2,
        size: 7.5,
        font: fontBold,
        color: primaryColor
    });

    y -= 38;

    // Firmas de Autorización
    const colWidth = (width - 70) / 3;
    const firmas = [
        { cargo: "SOLICITO", depto: "Ingenieria / Produccion" },
        { cargo: "REVISO", depto: "Almacen General" },
        { cargo: "AUTORIZO", depto: "Compras / Adquisiciones" }
    ];

    firmas.forEach((f, idx) => {
        const xBase = 35 + idx * colWidth + 15;
        const lineWidth = colWidth - 30;
        page.drawLine({
            start: { x: xBase, y: y },
            end: { x: xBase + lineWidth, y: y },
            color: rgb(0.4, 0.4, 0.4),
            thickness: 0.7
        });
        const cargoWidth = fontBold.widthOfTextAtSize(f.cargo, 7.5);
        page.drawText(f.cargo, {
            x: xBase + (lineWidth - cargoWidth) / 2,
            y: y - 10,
            size: 7.5,
            font: fontBold,
            color: darkGray
        });
        const deptoWidth = fontRegular.widthOfTextAtSize(f.depto, 6.8);
        page.drawText(f.depto, {
            x: xBase + (lineWidth - deptoWidth) / 2,
            y: y - 19,
            size: 6.8,
            font: fontRegular,
            color: rgb(0.45, 0.45, 0.45)
        });
    });

    // =========================================================================
    // NUMERACIÓN DE PÁGINAS (Página X de Y)
    // =========================================================================
    const allPages = pdfDoc.getPages();
    const totalPages = allPages.length;
    allPages.forEach((p, idx) => {
        const footerTxt = `Transtools - Requerimiento de Compras | Pagina ${idx + 1} de ${totalPages}`;
        const txtWidth = fontRegular.widthOfTextAtSize(footerTxt, 7);
        p.drawText(footerTxt, {
            x: (width - txtWidth) / 2,
            y: 15,
            size: 7,
            font: fontRegular,
            color: rgb(0.5, 0.5, 0.5)
        });
    });

    return await pdfDoc.save();
}

// Alias de compatibilidad
const generateBOMReportPdf = generateComprasReportPdf;