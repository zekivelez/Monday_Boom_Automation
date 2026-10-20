// services/bomFabricacionService.js
// Extracción de datos de la Orden de Fabricación (18433468914) y sus Submódulos desde Catálogo de Módulos (18432845727)

import {
    extractColText,
    extractColNumber,
    getLinkedIds,
    normalizeStr
} from './mondayClient.js';

export const BOARD_ORDENES_FABRICACION = "18434500734";
export const BOARD_MODULOS = "18432845727";
export const COLUMN_FILE_BOM = "file_mm7yxtgh";

const COLS_FRAGMENT = `column_values {
    id
    text
    value
    type
    ... on MirrorValue { display_value }
    ... on BoardRelationValue { display_value linked_item_ids linked_items { id name } }
}`;

/**
 * Consulta la Orden de Fabricación y los submódulos de cada módulo asignado
 */
export async function getOrdenFabricacionBomData(fetchMonday, orderItemId) {
    console.log(`[BOM Fabricación]: Consultando Orden de Fabricación ID ${orderItemId}...`);

    // 1. Consultar la Orden de Fabricación y sus subelementos (Módulos asignados)
    const queryOrder = `query ($itemId: [ID!]) {
        items (ids: $itemId) {
            id
            name
            board {
                id
                columns {
                    id
                    title
                    type
                }
            }
            ${COLS_FRAGMENT}
            subitems {
                id
                name
                ${COLS_FRAGMENT}
            }
        }
    }`;

    const resOrder = await fetchMonday(queryOrder, { itemId: [orderItemId] });
    const orderItem = resOrder.data?.items?.[0];

    if (!orderItem) {
        throw new Error(`No se encontró la Orden de Fabricación con ID: ${orderItemId}`);
    }

    const orderCols = orderItem.column_values || [];
    const boardCols = orderItem.board?.columns || [];

    const getVal = (colIdOrTitle) => {
        // 1. Buscar directamente por ID
        let col = orderCols.find(c => c.id === colIdOrTitle);
        if (!col) {
            // 2. Buscar por título exacto en las columnas del tablero
            const targetNorm = normalizeStr(colIdOrTitle);
            const boardCol = boardCols.find(b => {
                const titleNorm = normalizeStr(b.title || "");
                return titleNorm === targetNorm || titleNorm.includes(targetNorm);
            });
            if (boardCol) {
                col = orderCols.find(c => c.id === boardCol.id);
            }
        }
        return extractColText(col);
    };

    // Datos principales de la OF extraídos con los IDs exactos
    const nombreOrden = orderItem.name || "";
    const folio = getVal("ID ORDEN") || getVal("text_mm86c6s1") || (orderItem.name.match(/OF[0-9A-Za-z_-]+/i)?.[0]) || "OF-TRANSTOOLS";
    const codigoProducto = getVal("text_mm86hsh9") || getVal("CODIGO DE PRODUCTO");
    const codigoConfig = getVal("text_mm864yeg") || getVal("CODIGO DE CONFIGURACION");
    const catalogoConfig = getVal("board_relation_mm7xwz6z") || getVal("board_relation_mm86d06q") || getVal("CATALOGO DE PRODUCTOS");
    const cliente = getVal("board_relation_mm7xyyeq") || getVal("board_relation_mm864h7h") || getVal("CLIENTES");
    const grabado = getVal("text_mm866382") || getVal("GRABADO");
    const color = getVal("text_mm86dsk7") || getVal("CODIGO DE COLOR") || "BLANCO";
    const largo = getVal("text_mm86pff2") || getVal("LARGO");
    const ancho = getVal("text_mm86i0hh") || getVal("ANCHO");
    const alto = getVal("text_mm8639e4") || getVal("ALTO");
    const cantidadUnidades = extractColNumber(orderCols.find(c => c.id === "numeric_mm86z5h6" || normalizeStr(c.id).includes("cantidad")), 1);
    const niv = getVal("text_mm861tvd") || getVal("NIV");
    const anoModelo = getVal("text_mm86m3d4") || getVal("AÑO DEL MODELO") || "2027";
    const pesoVehicular = getVal("numeric_mm867a0t") || getVal("PESO VEHICULAR");
    const pesoBruto = getVal("numeric_mm862803") || getVal("PESO BRUTO");
    const cdePorEje = getVal("numeric_mm86b5h5") || getVal("CDE POR EJE");
    const observaciones = getVal("long_text_mm86e3sh") || getVal("OBSERVACIONES");
    const descripcionFactura = getVal("long_text_mm8653ty") || getVal("DESCRIPCION PARA FACTURA");

    // Columna exacta de archivo donde se pega el PDF según especificación
    const fileColumnId = COLUMN_FILE_BOM;
    console.log(`[BOM Fabricación]: Columna fija para guardar PDF: ID "${fileColumnId}" en tablero ${BOARD_ORDENES_FABRICACION}`);

    // 2. Extraer los subitems de la OF
    const rawSubitems = orderItem.subitems || [];
    console.log(`[BOM Fabricación]: ${rawSubitems.length} subelementos encontrados en la OF.`);

    const modulosProcesados = [];
    const moduloIdsToFetch = new Set();

    for (const sub of rawSubitems) {
        const sCols = sub.column_values || [];

        // Columna Link universal inyectada en Fase 1 (link_mm89bws8)
        const colLink = sCols.find(c => c.id === "link_mm89bws8") || sCols.find(c => c.type === "link");
        let linkUrl = "";

        if (colLink?.value) {
            try {
                const parsedLink = JSON.parse(colLink.value);
                linkUrl = parsedLink.url || "";
            } catch {}
        }
        if (!linkUrl && colLink?.text) {
            const urlMatch = colLink.text.match(/https?:\/\/[^\s"'<>]+/);
            linkUrl = urlMatch ? urlMatch[0] : colLink.text.trim();
        }

        // Relación con el módulo en el Catálogo de Módulos (18432845727)
        const colRelModulo = sCols.find(c => c.id === "board_relation_mm86h25y" || c.type === "board_relation");
        const linkedModuleIds = getLinkedIds(colRelModulo);
        let moduloId = linkedModuleIds[0] || null;

        // Respaldo: si el link URL trae el ID del pulso o item
        if (!moduloId && linkUrl) {
            const match = linkUrl.match(/(?:pulses|items)\/(\d+)/);
            if (match) moduloId = match[1];
        }

        if (moduloId && (!linkUrl || !linkUrl.startsWith("http"))) {
            linkUrl = `https://transtools-team.monday.com/items/${moduloId}`;
        }

        if (moduloId) {
            moduloIdsToFetch.add(String(moduloId));
        }

        const moduloNombre = extractColText(colRelModulo);

        modulosProcesados.push({
            subitemId: sub.id,
            nombreItem: sub.name,         // ej: "ESTRUCTURA CHASIS"
            moduloId,
            moduloNombre,                 // ej: "MODULO CHASIS PL40FT-M01/3E/2P"
            codigoModulo: "",             // se llenará de la consulta a 18432845727
            linkUrl,
            submodulos: []
        });
    }

    // 3. Consultar los Módulos en lote en el tablero CATÁLOGO DE MÓDULOS (18432845727)
    // para obtener sus subelementos (que son los SUBMÓDULOS / SUBENSAMBLES)
    if (moduloIdsToFetch.size > 0) {
        console.log(`[BOM Fabricación]: Consultando ${moduloIdsToFetch.size} módulos en Catálogo (18432845727)...`);
        const queryModulos = `query ($ids: [ID!]) {
            items (ids: $ids, limit: 100) {
                id
                name
                ${COLS_FRAGMENT}
                subitems {
                    id
                    name
                    ${COLS_FRAGMENT}
                }
            }
        }`;

        const resModulos = await fetchMonday(queryModulos, { ids: [...moduloIdsToFetch] });
        const modulosItems = resModulos.data?.items || [];
        const modulosMap = new Map(modulosItems.map(m => [String(m.id), m]));

        for (const mod of modulosProcesados) {
            if (!mod.moduloId) continue;
            const moduloItem = modulosMap.get(String(mod.moduloId));
            if (!moduloItem) continue;

            const mCols = moduloItem.column_values || [];
            // Código del módulo (ej: COD-EPL-001 o text)
            const codCol = mCols.find(c => normalizeStr(c.id || "").includes("codigo") || normalizeStr(c.text || "").includes("mod"));
            mod.codigoModulo = extractColText(codCol) || "";

            // Extraer sus subitems (SUBMÓDULOS)
            const subitems = moduloItem.subitems || [];
            for (const s of subitems) {
                const sc = s.column_values || [];
                // La columna SUBMODULOS (relación o texto)
                const colSubmodulo = sc.find(c => {
                    const idNorm = normalizeStr(c.id || "");
                    return idNorm.includes("submodulo") || c.type === "board_relation" || c.type === "text";
                });
                let submoduloNombre = extractColText(colSubmodulo);
                if (!submoduloNombre || submoduloNombre.trim() === '') {
                    submoduloNombre = s.name;
                }
                const cant = extractColNumber(sc.find(c => c.type === "numbers"), 1);
                const unidad = extractColText(sc.find(c => normalizeStr(c.id || "").includes("unidad") || c.type === "dropdown")) || "PZA";

                mod.submodulos.push({
                    id: s.id,
                    indice: !isNaN(Number(s.name)) ? s.name : "",
                    nombre: submoduloNombre,
                    cantidad: cant,
                    unidad
                });
            }
        }
    }

    return {
        orden: {
            id: orderItem.id,
            nombre: orderItem.name,
            folio,
            cliente,
            grabado,
            codigoProducto,
            codigoConfig,
            catalogoConfig,
            color,
            dimensiones: {
                largo: largo || "12.19 M",
                ancho: ancho || "2.60 M",
                alto: alto || "2.72 M"
            },
            cantidadUnidades: cantidadUnidades || 1,
            tecnico: {
                niv: niv || "PENDIENTE",
                anoModelo: anoModelo || "2027",
                pesoVehicular: pesoVehicular ? `${pesoVehicular} KG` : "7,700 KG",
                pesoBruto: pesoBruto ? `${pesoBruto} KG` : "47,700 KG",
                cdePorEje: cdePorEje ? `${cdePorEje} KG` : "10,300 KG"
            },
            observaciones: observaciones || "SIN OBSERVACIONES ESPECIALES",
            descripcionFactura,
            fileColumnId
        },
        modulos: modulosProcesados
    };
}
