// services/excelService.js
// Generador del archivo Excel (.xlsx) corporativo para Lista de Compras Transtools

import ExcelJS from 'exceljs';
import { normalizeStr, parseSecuenciaRank } from './mondayClient.js';

// Criterio de ordenamiento por familia (exactamente idéntico al PDF)
const getFamiliaRank = (fam, sku, nombre) => {
    const fNorm = normalizeStr(fam || "");
    const sNorm = normalizeStr(sku || "");
    const nNorm = normalizeStr(nombre || "");

    // 0. ACEROS Y PERFILES
    if (
        fNorm.includes("acero") || fNorm.includes("perfil") || fNorm.includes("placa") ||
        fNorm.includes("lamina") || fNorm.includes("solera") || fNorm.includes("ptr") ||
        fNorm.includes("viga") || fNorm.includes("canal") || fNorm.includes("aluminio") ||
        sNorm.startsWith("ac") || sNorm.startsWith("ptr") || sNorm.startsWith("sol") || sNorm.startsWith("pla") ||
        nNorm.includes("placa") || nNorm.includes("solera") || nNorm.includes("ptr") || nNorm.includes("lamina negra")
    ) {
        return 0;
    }

    // 1. SUSPENSION Y EJES
    if (fNorm.includes("suspension") || fNorm.includes("eje") || sNorm.startsWith("susp") || nNorm.includes("suspension") || nNorm.includes("eje 77")) {
        return 1;
    }

    // 2. QUINTA RUEDA Y ACOPLADORES
    if (fNorm.includes("acopla") || fNorm.includes("quinta") || fNorm.includes("argolla") || sNorm.startsWith("acop") || nNorm.includes("quinta rueda") || nNorm.includes("argolla")) {
        return 2;
    }

    // 3. LLANTAS Y RINES
    if (fNorm.includes("llanta") || fNorm.includes("rin") || sNorm.startsWith("lyr") || sNorm.startsWith("llaa") || nNorm.includes("llanta") || nNorm.includes("rin de")) {
        return 3;
    }

    // 4. SISTEMAS NEUMATICOS Y FRENOS
    if (fNorm.includes("neumat") || fNorm.includes("freno") || sNorm.startsWith("sneu") || nNorm.includes("valvula") || nNorm.includes("manguera") || nNorm.includes("bushing") || nNorm.includes("codo") || nNorm.includes("conector") || nNorm.includes("niple") || nNorm.includes("tanque de aire")) {
        return 4;
    }

    // 5. SISTEMAS ELECTRICOS
    if (fNorm.includes("electr") || sNorm.startsWith("sele") || nNorm.includes("cable") || nNorm.includes("plafon") || nNorm.includes("poliflex")) {
        return 5;
    }

    // 6. TORNILLERIA Y FIJACION
    if (fNorm.includes("tornill") || fNorm.includes("fijac") || sNorm.startsWith("torn") || nNorm.includes("tornillo") || nNorm.includes("tuerca") || nNorm.includes("rondana") || nNorm.includes("remache")) {
        return 6;
    }

    // 7. CONSUMIBLES DE TALLER
    if (fNorm.includes("consumible") || fNorm.includes("taller") || sNorm.startsWith("cons") || nNorm.includes("disco") || nNorm.includes("electrodo") || nNorm.includes("alambre") || nNorm.includes("argon")) {
        return 7;
    }

    // 8. PINTURA Y RECUBRIMIENTOS
    if (fNorm.includes("pintur") || sNorm.startsWith("pint") || nNorm.includes("pintura") || nNorm.includes("thinner")) {
        return 8;
    }

    // 9. PUBLICIDAD Y ROTULOS
    if (fNorm.includes("publicidad") || fNorm.includes("rotul") || sNorm.startsWith("publ") || nNorm.includes("calcomania") || nNorm.includes("cinta reflejante") || nNorm.includes("placa de identificacion") || nNorm.includes("tope")) {
        return 9;
    }

    return 99;
};

/**
 * Genera un Buffer Excel (.xlsx) altamente estilizado con la lista de compras consolidada.
 */
export async function generateComprasReportExcel({
    orderName,
    producto,
    configNombre,
    configCodigo,
    cantidadEquipos,
    consolidado
}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Transtools Automation';
    workbook.lastModifiedBy = 'Transtools Compras';
    workbook.created = new Date();
    workbook.modified = new Date();

    const sheet = workbook.addWorksheet('Lista de Compras', {
        pageSetup: {
            paperSize: 9, // A4 / Carta
            orientation: 'landscape',
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0
        },
        views: [{ showGridLines: true }]
    });

    // 1. Paleta de colores corporativa Transtools
    const colorPrimary = 'FF0D72B7';   // #0D72B7 Azul corporativo oficial
    const colorDarkBlue = 'FF0A4B78';  // Azul marino de acento
    const colorLightBg = 'FFF4F8FC';   // Fondo suave azulado para filas pares
    const colorBorder = 'FFCBD5E1';    // Gris suave para bordes
    const colorHeaderBorder = 'FF083D61';

    // 2. Encabezado institucional (Filas 1 a 6)
    // Título Principal
    sheet.mergeCells('A1:J1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'TRANSTOOLS REMOLQUES - LISTA CONSOLIDADA DE MATERIALES PARA COMPRAS';
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPrimary } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(1).height = 32;

    // Subtítulo
    sheet.mergeCells('A2:J2');
    const subCell = sheet.getCell('A2');
    subCell.value = 'REQUERIMIENTO CONSOLIDADO DE PRODUCCION / EXPLOSION DE MATERIALES';
    subCell.font = { name: 'Calibri', size: 9, bold: true, color: { argb: 'FF475569' } };
    subCell.alignment = { horizontal: 'center', vertical: 'middle' };
    sheet.getRow(2).height = 18;

    // Fila 3 y 4: Metadatos de la Orden
    sheet.getCell('A3').value = 'Orden de Fabricación:';
    sheet.getCell('A3').font = { bold: true, color: { argb: 'FF334155' } };
    sheet.mergeCells('B3:D3');
    sheet.getCell('B3').value = orderName || '-';
    sheet.getCell('B3').font = { bold: true, color: { argb: colorDarkBlue } };

    sheet.getCell('F3').value = 'Fecha de Emisión:';
    sheet.getCell('F3').font = { bold: true, color: { argb: 'FF334155' } };
    sheet.mergeCells('G3:H3');
    sheet.getCell('G3').value = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

    sheet.getCell('A4').value = 'Producto:';
    sheet.getCell('A4').font = { bold: true, color: { argb: 'FF334155' } };
    sheet.mergeCells('B4:D4');
    sheet.getCell('B4').value = producto || '-';

    sheet.getCell('F4').value = 'Cant. a Fabricar:';
    sheet.getCell('F4').font = { bold: true, color: { argb: 'FF334155' } };
    sheet.mergeCells('G4:H4');
    sheet.getCell('G4').value = `${cantidadEquipos || 1} ${cantidadEquipos === 1 ? 'Equipo' : 'Equipos'}`;
    sheet.getCell('G4').font = { bold: true, color: { argb: colorPrimary } };

    sheet.getCell('A5').value = 'Configuración:';
    sheet.getCell('A5').font = { bold: true, color: { argb: 'FF334155' } };
    sheet.mergeCells('B5:D5');
    sheet.getCell('B5').value = `${configNombre || ''} (${configCodigo || ''})`.trim();

    sheet.getCell('F5').value = 'Partidas Totales:';
    sheet.getCell('F5').font = { bold: true, color: { argb: 'FF334155' } };
    sheet.mergeCells('G5:H5');
    sheet.getCell('G5').value = consolidado.length;
    sheet.getCell('G5').font = { bold: true };

    sheet.getRow(3).height = 18;
    sheet.getRow(4).height = 18;
    sheet.getRow(5).height = 18;
    sheet.getRow(6).height = 8; // Separador en blanco

    // 3. Encabezados de la Tabla de Datos (Fila 7)
    const headers = [
        { key: 'partida', header: '#', width: 6 },
        { key: 'codProv', header: 'COD. PROV.', width: 16 },
        { key: 'sku', header: 'SKU', width: 14 },
        { key: 'descripcion', header: 'DESCRIPCION COMPLETA DEL MATERIAL', width: 48 },
        { key: 'familia', header: 'FAMILIA / TIPO', width: 22 },
        { key: 'um', header: 'U.M.', width: 10 },
        { key: 'total', header: 'CANTIDAD REQUERIDA', width: 18 },
        { key: 'provSug', header: 'PROVEEDOR SUGERIDO', width: 26 },
        { key: 'provAlt', header: 'PROVEEDOR ALTERNO', width: 22 },
        { key: 'secuencia', header: 'SECUENCIA FABRICACION', width: 24 }
    ];

    const headerRowNumber = 7;
    const headerRow = sheet.getRow(headerRowNumber);
    headerRow.height = 26;

    headers.forEach((col, idx) => {
        sheet.getColumn(idx + 1).width = col.width;
        const cell = headerRow.getCell(idx + 1);
        cell.value = col.header;
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorPrimary } };
        cell.alignment = {
            horizontal: (col.key === 'descripcion' || col.key === 'provSug' || col.key === 'provAlt') ? 'left' : (col.key === 'total' ? 'right' : 'center'),
            vertical: 'middle',
            wrapText: true
        };
        cell.border = {
            top: { style: 'thin', color: { argb: colorHeaderBorder } },
            bottom: { style: 'medium', color: { argb: colorHeaderBorder } },
            left: { style: 'thin', color: { argb: colorHeaderBorder } },
            right: { style: 'thin', color: { argb: colorHeaderBorder } }
        };
    });

    // 4. Ordenar partidas con el mismo algoritmo del PDF
    const itemsOrdenados = [...consolidado].sort((a, b) => {
        const rankSecA = parseSecuenciaRank(a.secuenciaFabricacion, a.posicionBom);
        const rankSecB = parseSecuenciaRank(b.secuenciaFabricacion, b.posicionBom);

        if (rankSecA !== rankSecB) return rankSecA - rankSecB;

        if (a.secuenciaFabricacion && b.secuenciaFabricacion && a.secuenciaFabricacion !== b.secuenciaFabricacion) {
            const cmp = a.secuenciaFabricacion.localeCompare(b.secuenciaFabricacion, 'es', { numeric: true });
            if (cmp !== 0) return cmp;
        }

        const rankFamA = getFamiliaRank(a.familia, a.sku, a.nombre);
        const rankFamB = getFamiliaRank(b.familia, b.sku, b.nombre);
        if (rankFamA !== rankFamB) return rankFamA - rankFamB;

        return (a.nombre || "").localeCompare(b.nombre || "", 'es');
    });

    // 5. Poblar las filas de datos
    let currentRowNum = headerRowNumber + 1;
    let partidaNum = 0;

    for (const mat of itemsOrdenados) {
        partidaNum++;
        const row = sheet.getRow(currentRowNum);
        const isEven = partidaNum % 2 === 0;

        const cellPartida = row.getCell(1);
        cellPartida.value = partidaNum;
        cellPartida.alignment = { horizontal: 'center', vertical: 'middle' };

        const cellCodProv = row.getCell(2);
        cellCodProv.value = mat.codigoProveedor && mat.codigoProveedor !== '-' ? String(mat.codigoProveedor).trim() : '-';
        cellCodProv.alignment = { horizontal: 'center', vertical: 'middle' };

        const cellSku = row.getCell(3);
        cellSku.value = mat.sku && mat.sku !== 'S/SKU' ? String(mat.sku).trim() : '-';
        cellSku.font = { bold: true, color: { argb: colorPrimary } };
        cellSku.alignment = { horizontal: 'center', vertical: 'middle' };

        // DESCRIPCIÓN COMPLETA DEL MATERIAL (SIN RECORTES)
        const cellDesc = row.getCell(4);
        cellDesc.value = String(mat.nombre || '').trim();
        cellDesc.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };

        const cellFam = row.getCell(5);
        cellFam.value = mat.familia || 'GENERAL';
        cellFam.alignment = { horizontal: 'left', vertical: 'middle' };

        const cellUm = row.getCell(6);
        cellUm.value = mat.unidad || 'PZA';
        cellUm.alignment = { horizontal: 'center', vertical: 'middle' };

        const cellTotal = row.getCell(7);
        cellTotal.value = Number(mat.cantTotal || 0);
        cellTotal.numFmt = '#,##0.00';
        cellTotal.font = { bold: true, color: { argb: 'FF1E293B' } };
        cellTotal.alignment = { horizontal: 'right', vertical: 'middle' };

        const cellProvSug = row.getCell(8);
        const tieneProv = Boolean(mat.proveedorPrincipal && mat.proveedorPrincipal !== "SIN ASIGNAR" && mat.proveedorPrincipal !== "-");
        cellProvSug.value = tieneProv ? mat.proveedorPrincipal.trim() : 'POR ASIGNAR';
        cellProvSug.font = { color: { argb: tieneProv ? 'FF1E293B' : 'FFD97706' }, italic: !tieneProv };
        cellProvSug.alignment = { horizontal: 'left', vertical: 'middle' };

        const cellProvAlt = row.getCell(9);
        cellProvAlt.value = mat.proveedorAlterno && mat.proveedorAlterno !== '-' ? mat.proveedorAlterno.trim() : '-';
        cellProvAlt.alignment = { horizontal: 'left', vertical: 'middle' };

        const cellSec = row.getCell(10);
        cellSec.value = mat.secuenciaFabricacion || '-';
        cellSec.alignment = { horizontal: 'center', vertical: 'middle' };

        // Estilos de bordes y fondo alternado
        for (let c = 1; c <= 10; c++) {
            const cCell = row.getCell(c);
            if (isEven) {
                cCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorLightBg } };
            }
            cCell.border = {
                top: { style: 'thin', color: { argb: colorBorder } },
                bottom: { style: 'thin', color: { argb: colorBorder } },
                left: { style: 'thin', color: { argb: colorBorder } },
                right: { style: 'thin', color: { argb: colorBorder } }
            };
        }

        row.height = 20;
        currentRowNum++;
    }

    // 6. Fila de Totales Generales
    const totalRow = sheet.getRow(currentRowNum);
    totalRow.height = 24;

    sheet.mergeCells(`A${currentRowNum}:F${currentRowNum}`);
    const totalLabelCell = totalRow.getCell(1);
    totalLabelCell.value = `TOTAL PARTIDAS: ${consolidado.length}   |   SUMATORIA DE UNIDADES REQUERIDAS:`;
    totalLabelCell.font = { bold: true, color: { argb: 'FF1E293B' } };
    totalLabelCell.alignment = { horizontal: 'right', vertical: 'middle' };

    const totalSumCell = totalRow.getCell(7);
    const startRow = headerRowNumber + 1;
    const endRow = currentRowNum - 1;
    totalSumCell.value = { formula: `SUM(G${startRow}:G${endRow})` };
    totalSumCell.numFmt = '#,##0.00';
    totalSumCell.font = { bold: true, size: 11, color: { argb: colorPrimary } };
    totalSumCell.alignment = { horizontal: 'right', vertical: 'middle' };

    for (let c = 1; c <= 10; c++) {
        const cCell = totalRow.getCell(c);
        cCell.border = {
            top: { style: 'medium', color: { argb: colorPrimary } },
            bottom: { style: 'double', color: { argb: colorPrimary } }
        };
    }

    // Auto-ajustar alto para filas con descripciones largas
    sheet.eachRow((row, rowNumber) => {
        if (rowNumber > headerRowNumber && rowNumber < currentRowNum) {
            const desc = row.getCell(4).value;
            if (desc && String(desc).length > 45) {
                row.height = Math.max(20, Math.ceil(String(desc).length / 45) * 16);
            }
        }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
}
