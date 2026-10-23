// services/bomService.js
// Lógica de explosión recursiva y consolidación de BOM Modular -> Módulos -> Submódulos -> Artículos

import {
    normalizeStr,
    cleanCode,
    parseSecuenciaRank,
    extractColText,
    extractColNumber,
    getLinkedIds
} from './mondayClient.js';

export const BOARD_BOM_MODULAR = "18433468914"; // Tablero oficial actualizado
export const BOARD_MODULOS = "18432845727";
export const BOARD_SUBMODULOS = "18432844380";
export const BOARD_ARTICULOS = "18432236328";

const COLS_FRAGMENT = `column_values {
    id text value type
    ... on MirrorValue { display_value }
    ... on BoardRelationValue { display_value linked_item_ids linked_items { id name } }
}`;

export async function explodeBom({
    fetchMonday,
    configCodigoTecnico,
    configNombreVisible,
    productoSeleccionado,
    cantidadEquipos,
    orderSubitems = []
}) {
    // Helper para consultar ítems por ID (en bloques de 100)
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

    const STOP_WORDS = new Set(["bom", "modular", "de", "del", "la", "el", "1v1", "1v2", "1v3", "1v4", "1v5", "ev1", "ev2", "ev3", "ev4", "ev5"]);
    const tokens = (s) => normalizeStr(s).split(" ").filter(t => t && !STOP_WORDS.has(t));

    const refsModulos = [];

    // =========================================================================
    // ESTRATEGIA 1: Si la Orden de Fabricación ya tiene módulos asignados en sus subitems
    // =========================================================================
    if (orderSubitems && orderSubitems.length > 0) {
        console.log(`[Paso 2]: Analizando ${orderSubitems.length} subelementos asignados en la Orden de Fabricación...`);
        for (let idxSub = 0; idxSub < orderSubitems.length; idxSub++) {
            const sub = orderSubitems[idxSub];
            const sCols = sub.column_values || [];

            // Buscar relación al módulo en Catálogo de Módulos (board_relation_mm86h25y, type board_relation o título 'MODULOS')
            const colRel = sCols.find(c => c.id === "board_relation_mm86h25y" || c.type === "board_relation" || normalizeStr(c.title || "").includes("modulo"));
            const ids = getLinkedIds(colRel);
            let moduloId = ids[0] || null;

            // Respaldo por columna Link (link_mm89bws8, type link o título 'LINK')
            if (!moduloId) {
                const colLink = sCols.find(c => c.id === "link_mm89bws8" || c.type === "link" || normalizeStr(c.title || "").includes("link"));
                const urlText = colLink?.text || colLink?.value || "";
                const m = urlText.match(/(?:pulses|items)\/(\d+)/);
                if (m) moduloId = m[1];
            }

            if (moduloId) {
                const colCant = sCols.find(c => c.id === "numeric_mm8d34jm") ||
                                sCols.find(c => c.id?.toLowerCase().includes("mm8d34jm")) ||
                                sCols.find(c => normalizeStr(c.title || "").includes("cantidad") || normalizeStr(c.title || "").includes("calculad")) ||
                                sCols.find(c => c.type === "numbers" || c.type === "numeric");
                let cant = extractColNumber(colCant, 1);
                if (cant <= 0) cant = 1;
                const secSub = extractColText(sCols.find(c => c.id === "text_mm7snaqa" || normalizeStr(c.title || "").includes("secuencia")));
                console.log(`[explodeBom]: Módulo detectado en OF: "${sub.name}" -> ID: ${moduloId} (Cant: ${cant})`);
                refsModulos.push({
                    moduloId: String(moduloId),
                    cantidad: cant,
                    bomFila: sub.name,
                    secuenciaFabricacion: secSub || "",
                    posicionBom: (idxSub + 1) * 10
                });
            } else {
                console.warn(`[explodeBom]: Subelemento "${sub.name}" sin ID de módulo en columnas:`, sCols.map(c => ({ id: c.id, type: c.type, val: c.value })));
            }
        }
        if (refsModulos.length > 0) {
            console.log(`[Paso 2]: ¡Éxito! Se obtuvieron ${refsModulos.length} módulos directamente desde la Orden de Fabricación.`);
        }
    }

    // =========================================================================
    // ESTRATEGIA 2: Si no vinieron módulos en la OF, consultar BOM MODULAR (18433468914)
    // =========================================================================
    if (refsModulos.length === 0) {
        console.log(`[Paso 2]: Consultando catálogo BOM MODULAR (${BOARD_BOM_MODULAR})...`);
        const queryBom = `query {
            boards(ids: [${BOARD_BOM_MODULAR}]) {
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
        console.log(`[BOM MODULAR]: ${bomItems.length} filas en tablero. Columna CONFIGURACION="${colConfigBomId || "NO ENCONTRADA"}"`);

        // Log de diagnóstico de las opciones en BOM MODULAR para monitoreo
        console.log(`[BOM MODULAR Filas]:`, bomItems.slice(0, 10).map(i => ({
            name: i.name,
            cfg: extractColText(i.column_values?.find(c => c.id === colConfigBomId)),
            group: i.group?.title
        })));

        const targetClean = cleanCode(configCodigoTecnico);
        const targetTokens = new Set([...tokens(configNombreVisible), ...tokens(productoSeleccionado)]);

        let filasBom = bomItems.filter(item => {
            const cfg = extractColText(item.column_values?.find(c => c.id === colConfigBomId));
            const cfgClean = cleanCode(cfg);
            if (cfgClean && targetClean && cfgClean === targetClean) return true;
            if (cfg && normalizeStr(cfg) === normalizeStr(configNombreVisible)) return true;
            // Coincidencia parcial de código base (ej: PL-AD-40-3-AMF)
            if (cfgClean && targetClean && (targetClean.includes(cfgClean) || cfgClean.includes(targetClean))) return true;
            // Coincidencia de tokens relevantes
            const cfgTok = tokens(cfg);
            if (cfgTok.length >= 2 && cfgTok.every(t => targetTokens.has(t))) return true;
            // Respaldo por grupo
            const gTok = tokens(item.group?.title);
            return gTok.length > 0 && gTok.every(t => targetTokens.has(t));
        });

        if (filasBom.length === 0) {
            const disponiblesStr = bomItems.map(i => extractColText(i.column_values?.find(c => c.id === colConfigBomId)) || i.name).filter(Boolean).slice(0, 15).join(", ");
            throw new Error(`No se encontraron filas en BOM MODULAR para "${configCodigoTecnico}" / "${configNombreVisible}". Configuraciones en BOM MODULAR: [${disponiblesStr}]`);
        }

        console.log(`[BOM MODULAR]: ${filasBom.length} filas seleccionadas: ${filasBom.map(f => f.name).join(" | ")}`);

        for (let idxFila = 0; idxFila < filasBom.length; idxFila++) {
            const fila = filasBom[idxFila];
            const secFila = extractColText(fila.column_values?.find(c => c.id === "text_mm7snaqa" || normalizeStr(c.title || "").includes("secuencia")));
            
            const rawSubs = fila.subitems || [];
            if (rawSubs.length > 0) {
                for (let idxSub = 0; idxSub < rawSubs.length; idxSub++) {
                    const sub = rawSubs[idxSub];
                    const sCols = sub.column_values || [];
                    const secSub = extractColText(sCols.find(c => c.id === "text_mm7snaqa" || normalizeStr(c.title || "").includes("secuencia")));
                    const ids = getLinkedIds(sCols.find(c => c.id === "board_relation_mm7qyye2" || c.id === "board_relation_mm86h25y" || c.type === "board_relation"));
                    if (!ids.length) {
                        console.warn(`[BOM MODULAR]: Subelemento "${sub.name}" de "${fila.name}" no tiene MODULO vinculado.`);
                        continue;
                    }
                    const colCant = sCols.find(c => c.id === "numeric_mm8d34jm") ||
                                    sCols.find(c => c.id?.toLowerCase().includes("mm8d34jm")) ||
                                    sCols.find(c => normalizeStr(c.title || "").includes("cantidad") || normalizeStr(c.title || "").includes("calculad")) ||
                                    sCols.find(c => c.type === "numbers" || c.type === "numeric");
                    let cant = extractColNumber(colCant, 1);
                    if (cant <= 0) cant = 1;
                    const secuenciaFabricacion = secSub || secFila || "";
                    const posicionBom = (idxFila + 1) * 100 + (idxSub + 1);
                    ids.forEach(id => refsModulos.push({
                        moduloId: String(id),
                        cantidad: cant,
                        bomFila: fila.name,
                        secuenciaFabricacion,
                        posicionBom
                    }));
                }
            } else {
                // Si la fila no tiene subitems, extraer módulos vinculados en sus columnas de relación
                const rowRelCols = (fila.column_values || []).filter(c => c.type === "board_relation");
                for (const rCol of rowRelCols) {
                    const ids = getLinkedIds(rCol);
                    ids.forEach(id => refsModulos.push({
                        moduloId: String(id),
                        cantidad: 1,
                        bomFila: fila.name,
                        secuenciaFabricacion: secFila || "",
                        posicionBom: (idxFila + 1) * 100
                    }));
                }
            }
        }
    }

    if (refsModulos.length === 0) {
        throw new Error(`No se encontraron módulos vinculados para procesar la explosión de materiales.`);
    }

    // =========================================================================
    // PASO 3: MODULOS (18432845727) -> enlaces a SUBMODULOS
    // =========================================================================
    console.log(`[Paso 3]: Consultando ${refsModulos.length} módulos vinculados en MODULOS...`);
    const modulosItems = await fetchItemsByIds(refsModulos.map(r => r.moduloId));
    const modulosById = new Map(modulosItems.map(m => [String(m.id), m]));

    const refsSub = [];
    for (const ref of refsModulos) {
        const mod = modulosById.get(ref.moduloId);
        if (!mod) {
            console.warn(`[MODULOS]: No se pudo leer el módulo ${ref.moduloId} (fila BOM "${ref.bomFila}").`);
            continue;
        }
        const candidatos = [];
        for (const s of (mod.subitems || [])) {
            const cantCol = sc.find(c => c.id === "numeric_mm8d34jm") ||
                            sc.find(c => c.id === "numeric_mm7j6c8r") ||
                            sc.find(c => c.id?.toLowerCase().includes("mm8d34jm")) ||
                            sc.find(c => normalizeStr(c.title || "").includes("cantidad") || normalizeStr(c.title || "").includes("calculad")) ||
                            sc.find(c => c.type === "numbers" || c.type === "numeric");
            const cantSub = extractColNumber(cantCol, 1);
            sc.filter(c => c.type === "board_relation").forEach(c => {
                getLinkedIds(c).forEach(id => candidatos.push({ id, cant: cantSub }));
            });
        }
        candidatos.forEach(c => refsSub.push({
            submoduloId: c.id,
            cantidad: (c.cant > 0 ? c.cant : 1) * ref.cantidad,
            moduloNombre: mod.name,
            bomFila: ref.bomFila,
            secuenciaFabricacion: ref.secuenciaFabricacion || extractColText(mod.column_values?.find(col => col.id === "text_mm7snaqa")),
            posicionBom: ref.posicionBom
        }));
    }

    // =========================================================================
    // PASO 4: SUBMODULOS (18432844380) -> materiales en subelementos
    // =========================================================================
    console.log(`[Paso 4]: Consultando ${refsSub.length} enlaces a SUBMODULOS...`);
    const submodulosItems = (await fetchItemsByIds(refsSub.map(r => r.submoduloId)))
        .filter(it => String(it.board?.id) === BOARD_SUBMODULOS);
    const submodulosMapById = new Map(submodulosItems.map(s => [String(s.id), s]));

    const refsSubValidas = refsSub.filter(r => submodulosMapById.has(r.submoduloId));
    if (refsSubValidas.length === 0) {
        throw new Error(`Los módulos no tienen submódulos vinculados del tablero SUBMODULOS.`);
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

    const inferirFamilia = (sku, nombre) => {
        const s = String(sku || "").toUpperCase().trim();
        if (s.startsWith("AC") || s.startsWith("PTR") || s.startsWith("VIG") || s.startsWith("SOL") || s.startsWith("LAM") || s.startsWith("CAN")) return "ACEROS Y PERFILES";
        if (s.startsWith("TORN") || s.startsWith("TUER") || s.startsWith("ROND") || s.startsWith("PIJA")) return "TORNILLERIA Y FIJACION";
        if (s.startsWith("SNEU") || s.startsWith("VALV") || s.startsWith("MANG") || s.startsWith("CODO") || s.startsWith("NIPL")) return "NEUMATICA Y FRENOS";
        if (s.startsWith("SELE") || s.startsWith("CAB") || s.startsWith("PLAF")) return "ELECTRICO";
        if (s.startsWith("SUSP") || s.startsWith("EJE")) return "SUSPENSION Y EJES";
        if (s.startsWith("LYR") || s.startsWith("LLA") || s.startsWith("RIN")) return "LLANTAS Y RINES";
        if (s.startsWith("ACOP") || s.startsWith("QUIN") || s.startsWith("ARGO")) return "QUINTA RUEDA Y ACOPLE";
        if (s.startsWith("PUBL") || s.startsWith("CALC") || s.startsWith("ROT")) return "PUBLICIDAD Y ROTULOS";
        if (s.startsWith("CONS") || s.startsWith("SOLD") || s.startsWith("DISC")) return "CONSUMIBLES Y TALLER";
        if (s.startsWith("PINT")) return "PINTURA Y RECUBRIMIENTOS";

        const n = normalizeStr(nombre || "");
        if (n.includes("placa") || n.includes("solera") || n.includes("viga") || n.includes("canal") || n.includes("ptr") || n.includes("lamina") || n.includes("angulo") || n.includes("redondo") || n.includes("acero")) return "ACEROS Y PERFILES";
        if (n.includes("tornillo") || n.includes("tuerca") || n.includes("rondana") || n.includes("pija") || n.includes("remache") || n.includes("birlo")) return "TORNILLERIA Y FIJACION";
        if (n.includes("valvula") || n.includes("manguera") || n.includes("freno") || n.includes("bushing") || n.includes("codo") || n.includes("conector") || n.includes("niple") || n.includes("tanque de aire") || n.includes("manita") || n.includes("grifo") || n.includes("inserto") || n.includes("tubo de nylon") || n.includes("tee")) return "NEUMATICA Y FRENOS";
        if (n.includes("cable") || n.includes("plafon") || n.includes("electrico") || n.includes("luces") || n.includes("foco") || n.includes("calavera") || n.includes("poliflex")) return "ELECTRICO";
        if (n.includes("eje") || n.includes("suspension") || n.includes("muelle") || n.includes("balero") || n.includes("matraca")) return "SUSPENSION Y EJES";
        if (n.includes("llanta") || n.includes("rin")) return "LLANTAS Y RINES";
        if (n.includes("quinta") || n.includes("argolla") || n.includes("perno rey")) return "QUINTA RUEDA Y ACOPLE";
        if (n.includes("calcomania") || n.includes("cinta reflejante") || n.includes("logo") || n.includes("rotulo") || n.includes("placa de identificacion") || n.includes("publicidad") || n.includes("tope")) return "PUBLICIDAD Y ROTULOS";
        if (n.includes("disco") || n.includes("electrodo") || n.includes("argon") || n.includes("alambre") || n.includes("micro alambre") || n.includes("teflon") || n.includes("cincho") || n.includes("boquilla") || n.includes("anillo distribuidor") || n.includes("escudo")) return "CONSUMIBLES Y TALLER";
        if (n.includes("pintura") || n.includes("thinner") || n.includes("primer") || n.includes("esmalte")) return "PINTURA Y RECUBRIMIENTOS";

        return "GENERAL / VARIOS";
    };

    console.log(`[Paso 5]: Consultando SKUs y Proveedores para ${todosMaterialesIds.length} materiales en Catálogo (${BOARD_ARTICULOS})...`);
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

        const famCol = art.column_values?.find(c => {
            const idNorm = normalizeStr(c.id || "");
            return idNorm.includes("familia") || idNorm.includes("categoria") || idNorm.includes("tipo");
        });
        const famDirecta = extractColText(famCol) || (art.group?.title && !normalizeStr(art.group.title).includes("grupo") && !normalizeStr(art.group.title).includes("articulos") ? art.group.title : "");
        const familiaVal = famDirecta || inferirFamilia(skuVal, art.name);

        const artData = {
            id: art.id,
            name: art.name,
            sku: skuVal || "",
            familia: familiaVal,
            proveedorPrincipal: provPrincipalVal || "SIN ASIGNAR",
            proveedorAlterno: provAlternoVal || "-",
            codigoProveedor: codProvVal || "-"
        };

        articulosMap.set(String(art.id), artData);
        if (skuVal) {
            articulosMap.set(normalizeStr(art.name), artData);
        }
    });
    console.log(`[ARTICULOS]: ${articulosMap.size} artículos indexados con SKU, Familia y Proveedores.`);

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
        const secEntrada = entrada.secuenciaFabricacion || extractColText(subCols.find(col => col.id === "text_mm7snaqa"));

        const subItemObj = {
            filaNumero: String(filaContador),
            moduloNombre: entrada.moduloNombre,
            submoduloNombre: submoduloEncontrado.name,
            codigo: codigoSub,
            cantidadPorEquipo: cantSubmodulo,
            cantidadTotalParaOrden: cantSubmodulo * cantidadEquipos,
            secuenciaFabricacion: secEntrada,
            materiales: []
        };

        if (submoduloEncontrado?.subitems && submoduloEncontrado.subitems.length > 0) {
            for (const mat of submoduloEncontrado.subitems) {
                const mCols = mat.column_values || [];
                const secMaterial = extractColText(mCols.find(col => col.id === "text_mm7snaqa")) || secEntrada;
                const numCol = mCols.find(c => c.id === "numeric_mm8d34jm") ||
                               mCols.find(c => c.id === "numeric_mm7jbpty") ||
                               mCols.find(c => c.id?.toLowerCase().includes("mm8d34jm")) ||
                               mCols.find(c => normalizeStr(c.title || "").includes("cantidad") || normalizeStr(c.title || "").includes("calculad")) ||
                               mCols.find(c => c.type === "numbers" || c.type === "numeric");
                const umCol = mCols.find(c => c.id?.includes("unidad") || c.id?.includes("medida") || c.type === "text" || c.type === "dropdown");

                const relMaterialCol = mCols.find(c => c.id === "board_relation_mm7jcgm0") || mCols.find(c => c.type === "board_relation");
                let nombreMaterial = "";
                if (relMaterialCol) {
                    if (relMaterialCol.linked_items && relMaterialCol.linked_items.length > 0) {
                        nombreMaterial = relMaterialCol.linked_items.map(li => li.name).filter(Boolean).join(", ");
                    }
                    if (!nombreMaterial) {
                        nombreMaterial = extractColText(relMaterialCol);
                    }
                }

                if (!nombreMaterial) {
                    const mirrorCol = mCols.find(c => c.type === "mirror" || c.id?.includes("lookup"));
                    if (mirrorCol) nombreMaterial = extractColText(mirrorCol);
                }
                if (!nombreMaterial) {
                    const textCol = mCols.find(c => c.type === "text" && extractColText(c));
                    if (textCol) nombreMaterial = extractColText(textCol);
                }
                if (!nombreMaterial) {
                    nombreMaterial = mat.name;
                }

                const nombreConNumero = (!isNaN(Number(mat.name)) && nombreMaterial !== mat.name)
                    ? `${mat.name}. ${nombreMaterial}`
                    : nombreMaterial;

                let skuFinal = "";
                let provPrincipalFinal = "SIN ASIGNAR";
                let provAlternoFinal = "-";
                let codProveedorFinal = "-";
                let familiaFinal = "";

                const linkedArtId = relMaterialCol ? getLinkedIds(relMaterialCol)[0] : null;
                let artInfo = null;
                if (linkedArtId && articulosMap.has(String(linkedArtId))) {
                    artInfo = articulosMap.get(String(linkedArtId));
                } else if (nombreMaterial && articulosMap.has(normalizeStr(nombreMaterial))) {
                    artInfo = articulosMap.get(normalizeStr(nombreMaterial));
                }

                if (artInfo) {
                    skuFinal = artInfo.sku || "";
                    familiaFinal = artInfo.familia || "";
                    provPrincipalFinal = artInfo.proveedorPrincipal || "SIN ASIGNAR";
                    provAlternoFinal = artInfo.proveedorAlterno || "-";
                    codProveedorFinal = artInfo.codigoProveedor || "-";
                }

                if (!familiaFinal) {
                    familiaFinal = inferirFamilia(skuFinal, nombreMaterial);
                }

                const cantUnit = extractColNumber(numCol, 1);
                const unidad = extractColText(umCol) || "PZA";
                const cantTotalMat = cantUnit * cantSubmodulo * cantidadEquipos;

                const matObj = {
                    articuloId: linkedArtId || (artInfo ? artInfo.id : null),
                    sku: skuFinal || "S/SKU",
                    codigoProveedor: codProveedorFinal || "-",
                    nombre: nombreConNumero,
                    nombreBase: nombreMaterial,
                    familia: familiaFinal,
                    unidad,
                    cantUnitaria: cantUnit,
                    cantTotal: cantTotalMat,
                    proveedorPrincipal: provPrincipalFinal || "SIN ASIGNAR",
                    proveedorAlterno: provAlternoFinal || "-",
                    secuenciaFabricacion: secMaterial,
                    posicionBom: entrada.posicionBom
                };

                subItemObj.materiales.push(matObj);

                // Consolidar en lista de compras agrupado por clave única (SKU o Nombre)
                const claveConsolidado = skuFinal ? `${skuFinal}_${nombreMaterial}` : nombreMaterial;
                if (consolidadoMateriales[claveConsolidado]) {
                    consolidadoMateriales[claveConsolidado].cantTotal += cantTotalMat;
                    const prevRank = parseSecuenciaRank(consolidadoMateriales[claveConsolidado].secuenciaFabricacion, consolidadoMateriales[claveConsolidado].posicionBom);
                    const newRank = parseSecuenciaRank(secMaterial, entrada.posicionBom);
                    if (newRank < prevRank) {
                        consolidadoMateriales[claveConsolidado].secuenciaFabricacion = secMaterial;
                        consolidadoMateriales[claveConsolidado].posicionBom = entrada.posicionBom;
                    }
                } else {
                    consolidadoMateriales[claveConsolidado] = {
                        articuloId: linkedArtId || (artInfo ? artInfo.id : null),
                        sku: skuFinal || "S/SKU",
                        codigoProveedor: codProveedorFinal || "-",
                        nombre: nombreMaterial,
                        familia: familiaFinal,
                        unidad,
                        cantTotal: cantTotalMat,
                        proveedorPrincipal: provPrincipalFinal || "SIN ASIGNAR",
                        proveedorAlterno: provAlternoFinal || "-",
                        secuenciaFabricacion: secMaterial,
                        posicionBom: entrada.posicionBom
                    };
                }
            }
        }

        desgloses.push(subItemObj);
    }

    const arrayConsolidado = Object.values(consolidadoMateriales);
    console.log(`[Consolidación]: ${desgloses.length} submódulos procesados. ${arrayConsolidado.length} materiales únicos consolidados.`);

    return {
        desgloses,
        consolidado: arrayConsolidado,
        articulosMap
    };
}
