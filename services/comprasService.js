// services/comprasService.js
// Integración para poblar el tablero de SOLICITUDES DE COMPRA en Monday.com

import { parseSecuenciaRank } from './mondayClient.js';

export const BOARD_SOLICITUDES_COMPRA = "18434424067";

/**
 * Registra o sincroniza las partidas consolidadas en el tablero "SOLICITUDES DE COMPRA"
 */
export async function syncSolicitudesDeCompra({
    fetchMonday,
    orderName,
    producto,
    configNombre,
    configCodigo,
    consolidado
}) {
    console.log(`[SOLICITUDES DE COMPRA]: Iniciando registro de ${consolidado.length} partidas en tablero ${BOARD_SOLICITUDES_COMPRA}...`);

    // 1. Obtener grupos existentes en el tablero
    const boardQuery = `query {
        boards(ids: [${BOARD_SOLICITUDES_COMPRA}]) {
            groups { id title }
        }
    }`;
    const boardRes = await fetchMonday(boardQuery);
    const existingGroups = boardRes.data?.boards?.[0]?.groups || [];

    const targetGroupTitle = `OF: ${orderName} (${producto || 'EQUIPO'})`;
    let targetGroupId = existingGroups.find(g => g.title?.trim().toLowerCase() === targetGroupTitle.toLowerCase())?.id;

    // Si no existe el grupo para la orden, crearlo
    if (!targetGroupId) {
        try {
            const createGroupMutation = `mutation ($boardId: ID!, $groupName: String!) {
                create_group (board_id: $boardId, group_name: $groupName) {
                    id
                }
            }`;
            const groupRes = await fetchMonday(createGroupMutation, {
                boardId: BOARD_SOLICITUDES_COMPRA,
                groupName: targetGroupTitle
            });
            targetGroupId = groupRes.data?.create_group?.id;
            console.log(`[SOLICITUDES DE COMPRA]: Creado nuevo grupo "${targetGroupTitle}" (ID: ${targetGroupId})`);
        } catch (e) {
            console.warn(`[SOLICITUDES DE COMPRA]: No se pudo crear grupo dedicado, usando grupo por defecto:`, e.message);
            targetGroupId = existingGroups[0]?.id || "topics";
        }
    } else {
        console.log(`[SOLICITUDES DE COMPRA]: Usando grupo existente "${targetGroupTitle}" (ID: ${targetGroupId})`);
    }

    // 2. Ordenar las partidas por SECUENCIA DE FABRICACION antes de crearlas
    const partidasOrdenadas = [...consolidado].sort((a, b) => {
        const rankA = parseSecuenciaRank(a.secuenciaFabricacion, a.posicionBom);
        const rankB = parseSecuenciaRank(b.secuenciaFabricacion, b.posicionBom);
        if (rankA !== rankB) return rankA - rankB;
        return (a.nombre || "").localeCompare(b.nombre || "", 'es');
    });

    const todayStr = new Date().toISOString().split('T')[0];
    const itemsCreados = [];
    const errores = [];

    // 3. Crear cada partida en el tablero
    for (let i = 0; i < partidasOrdenadas.length; i++) {
        const mat = partidasOrdenadas[i];
        const itemName = mat.sku && mat.sku !== "S/SKU" 
            ? `${mat.sku} - ${mat.nombre}`
            : mat.nombre;

        const colValuesObj = {};

        // OF RELACIONADA
        if (orderName) {
            colValuesObj["text_mm7xyyhr"] = String(orderName);
        }

        // PRODUCTO / CONFIGURACIÓN
        colValuesObj["text_mm7xy0s5"] = `${producto || ''} ${configNombre ? '| ' + configNombre : ''}`.trim();

        // BOM DE FABRICACIÓN
        if (configCodigo) {
            colValuesObj["text_mm7xn7jy"] = String(configCodigo);
        }

        // CANTIDAD REQUERIDA
        if (mat.cantTotal !== undefined && mat.cantTotal !== null) {
            colValuesObj["numeric_mm7xthfb"] = Number(mat.cantTotal);
        }

        // PROVEEDOR
        if (mat.proveedorPrincipal && mat.proveedorPrincipal !== "SIN ASIGNAR" && mat.proveedorPrincipal !== "-") {
            colValuesObj["text_mm7xxmqp"] = String(mat.proveedorPrincipal);
        }

        // FECHA SOLICITUD
        colValuesObj["date_mm7xytge"] = { date: todayStr };

        // RELACIÓN CON ARTÍCULOS (si tiene ID del catálogo)
        if (mat.articuloId) {
            colValuesObj["board_relation_mm7x4419"] = { item_ids: [Number(mat.articuloId)] };
        }

        // OBSERVACIONES
        if (mat.secuenciaFabricacion) {
            colValuesObj["long_text_mm7xeqbm"] = { text: `Secuencia de Fabricación: ${mat.secuenciaFabricacion}` };
        }

        const createItemMutation = `mutation ($boardId: ID!, $groupId: String, $itemName: String!, $columnValues: JSON!) {
            create_item (
                board_id: $boardId,
                group_id: $groupId,
                item_name: $itemName,
                column_values: $columnValues
            ) {
                id
                name
            }
        }`;

        try {
            const resp = await fetchMonday(createItemMutation, {
                boardId: BOARD_SOLICITUDES_COMPRA,
                groupId: targetGroupId,
                itemName: itemName.slice(0, 255),
                columnValues: JSON.stringify(colValuesObj)
            });

            if (resp.data?.create_item?.id) {
                itemsCreados.push(resp.data.create_item.id);
            } else if (resp.errors) {
                console.error(`[SOLICITUDES DE COMPRA]: Error en partida "${itemName}":`, JSON.stringify(resp.errors));
                errores.push({ item: itemName, error: resp.errors });
            }
        } catch (err) {
            console.error(`[SOLICITUDES DE COMPRA]: Excepción al crear "${itemName}":`, err.message);
            errores.push({ item: itemName, error: err.message });
        }

        // Pequeño descanso de 50ms para no saturar la cuota de Monday
        if (i % 10 === 0 && i > 0) {
            await new Promise(r => setTimeout(r, 60));
        }
    }

    console.log(`[SOLICITUDES DE COMPRA]: Proceso terminado. ${itemsCreados.length} ítems creados con éxito, ${errores.length} errores.`);

    return {
        grupoId: targetGroupId,
        totalCreados: itemsCreados.length,
        totalErrores: errores.length,
        itemsIds: itemsCreados
    };
}
