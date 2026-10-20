// services/pdfService.js
// Generador del Reporte PDF Oficial de Fabricación utilizando pdf-lib nativo

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

export async function generateBomFabricacionPdf({ orden, modulos }) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]); // Carta vertical
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Cargar Logotipo
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

    let { width, height } = page.getSize();
    let y = height - 30;

    // Colores corporativos Transtools
    const navyBlue = rgb(11 / 255, 32 / 255, 70 / 255);       // #0B2046
    const royalBlue = rgb(37 / 255, 99 / 255, 235 / 255);     // #2563EB
    const darkGray = rgb(30 / 255, 41 / 255, 59 / 255);       // #1E293B
    const mediumGray = rgb(100 / 255, 116 / 255, 139 / 255);  // #64748B
    const bgCard = rgb(248 / 255, 250 / 255, 252 / 255);      // #F8FAFC
    const borderGray = rgb(203 / 255, 213 / 255, 225 / 255);  // #CBD5E1
    const white = rgb(1, 1, 1);
    const amberBg = rgb(254 / 255, 243 / 255, 199 / 255);     // #FEF3C7
    const amberBorder = rgb(245 / 255, 158 / 255, 11 / 255);  // #F59E0B
    const amberText = rgb(180 / 255, 83 / 255, 9 / 255);      // #B45309

    const safeText = (txt) => {
        if (!txt) return "";
        return String(txt)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ")
            .trim();
    };

    const checkPageBreak = (neededHeight) => {
        if (y - neededHeight < 40) {
            page = pdfDoc.addPage([612, 792]);
            y = height - 40;
            return true;
        }
        return false;
    };

    // 1. ENCABEZADO
    if (logoImage) {
        const logoDims = logoImage.scale(0.18);
        page.drawImage(logoImage, {
            x: 30,
            y: y - logoDims.height + 10,
            width: logoDims.width,
            height: logoDims.height
        });
    } else {
        page.drawText("TRANSTOOLS", { x: 30, y: y - 10, size: 16, font: fontBold, color: navyBlue });
    }

    // Título Central
    page.drawText("TRANSTOOLS REMOLQUES", { x: 195, y: y - 2, size: 14, font: fontBold, color: navyBlue });
    page.drawText("BOM DE FABRICACION Y SUBENSAMBLES", { x: 195, y: y - 16, size: 9, font: fontBold, color: mediumGray });

    // Folio Box
    const folioBoxX = width - 150;
    page.drawRectangle({
        x: folioBoxX,
        y: y - 24,
        width: 120,
        height: 32,
        color: navyBlue
    });
    page.drawText("ORDEN DE FABRICACION", { x: folioBoxX + 10, y: y - 4, size: 6.5, font: fontBold, color: rgb(0.7, 0.8, 0.9) });
    page.drawText(safeText(orden.folio || "OF-N/A"), { x: folioBoxX + 10, y: y - 18, size: 11, font: fontBold, color: white });

    y -= 38;
    // Línea divisoria
    page.drawLine({ start: { x: 30, y }, end: { x: width - 30, y }, thickness: 2, color: navyBlue });
    y -= 10;

    // 2. FICHA TÉCNICA
    const infoHeight = 52;
    page.drawRectangle({
        x: 30,
        y: y - infoHeight,
        width: width - 60,
        height: infoHeight,
        color: bgCard,
        borderColor: borderGray,
        borderWidth: 1
    });

    const drawInfoPair = (label, val, xPos, yPos, valBold = false) => {
        page.drawText(label, { x: xPos, y: yPos, size: 7, font: fontBold, color: mediumGray });
        page.drawText(safeText(val || "-"), { x: xPos + 68, y: yPos, size: 7.5, font: valBold ? fontBold : fontRegular, color: valBold ? navyBlue : darkGray });
    };

    let rowY = y - 12;
    drawInfoPair("CLIENTE:", orden.cliente, 40, rowY, true);
    drawInfoPair("COLOR:", orden.color, 330, rowY, true);

    rowY -= 11;
    drawInfoPair("CONFIGURACION:", orden.catalogoConfig || orden.codigoConfig, 40, rowY);
    drawInfoPair("DIMENSIONES:", `${orden.dimensiones?.largo || '12.19 M'} x ${orden.dimensiones?.ancho || '2.60 M'} x ${orden.dimensiones?.alto || '2.72 M'}`, 330, rowY);

    rowY -= 11;
    drawInfoPair("NIV / SERIE:", orden.tecnico?.niv, 40, rowY, true);
    drawInfoPair("ANO MODELO:", `${orden.tecnico?.anoModelo || '2027'} | Unidades: ${orden.cantidadUnidades || 1}`, 330, rowY);

    rowY -= 11;
    if (orden.grabado) {
        drawInfoPair("GRABADO:", orden.grabado, 40, rowY);
    }

    y -= (infoHeight + 8);

    // 3. CAJA DE ADVERTENCIAS / NOTAS CRÍTICAS
    if (orden.observaciones && orden.observaciones !== 'SIN OBSERVACIONES ESPECIALES') {
        const obsLines = safeText(orden.observaciones).split('\n');
        const alertH = 14 + (obsLines.length * 9);
        page.drawRectangle({
            x: 30,
            y: y - alertH,
            width: width - 60,
            height: alertH,
            color: amberBg,
            borderColor: amberBorder,
            borderWidth: 1
        });
        page.drawText("NOTAS CRITICAS DE FABRICACION:", { x: 38, y: y - 10, size: 7, font: fontBold, color: amberText });
        let obsY = y - 20;
        for (const line of obsLines) {
            page.drawText(line.trim(), { x: 38, y: obsY, size: 7, font: fontBold, color: rgb(0.45, 0.2, 0.05) });
            obsY -= 9;
        }
        y -= (alertH + 8);
    }

    // 4. MÓDULOS Y SUBENSAMBLES
    for (let i = 0; i < modulos.length; i++) {
        const mod = modulos[i];
        const numPartida = String(i + 1).padStart(2, '0');
        const subItems = mod.submodulos || [];
        const numRows = Math.max(subItems.length, 1);
        const cardHeight = 18 + (numRows * 13) + 12;

        checkPageBreak(cardHeight + 10);

        // Barra del Módulo
        page.drawRectangle({
            x: 30,
            y: y - 16,
            width: width - 60,
            height: 16,
            color: navyBlue
        });

        // Título del Módulo
        const modTitle = `${numPartida}. ${safeText(mod.nombreItem)}`;
        page.drawText(modTitle, { x: 36, y: y - 11, size: 8, font: fontBold, color: white });

        if (mod.moduloNombre) {
            const codTxt = mod.codigoModulo ? `${mod.codigoModulo} : ` : "";
            const catTxt = `[${codTxt}${safeText(mod.moduloNombre)}]`;
            const maxCatWidth = 260;
            page.drawText(catTxt.slice(0, 55), { x: 200, y: y - 11, size: 7, font: fontRegular, color: rgb(0.65, 0.8, 1) });
        }

        // Enlace / botón de Monday
        if (mod.linkUrl) {
            const btnX = width - 115;
            page.drawRectangle({
                x: btnX,
                y: y - 14,
                width: 80,
                height: 12,
                color: royalBlue
            });
            page.drawText("Ver en Monday", { x: btnX + 12, y: y - 10, size: 6.5, font: fontBold, color: white });
        }

        y -= 16;

        // Header de la tabla de subensambles
        page.drawRectangle({
            x: 30,
            y: y - 12,
            width: width - 60,
            height: 12,
            color: rgb(0.94, 0.96, 0.98),
            borderColor: borderGray,
            borderWidth: 0.5
        });

        page.drawText("#", { x: 38, y: y - 9, size: 6.5, font: fontBold, color: mediumGray });
        page.drawText("SUBENSAMBLE / SUBMODULO", { x: 65, y: y - 9, size: 6.5, font: fontBold, color: mediumGray });
        page.drawText("CANTIDAD", { x: 420, y: y - 9, size: 6.5, font: fontBold, color: mediumGray });
        page.drawText("ENSAMBLE", { x: 505, y: y - 9, size: 6.5, font: fontBold, color: mediumGray });

        y -= 12;

        // Filas de subensambles
        if (subItems.length > 0) {
            for (let sIdx = 0; sIdx < subItems.length; sIdx++) {
                const sub = subItems[sIdx];
                const isAlt = sIdx % 2 === 1;

                if (isAlt) {
                    page.drawRectangle({
                        x: 30,
                        y: y - 13,
                        width: width - 60,
                        height: 13,
                        color: bgCard
                    });
                }

                // Línea separadora
                page.drawLine({
                    start: { x: 30, y: y - 13 },
                    end: { x: width - 30, y: y - 13 },
                    thickness: 0.5,
                    color: borderGray
                });

                page.drawText(String(sub.indice || sIdx + 1), { x: 38, y: y - 9, size: 6.5, font: fontBold, color: mediumGray });
                page.drawText(safeText(sub.nombre).slice(0, 75), { x: 65, y: y - 9, size: 7, font: fontRegular, color: darkGray });
                page.drawText(`${sub.cantidad || 1} ${sub.unidad || 'PZA'}`, { x: 420, y: y - 9, size: 7, font: fontBold, color: navyBlue });

                // Casilla física de Ensamble [ ]
                page.drawRectangle({
                    x: 520,
                    y: y - 11,
                    width: 9,
                    height: 9,
                    borderColor: mediumGray,
                    borderWidth: 0.8
                });

                y -= 13;
            }
        } else {
            // Fila vacía / componente directo
            page.drawLine({
                start: { x: 30, y: y - 13 },
                end: { x: width - 30, y: y - 13 },
                thickness: 0.5,
                color: borderGray
            });
            page.drawText("1", { x: 38, y: y - 9, size: 6.5, font: fontBold, color: mediumGray });
            page.drawText("Componente directo / Sin subensambles secundarios registrados.", { x: 65, y: y - 9, size: 6.5, font: fontRegular, color: mediumGray });
            page.drawText("1 PZA", { x: 420, y: y - 9, size: 7, font: fontBold, color: navyBlue });
            page.drawRectangle({
                x: 520,
                y: y - 11,
                width: 9,
                height: 9,
                borderColor: mediumGray,
                borderWidth: 0.8
            });
            y -= 13;
        }

        y -= 6; // Espacio entre módulos
    }

    // 5. FIRMAS DE CONTROL
    checkPageBreak(50);
    y -= 15;
    const signColWidth = (width - 100) / 3;

    const drawSignature = (title, sub, xPos) => {
        page.drawLine({ start: { x: xPos, y }, end: { x: xPos + signColWidth - 20, y }, thickness: 0.8, color: mediumGray });
        page.drawText(title, { x: xPos + 10, y: y - 10, size: 7, font: fontBold, color: navyBlue });
        page.drawText(sub, { x: xPos + 10, y: y - 18, size: 5.5, font: fontRegular, color: mediumGray });
    };

    drawSignature("INGENIERIA Y DISENO", "Liberacion Tecnica", 40);
    drawSignature("SUPERVISOR DE PLANTA", "Ejecucion y Ensamble", 40 + signColWidth);
    drawSignature("CONTROL DE CALIDAD", "Inspeccion Final", 40 + (signColWidth * 2));

    // 6. NUMERACIÓN DE PÁGINAS EN EL FOOTER
    const totalPages = pdfDoc.getPageCount();
    const todayStr = new Date().toISOString().split('T')[0];

    for (let pIdx = 0; pIdx < totalPages; pIdx++) {
        const p = pdfDoc.getPage(pIdx);
        p.drawLine({ start: { x: 30, y: 22 }, end: { x: width - 30, y: 22 }, thickness: 0.5, color: borderGray });
        p.drawText(`Transtools S.A. de C.V. | Sistema de Fabricacion Monday | Emision: ${todayStr}`, {
            x: 30,
            y: 12,
            size: 6.5,
            font: fontRegular,
            color: mediumGray
        });
        p.drawText(`Pagina ${pIdx + 1} de ${totalPages}`, {
            x: width - 85,
            y: 12,
            size: 6.5,
            font: fontRegular,
            color: mediumGray
        });
    }

    return await pdfDoc.save();
}
