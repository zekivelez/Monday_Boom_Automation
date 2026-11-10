// services/listaAlmacenService.js
// Servicio independiente para extraer Submódulos y lo que contiene cada uno (Materiales) y generar el PDF de Lista de Almacén

import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import {
    extractColText,
    extractColNumber,
    normalizeStr
} from './mondayClient.js';
import { explodeBom, BOARD_SUBMODULOS } from './bomService.js';

export const BOARD_ORDENES_FABRICACION = "18434500734";
export const COLUMN_STATUS_ALMACEN = "color_mm8zwkgh";
export const COLUMN_FILE_ALMACEN = "file_mm8zwsx3";

const CONFIG_ALIASES = {
    "BOM DOLLY A SCORPION 2 EJES": "DOTA-10M-2FMX-1-00101",
    "DOLLY A SCORPION 2 EJES": "DOTA-10M-2FMX-1-00101",
    "BOM DOLLY A SCORPION": "DOTA-10M-2FMX-1-00101",
    "DOLLY A SCORPION": "DOTA-10M-2FMX-1-00101",
    "DOLLY A": "DOTA-10M-2FMX-1-00101"
};

const addLinkToPage = (page, pdfDoc, linkUrl, x, y, width, height) => {
    try {
        if (!linkUrl || !String(linkUrl).startsWith('http')) return;
        const linkAnnotation = pdfDoc.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [x, y, x + width, y + height],
            Border: [0, 0, 0],
            C: [0, 0, 0],
            A: {
                Type: 'Action',
                S: 'URI',
                URI: PDFString.of(String(linkUrl).trim()),
            },
        });
        const linkAnnotationRef = pdfDoc.context.register(linkAnnotation);

        let annots = page.node.Annots();
        if (!annots) {
            annots = pdfDoc.context.obj([]);
            page.node.set(PDFName.of('Annots'), annots);
        }
        annots.push(linkAnnotationRef);
    } catch (e) {
        console.warn("[PDF Almacén]: No se pudo agregar anotación de link:", e.message);
    }
};

/**
 * Extrae toda la información de la Orden de Fabricación y el desglose de cada Submódulo con sus materiales
 */
export async function getListaAlmacenData({ fetchMonday, pulseId }) {
    console.log(`[Lista Almacén]: Consultando Orden de Fabricación ID ${pulseId}...`);

    const queryGenerador = `query ($itemId: [ID!]) {
        items (ids: $itemId) {
            id
            name
            board {
                id
                name
                columns { id title type }
            }
            column_values {
                id
                text
                value
                type
                ... on MirrorValue { display_value }
                ... on BoardRelationValue { display_value linked_item_ids linked_items { id name } }
            }
            subitems {
                id
                name
                column_values {
                    id
                    text
                    value
                    type
                    ... on MirrorValue { display_value }
                    ... on BoardRelationValue { display_value linked_item_ids linked_items { id name } }
                }
            }
        }
    }`;

    const resGenerador = await fetchMonday(queryGenerador, { itemId: [String(pulseId)] });
    const generadorItem = resGenerador.data?.items?.[0];
    if (!generadorItem) {
        throw new Error(`No se encontró la Orden de Fabricación con ID ${pulseId} en Monday`);
    }

    const boardCols = generadorItem.board?.columns || [];
    const genCols = generadorItem.column_values || [];

    const findCol = (idPattern, titlePattern) => {
        let c = genCols.find(col => col.id === idPattern);
        if (c) return c;
        if (titlePattern) {
            const bCol = boardCols.find(b => {
                const t = normalizeStr(b.title || "");
                return t.includes(normalizeStr(titlePattern));
            });
            if (bCol) return genCols.find(col => col.id === bCol.id);
        }
        return null;
    };

    const getVal = (colIdOrTitle) => {
        let col = genCols.find(c => c.id === colIdOrTitle);
        if (!col) {
            const targetNorm = normalizeStr(colIdOrTitle);
            const boardCol = boardCols.find(b => {
                const titleNorm = normalizeStr(b.title || "");
                return titleNorm === targetNorm || titleNorm.includes(targetNorm);
            });
            if (boardCol) {
                col = genCols.find(c => c.id === boardCol.id);
            }
        }
        return extractColText(col);
    };

    const orderFolio = getVal("ID ORDEN") || getVal("text_mm86c6s1") || (generadorItem.name.match(/OF[0-9A-Za-z_-]+/i)?.[0]) || generadorItem.name || `OF-${pulseId}`;
    const orderName = orderFolio;
    const cliente = extractColText(findCol("board_relation_mm7xyyeq", "clientes") || findCol("board_relation_mm864h7h", "clientes")) || "NO ASIGNADO";
    const color = extractColText(findCol("text_mm86dsk7", "codigo de color")) || "BLANCO";
    const niv = extractColText(findCol("text_mm861tvd", "niv")) || "PENDIENTE";
    const observaciones = extractColText(findCol("long_text_mm86e3sh", "observaciones")) || "";

    const colCantidad = findCol("numeric_mm7yb4e", "cantidad de unidades") || findCol("numeric_mm86z5h6", "cantidad") || findCol("numeric_mm7m4t8r", "cantidad");
    const colProducto = findCol("text_mm86hsh9", "codigo de producto") || findCol("dropdown_mm7mhnmc", "producto");
    const colConfigText = findCol("text_mm864yeg", "codigo de configuracion") || findCol("text_mm7q5s7x", "codigo de configuracion");
    const colConfigDropdown = findCol("board_relation_mm86d06q", "catalogo de productos") || findCol("board_relation_mm7xwz6z", "configuracion") || findCol("dropdown_mm7mqdtg", "configuracion");

    const productoSeleccionado = extractColText(colProducto);
    const configuracionDropdown = extractColText(colConfigDropdown);
    const configuracionTexto = extractColText(colConfigText);

    let cantidadEquipos = extractColNumber(colCantidad, 1);
    if (cantidadEquipos <= 0) cantidadEquipos = 1;

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

    // Explosionar Módulos -> Submódulos -> Materiales usando el motor existente
    const { desgloses, consolidado } = await explodeBom({
        fetchMonday,
        configCodigoTecnico,
        configNombreVisible,
        productoSeleccionado,
        cantidadEquipos,
        orderSubitems: generadorItem.subitems || []
    });

    return {
        boardId: String(generadorItem.board?.id || BOARD_ORDENES_FABRICACION),
        orden: {
            id: generadorItem.id,
            nombre: generadorItem.name,
            folio: orderName,
            cliente,
            color,
            niv,
            observaciones,
            producto: productoSeleccionado,
            configNombre: configNombreVisible,
            configCodigo: configCodigoTecnico,
            cantidadEquipos
        },
        submodulos: desgloses,
        consolidado
    };
}

/**
 * Genera el PDF de Lista de Almacén desglosando cada Submódulo y los materiales que contiene
 */
export async function generateListaAlmacenPdf({ orden, submodulos }) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]); // Carta vertical
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let logoImage = null;
    try {
        const logoPath = path.resolve(process.cwd(), 'Logo-azul.png');
        if (fs.existsSync(logoPath)) {
            const logoBytes = fs.readFileSync(logoPath);
            logoImage = await pdfDoc.embedPng(logoBytes);
        }
    } catch (e) {
        console.warn("[PDF Almacén]: No se pudo cargar Logo-azul.png:", e.message);
    }

    const { width, height } = page.getSize();
    let y = height - 28;

    // Colores corporativos Transtools
    const primaryBlue = rgb(13 / 255, 114 / 255, 183 / 255);    // #0D72B7 Oficial
    const darkNavy = rgb(11 / 255, 32 / 255, 70 / 255);         // #0B2046
    const darkGray = rgb(30 / 255, 41 / 255, 59 / 255);         // #1E293B
    const mediumGray = rgb(100 / 255, 116 / 255, 139 / 255);    // #64748B
    const bgCard = rgb(248 / 255, 250 / 255, 252 / 255);        // #F8FAFC
    const headerTableBg = rgb(238 / 255, 244 / 255, 250 / 255); // Azul claro tabla
    const borderGray = rgb(203 / 255, 213 / 255, 225 / 255);    // #CBD5E1
    const white = rgb(1, 1, 1);

    const safeText = (txt) => {
        if (!txt) return "";
        return String(txt)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^\x20-\x7E]/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    };

    const wrapText = (text, maxWidth, font, size) => {
        const clean = safeText(text);
        if (!clean) return ["-"];
        const words = clean.split(/\s+/);
        const lines = [];
        let currentLine = "";

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            if (font.widthOfTextAtSize(testLine, size) <= maxWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) lines.push(currentLine);
                currentLine = word;
            }
        }
        if (currentLine) lines.push(currentLine);
        return lines.length > 0 ? lines : ["-"];
    };

    const drawPageHeader = (isFirstPage = false) => {
        const headerHeight = 36;
        if (logoImage) {
            const maxW = 125;
            const maxH = 34;
            const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height);
            page.drawImage(logoImage, {
                x: 30,
                y: y - (logoImage.height * scale),
                width: logoImage.width * scale,
                height: logoImage.height * scale
            });
        }

        page.drawText("LISTA DE ALMACEN POR SUBMODULO", { x: 172, y: y - 13, size: 12.5, font: fontBold, color: primaryBlue });
        page.drawText("DESGLOSE DE MATERIALES Y SURTIDO POR SUBENSAMBLE", { x: 172, y: y - 24, size: 7, font: fontBold, color: mediumGray });

        const folioBoxW = 125;
        const folioBoxX = width - 30 - folioBoxW;
        page.drawRectangle({
            x: folioBoxX,
            y: y - 28,
            width: folioBoxW,
            height: 28,
            color: primaryBlue
        });
        page.drawText("ORDEN DE FABRICACION", { x: folioBoxX + 10, y: y - 10, size: 6.5, font: fontBold, color: rgb(0.75, 0.88, 1) });

        let folioCorto = safeText(orden.folio || "");
        if (folioCorto.length > 18) {
            const match = folioCorto.match(/OF[0-9A-Za-z_-]+/i);
            folioCorto = match ? match[0] : folioCorto.slice(0, 16);
        }
        if (!folioCorto) folioCorto = "OF-TRANSTOOLS";
        page.drawText(folioCorto, { x: folioBoxX + 10, y: y - 22, size: 10, font: fontBold, color: white });

        y -= (headerHeight + 6);
        page.drawLine({ start: { x: 30, y }, end: { x: width - 30, y }, thickness: 1.5, color: primaryBlue });
        y -= 8;

        if (isFirstPage) {
            const infoHeight = 44;
            page.drawRectangle({
                x: 30,
                y: y - infoHeight,
                width: width - 60,
                height: infoHeight,
                color: bgCard,
                borderColor: borderGray,
                borderWidth: 0.8
            });

            const drawInfo = (label, val, xPos, yPos, maxChars = 40) => {
                page.drawText(label, { x: xPos, y: yPos, size: 6.5, font: fontBold, color: mediumGray });
                const cleanVal = safeText(val || "-").slice(0, maxChars);
                page.drawText(cleanVal, { x: xPos + 68, y: yPos, size: 7, font: fontBold, color: darkGray });
            };

            let rowY = y - 11;
            page.drawText("ORDEN:", { x: 38, y: rowY, size: 6.5, font: fontBold, color: mediumGray });
            page.drawText(safeText(orden.nombre || orden.folio || "").slice(0, 82), { x: 38 + 68, y: rowY, size: 7.5, font: fontBold, color: primaryBlue });

            rowY -= 10;
            drawInfo("CLIENTE:", orden.cliente, 38, rowY, 35);
            drawInfo("UNIDADES OF:", `${orden.cantidadEquipos || 1} ${orden.cantidadEquipos === 1 ? 'EQUIPO' : 'EQUIPOS'}`, 340, rowY, 25);

            rowY -= 10;
            drawInfo("CONFIGURACION:", `${orden.configNombre || ''} (${orden.configCodigo || ''})`, 38, rowY, 45);
            drawInfo("SUBMODULOS:", `${submodulos.length} SUBENSAMBLES`, 340, rowY, 25);

            rowY -= 10;
            drawInfo("NIV / SERIE:", orden.niv || "PENDIENTE", 38, rowY, 35);
            drawInfo("COLOR:", orden.color || "BLANCO", 340, rowY, 25);

            y -= (infoHeight + 8);
        }
    };

    const drawSubmoduloTableColumnsHeader = () => {
        page.drawRectangle({
            x: 30,
            y: y - 11,
            width: width - 60,
            height: 11,
            color: headerTableBg,
            borderColor: borderGray,
            borderWidth: 0.5
        });

        page.drawText("#", { x: 35, y: y - 8, size: 6, font: fontBold, color: darkGray });
        page.drawText("SKU", { x: 52, y: y - 8, size: 6, font: fontBold, color: darkGray });
        page.drawText("DESCRIPCION DEL MATERIAL / COMPONENTE", { x: 108, y: y - 8, size: 6, font: fontBold, color: darkGray });
        page.drawText("FAMILIA", { x: 345, y: y - 8, size: 6, font: fontBold, color: darkGray });
        page.drawText("U.M.", { x: 425, y: y - 8, size: 6, font: fontBold, color: darkGray });
        page.drawText("X SUBM.", { x: 455, y: y - 8, size: 6, font: fontBold, color: darkGray });
        page.drawText("TOTAL ORDEN", { x: 495, y: y - 8, size: 6, font: fontBold, color: primaryBlue });
        page.drawText("SURT.", { x: 554, y: y - 8, size: 6, font: fontBold, color: darkGray });

        y -= 11;
    };

    const drawSubmoduloBanner = (sub, idxSub, isContinuation = false) => {
        const bannerH = 16;
        page.drawRectangle({
            x: 30,
            y: y - bannerH,
            width: width - 60,
            height: bannerH,
            color: darkNavy
        });

        const numSub = String(idxSub + 1).padStart(2, '0');
        const subTitle = `${numSub}. SUBMODULO: ${safeText(sub.submoduloNombre || sub.codigo)}${isContinuation ? ' (CONT.)' : ''}`;
        page.drawText(subTitle.slice(0, 58), { x: 36, y: y - 10.5, size: 7.5, font: fontBold, color: white });

        const modPadreTxt = `MODULO: ${safeText(sub.moduloNombre || '-')}`;
        page.drawText(modPadreTxt.slice(0, 38), { x: 315, y: y - 10.5, size: 6.5, font: fontRegular, color: rgb(0.68, 0.85, 1) });

        // Badge de cantidad del submódulo
        const cantBadgeTxt = `CANT: ${sub.cantidadTotalParaOrden || sub.cantidadPorEquipo || 1} PZA`;
        const badgeW = 72;
        const badgeX = width - 34 - badgeW;
        page.drawRectangle({
            x: badgeX,
            y: y - 13.5,
            width: badgeW,
            height: 11,
            color: primaryBlue
        });
        page.drawText(cantBadgeTxt, { x: badgeX + 6, y: y - 10, size: 6.2, font: fontBold, color: white });

        y -= bannerH;
        drawSubmoduloTableColumnsHeader();
    };

    drawPageHeader(true);

    // Recorrer cada Submódulo y listar sus materiales
    for (let i = 0; i < submodulos.length; i++) {
        const sub = submodulos[i];
        const materiales = sub.materiales || [];

        // Verificar si cabe al menos el banner + encabezado + 1 fila
        if (y < 85) {
            page = pdfDoc.addPage([612, 792]);
            y = height - 28;
            drawPageHeader(false);
        }

        drawSubmoduloBanner(sub, i, false);

        if (materiales.length === 0) {
            page.drawLine({
                start: { x: 30, y: y - 12 },
                end: { x: width - 30, y: y - 12 },
                thickness: 0.4,
                color: borderGray
            });
            page.drawText("-", { x: 35, y: y - 8.5, size: 6.5, font: fontRegular, color: mediumGray });
            page.drawText("Sin materiales registrados en este submodulo.", { x: 108, y: y - 8.5, size: 6.5, font: fontRegular, color: mediumGray });
            y -= 12;
        } else {
            for (let mIdx = 0; mIdx < materiales.length; mIdx++) {
                const mat = materiales[mIdx];
                const descLines = wrapText(mat.nombreBase || mat.nombre || "-", 230, fontRegular, 6.5);
                const lineCount = Math.max(descLines.length, 1);
                const lineHeight = 8;
                const rowH = 11 + (lineCount - 1) * lineHeight;

                if (y - rowH < 42) {
                    page = pdfDoc.addPage([612, 792]);
                    y = height - 28;
                    drawPageHeader(false);
                    drawSubmoduloBanner(sub, i, true);
                }

                // Fondo alternado
                if (mIdx % 2 === 1) {
                    page.drawRectangle({
                        x: 30,
                        y: y - rowH,
                        width: width - 60,
                        height: rowH,
                        color: bgCard
                    });
                }

                const textY = y - 8;
                page.drawText(String(mIdx + 1), { x: 35, y: textY, size: 6.3, font: fontBold, color: mediumGray });
                page.drawText(safeText(mat.sku || "S/SKU").slice(0, 14), { x: 52, y: textY, size: 6.3, font: fontBold, color: primaryBlue });

                for (let l = 0; l < descLines.length; l++) {
                    page.drawText(descLines[l], { x: 108, y: textY - (l * lineHeight), size: 6.5, font: fontRegular, color: darkGray });
                }

                page.drawText(safeText(mat.familia || "GENERAL").slice(0, 18), { x: 345, y: textY, size: 6, font: fontRegular, color: mediumGray });
                page.drawText(safeText(mat.unidad || "PZA").slice(0, 6), { x: 425, y: textY, size: 6.3, font: fontRegular, color: darkGray });

                const cantUnitStr = Number(mat.cantUnitaria || 1).toLocaleString('es-MX', { maximumFractionDigits: 2 });
                const cantTotalStr = Number(mat.cantTotal || 1).toLocaleString('es-MX', { maximumFractionDigits: 2 });

                page.drawText(cantUnitStr, { x: 458, y: textY, size: 6.5, font: fontRegular, color: darkGray });
                page.drawText(`${cantTotalStr} ${safeText(mat.unidad || 'PZA')}`, { x: 495, y: textY, size: 6.5, font: fontBold, color: primaryBlue });

                // Casilla de check para surtido de almacén
                page.drawRectangle({
                    x: 560,
                    y: textY - 1,
                    width: 7.5,
                    height: 7.5,
                    borderColor: mediumGray,
                    borderWidth: 0.7,
                    color: white
                });

                page.drawLine({
                    start: { x: 30, y: y - rowH },
                    end: { x: width - 30, y: y - rowH },
                    thickness: 0.35,
                    color: borderGray
                });

                y -= rowH;
            }
        }

        y -= 6; // Espacio entre submódulos
    }

    // Firmas de Control de Almacén
    if (y < 60) {
        page = pdfDoc.addPage([612, 792]);
        y = height - 28;
        drawPageHeader(false);
    }

    y -= 18;
    const signColWidth = (width - 100) / 3;
    const drawSignature = (title, sub, xPos) => {
        page.drawLine({ start: { x: xPos, y }, end: { x: xPos + signColWidth - 20, y }, thickness: 0.8, color: mediumGray });
        page.drawText(title, { x: xPos + 6, y: y - 9, size: 6.5, font: fontBold, color: primaryBlue });
        page.drawText(sub, { x: xPos + 6, y: y - 16, size: 5.5, font: fontRegular, color: mediumGray });
    };

    drawSignature("ENTREGA ALMACEN", "Nombre, Firma y Fecha", 40);
    drawSignature("RECIBE PRODUCCION", "Conformidad de Material", 40 + signColWidth);
    drawSignature("SUPERVISOR DE PLANTA", "Validacion de Orden", 40 + (signColWidth * 2));

    // Numeración de páginas en el pie de página
    const totalPages = pdfDoc.getPageCount();
    const todayStr = new Date().toISOString().split('T')[0];

    for (let pIdx = 0; pIdx < totalPages; pIdx++) {
        const p = pdfDoc.getPage(pIdx);
        p.drawLine({ start: { x: 30, y: 20 }, end: { x: width - 30, y: 20 }, thickness: 0.4, color: borderGray });
        p.drawText(`Transtools S.A. de C.V. | Lista de Almacen por Submodulo | Emision: ${todayStr}`, {
            x: 30,
            y: 11,
            size: 6,
            font: fontRegular,
            color: mediumGray
        });
        p.drawText(`Pagina ${pIdx + 1} de ${totalPages}`, {
            x: width - 75,
            y: 11,
            size: 6,
            font: fontRegular,
            color: mediumGray
        });
    }

    return await pdfDoc.save();
}

