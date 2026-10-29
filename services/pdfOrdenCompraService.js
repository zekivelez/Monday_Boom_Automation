// services/pdfOrdenCompraService.js
// Generador visual del documento PDF corporativo oficial para la Orden de Compra de Transtools Manufacturing

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

export async function generateOrdenCompraPdf({ ordenCompra }) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]); // Tamaño Carta vertical
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Cargar Logotipo oficial
    let logoImage = null;
    try {
        const logoPath = path.resolve(process.cwd(), 'Logo-azul.png');
        if (fs.existsSync(logoPath)) {
            const logoBytes = fs.readFileSync(logoPath);
            logoImage = await pdfDoc.embedPng(logoBytes);
        }
    } catch (e) {
        console.warn("[PDF OC]: No se pudo cargar Logo-azul.png:", e.message);
    }

    const { width, height } = page.getSize();
    let y = height - 28;

    // Paleta de colores corporativos
    const primaryBlue = rgb(13 / 255, 114 / 255, 183 / 255);    // #0D72B7
    const darkNavy = rgb(10 / 255, 60 / 255, 100 / 255);        // Azul oscuro
    const darkGray = rgb(30 / 255, 41 / 255, 59 / 255);         // #1E293B
    const mediumGray = rgb(100 / 255, 116 / 255, 139 / 255);    // #64748B
    const bgCard = rgb(248 / 255, 250 / 255, 252 / 255);        // #F8FAFC
    const borderGray = rgb(203 / 255, 213 / 255, 225 / 255);    // #CBD5E1
    const white = rgb(1, 1, 1);
    const headerBgLight = rgb(238 / 255, 245 / 255, 252 / 255); // Azul tenue
    const zebraBg = rgb(249 / 255, 251 / 255, 253 / 255);

    const safeText = (text) => {
        if (!text) return "";
        return String(text)
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
                if (currentLine) {
                    lines.push(currentLine);
                    if (font.widthOfTextAtSize(word, size) > maxWidth) {
                        let part = "";
                        for (const char of word) {
                            if (font.widthOfTextAtSize(part + char, size) <= maxWidth) {
                                part += char;
                            } else {
                                lines.push(part);
                                part = char;
                            }
                        }
                        currentLine = part;
                    } else {
                        currentLine = word;
                    }
                } else {
                    let part = "";
                    for (const char of word) {
                        if (font.widthOfTextAtSize(part + char, size) <= maxWidth) {
                            part += char;
                        } else {
                            lines.push(part);
                            part = char;
                        }
                    }
                    currentLine = part;
                }
            }
        }
        if (currentLine) lines.push(currentLine);
        return lines.length > 0 ? lines : ["-"];
    };

    const formatMoney = (amount) => {
        const num = Number(amount) || 0;
        return `$ ${num.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    // Función para dibujar encabezado de página
    const drawPageHeader = (isFirstPage = false) => {
        const headerTopY = y;
        
        // Logotipo oficial
        if (logoImage) {
            const maxW = 135;
            const maxH = 34;
            const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height);
            const logoW = logoImage.width * scale;
            const logoH = logoImage.height * scale;
            page.drawImage(logoImage, {
                x: 35,
                y: y - logoH,
                width: logoW,
                height: logoH
            });
        }

        // Título del documento
        page.drawText("ORDEN DE COMPRA", {
            x: 185,
            y: y - 13,
            size: 15,
            font: fontBold,
            color: primaryBlue
        });
        page.drawText("DOCUMENTO OFICIAL DE ADQUISICION DE BIENES Y SERVICIOS", {
            x: 185,
            y: y - 24,
            size: 6.8,
            font: fontBold,
            color: mediumGray
        });

        // Folio Box destacado en la esquina superior derecha
        const folioBoxW = 140;
        const folioBoxX = width - 35 - folioBoxW;
        page.drawRectangle({
            x: folioBoxX,
            y: y - 30,
            width: folioBoxW,
            height: 30,
            color: darkNavy
        });
        page.drawText("FOLIO ORDEN DE COMPRA", {
            x: folioBoxX + 10,
            y: y - 11,
            size: 6.5,
            font: fontBold,
            color: rgb(0.75, 0.88, 1)
        });
        page.drawText(safeText(ordenCompra.folio).slice(0, 20), {
            x: folioBoxX + 10,
            y: y - 24,
            size: 10,
            font: fontBold,
            color: white
        });

        y -= 38;
        page.drawLine({ start: { x: 35, y }, end: { x: width - 35, y }, thickness: 1.5, color: primaryBlue });
        y -= 8;

        if (isFirstPage) {
            // 2. FICHAS PARALELAS: DATOS FACTURA (COMPRADOR) vs DATOS PROVEEDOR
            const cardW = (width - 70 - 10) / 2; // 266 pt cada tarjeta
            const cardH = 76;

            // Tarjeta Izquierda: Transtools (Cliente / Comprador)
            page.drawRectangle({
                x: 35,
                y: y - cardH,
                width: cardW,
                height: cardH,
                color: bgCard,
                borderColor: borderGray,
                borderWidth: 0.8
            });
            page.drawRectangle({
                x: 35,
                y: y - 14,
                width: cardW,
                height: 14,
                color: headerBgLight
            });
            page.drawText("DATOS PARA FACTURA (COMPRADOR)", { x: 42, y: y - 10, size: 7, font: fontBold, color: primaryBlue });

            let ty = y - 24;
            page.drawText(safeText(ordenCompra.comprador.razonSocial), { x: 42, y: ty, size: 7.2, font: fontBold, color: darkGray });
            ty -= 9.5;
            page.drawText(`RFC: ${safeText(ordenCompra.comprador.rfc)}`, { x: 42, y: ty, size: 6.8, font: fontBold, color: darkGray });
            ty -= 9.5;
            page.drawText("Carretera Mexico - Veracruz km 175. S/n, Col. Mazatepec", { x: 42, y: ty, size: 6.5, font: fontRegular, color: darkGray });
            ty -= 9.5;
            page.drawText("Villa del Carmen Tequexquitla, Tlaxcala, C.P. 90570", { x: 42, y: ty, size: 6.5, font: fontRegular, color: darkGray });
            ty -= 9.5;
            page.drawText("Correos: facturas_transtools@outlook.com & compras@transtools.com.mx", { x: 42, y: ty, size: 5.8, font: fontBold, color: darkNavy });

            // Tarjeta Derecha: Proveedor
            const provX = 35 + cardW + 10;
            page.drawRectangle({
                x: provX,
                y: y - cardH,
                width: cardW,
                height: cardH,
                color: bgCard,
                borderColor: borderGray,
                borderWidth: 0.8
            });
            page.drawRectangle({
                x: provX,
                y: y - 14,
                width: cardW,
                height: 14,
                color: headerBgLight
            });
            page.drawText("DATOS DEL PROVEEDOR", { x: provX + 7, y: y - 10, size: 7, font: fontBold, color: primaryBlue });

            let py = y - 24;
            page.drawText(safeText(ordenCompra.proveedor.nombre).slice(0, 48), { x: provX + 7, y: py, size: 7.2, font: fontBold, color: darkGray });
            py -= 9.5;
            page.drawText(`RFC: ${safeText(ordenCompra.proveedor.rfc)}`, { x: provX + 7, y: py, size: 6.8, font: fontBold, color: darkGray });
            py -= 9.5;
            page.drawText(`Atencion: ${safeText(ordenCompra.proveedor.contacto)}`.slice(0, 50), { x: provX + 7, y: py, size: 6.5, font: fontRegular, color: darkGray });
            py -= 9.5;
            page.drawText(`Direccion: ${safeText(ordenCompra.proveedor.direccion)}`.slice(0, 52), { x: provX + 7, y: py, size: 6.5, font: fontRegular, color: darkGray });
            py -= 9.5;
            page.drawText(`Contacto: ${safeText(ordenCompra.proveedor.telefono)} | ${safeText(ordenCompra.proveedor.correo)}`.slice(0, 55), { x: provX + 7, y: py, size: 6.2, font: fontRegular, color: mediumGray });

            y -= (cardH + 7);

            // 3. CAJA DE CONDICIONES COMERCIALES Y FECHAS
            const termsH = 34;
            page.drawRectangle({
                x: 35,
                y: y - termsH,
                width: width - 70,
                height: termsH,
                color: white,
                borderColor: borderGray,
                borderWidth: 0.8
            });

            // Fila 1 de Términos
            let termY = y - 10;
            const drawTerm = (label, val, xPos, maxCh = 30) => {
                page.drawText(label, { x: xPos, y: termY, size: 6.2, font: fontBold, color: mediumGray });
                page.drawText(safeText(val).slice(0, maxCh), { x: xPos, y: termY - 8, size: 6.8, font: fontBold, color: darkGray });
            };

            drawTerm("FECHA EMISION:", ordenCompra.fechaEmision, 42, 14);
            drawTerm("FECHA ENTREGA:", ordenCompra.fechaComprometida, 130, 15);
            drawTerm("MONEDA:", ordenCompra.moneda, 225, 10);
            drawTerm("CONDICIONES PAGO:", ordenCompra.condicionesPago, 285, 24);
            drawTerm("ENTREGA (L.A.B.):", ordenCompra.entregaLab, 415, 30);

            // Fila 2 de Términos
            termY -= 17;
            drawTerm("METODO PAGO:", ordenCompra.metodoPago, 42, 10);
            drawTerm("FORMA DE PAGO:", ordenCompra.formaPago, 115, 28);
            drawTerm("USO CFDI:", ordenCompra.usoCfdi, 245, 30);
            drawTerm("COMPRADOR:", ordenCompra.compradorResponsable, 385, 22);
            drawTerm("OF RELACIONADAS:", ordenCompra.ordenesFabricacion, 485, 18);

            y -= (termsH + 9);
        }

        // 4. ENCABEZADO DE LA TABLA DE PARTIDAS
        page.drawRectangle({
            x: 35,
            y: y - 14,
            width: width - 70,
            height: 14,
            color: primaryBlue
        });

        page.drawText("#", { x: 40, y: y - 10, size: 6.8, font: fontBold, color: white });
        page.drawText("DESCRIPCION DEL MATERIAL / ARTICULO", { x: 60, y: y - 10, size: 6.8, font: fontBold, color: white });
        page.drawText("CANT.", { x: 300, y: y - 10, size: 6.8, font: fontBold, color: white });
        page.drawText("U.M.", { x: 335, y: y - 10, size: 6.8, font: fontBold, color: white });
        page.drawText("P. UNITARIO", { x: 375, y: y - 10, size: 6.8, font: fontBold, color: white });
        page.drawText("IMPORTE", { x: 450, y: y - 10, size: 6.8, font: fontBold, color: white });
        page.drawText("F. LLEGADA", { x: 515, y: y - 10, size: 6.8, font: fontBold, color: white });

        y -= 14;
    };

    drawPageHeader(true);

    // 5. RENDERIZADO DE PARTIDAS CON TEXT WRAPPING DINÁMICO
    const descWidth = 232; // Ancho generoso desde x=60 hasta x=295

    for (let i = 0; i < ordenCompra.partidas.length; i++) {
        const item = ordenCompra.partidas[i];
        const descLines = wrapText(item.descripcion, descWidth, fontRegular, 6.8);
        const lineCount = descLines.length;
        const lineHeight = 8.5;
        const rowHeight = 12 + (lineCount - 1) * lineHeight;

        // Comprobar salto de página
        if (y - rowHeight < 110) {
            page = pdfDoc.addPage([612, 792]);
            y = height - 28;
            drawPageHeader(false);
        }

        const isEven = i % 2 === 0;
        if (isEven) {
            page.drawRectangle({
                x: 35,
                y: y - rowHeight,
                width: width - 70,
                height: rowHeight,
                color: zebraBg
            });
        }

        const baselineY = y - 9.5;

        // # Partida
        page.drawText(String(item.partidaNum), { x: 40, y: baselineY, size: 6.8, font: fontRegular, color: darkGray });

        // Descripción completa en múltiples líneas
        for (let l = 0; l < descLines.length; l++) {
            page.drawText(descLines[l], {
                x: 60,
                y: baselineY - (l * lineHeight),
                size: 6.8,
                font: fontRegular,
                color: darkGray
            });
        }

        // Cantidad
        page.drawText(Number(item.cantidad).toLocaleString('es-MX', { maximumFractionDigits: 2 }), {
            x: 300,
            y: baselineY,
            size: 6.8,
            font: fontBold,
            color: darkGray
        });

        // Unidad de Medida
        page.drawText(safeText(item.unidad), { x: 335, y: baselineY, size: 6.8, font: fontRegular, color: darkGray });

        // Precio Unitario
        page.drawText(formatMoney(item.precioUnitario), { x: 375, y: baselineY, size: 6.8, font: fontRegular, color: darkGray });

        // Importe
        page.drawText(formatMoney(item.importe), { x: 450, y: baselineY, size: 6.8, font: fontBold, color: primaryBlue });

        // Fecha de Llegada
        page.drawText(safeText(item.fechaLlegada).slice(0, 12), { x: 515, y: baselineY, size: 6.5, font: fontRegular, color: mediumGray });

        // Línea divisoria inferior
        page.drawLine({
            start: { x: 35, y: y - rowHeight },
            end: { x: width - 35, y: y - rowHeight },
            thickness: 0.4,
            color: borderGray
        });

        y -= rowHeight;
    }

    // Comprobar espacio para cuadro de totales y observaciones
    const neededBottom = 115;
    if (y - neededBottom < 40) {
        page = pdfDoc.addPage([612, 792]);
        y = height - 28;
        drawPageHeader(false);
    }

    y -= 8;

    // 6. CAJA DE TOTALES (Alineada a la derecha)
    const totalsBoxW = 205;
    const totalsBoxX = width - 35 - totalsBoxW;
    const totalsBoxH = 50;

    page.drawRectangle({
        x: totalsBoxX,
        y: y - totalsBoxH,
        width: totalsBoxW,
        height: totalsBoxH,
        color: white,
        borderColor: borderGray,
        borderWidth: 0.8
    });

    let totY = y - 13;
    page.drawText("SUBTOTAL:", { x: totalsBoxX + 10, y: totY, size: 7.2, font: fontBold, color: mediumGray });
    const subStr = formatMoney(ordenCompra.totales.subtotal);
    const subW = fontBold.widthOfTextAtSize(subStr, 7.5);
    page.drawText(subStr, { x: totalsBoxX + totalsBoxW - 10 - subW, y: totY, size: 7.5, font: fontBold, color: darkGray });

    totY -= 13;
    page.drawText("I.V.A. (16%):", { x: totalsBoxX + 10, y: totY, size: 7.2, font: fontBold, color: mediumGray });
    const ivaStr = formatMoney(ordenCompra.totales.iva);
    const ivaW = fontBold.widthOfTextAtSize(ivaStr, 7.5);
    page.drawText(ivaStr, { x: totalsBoxX + totalsBoxW - 10 - ivaW, y: totY, size: 7.5, font: fontBold, color: darkGray });

    totY -= 15;
    page.drawRectangle({
        x: totalsBoxX,
        y: totY - 4,
        width: totalsBoxW,
        height: 18,
        color: primaryBlue
    });
    page.drawText(`TOTAL (${safeText(ordenCompra.moneda)}):`, { x: totalsBoxX + 10, y: totY, size: 8, font: fontBold, color: white });
    const totStr = `${formatMoney(ordenCompra.totales.total)} ${safeText(ordenCompra.moneda)}`;
    const totW = fontBold.widthOfTextAtSize(totStr, 8.5);
    page.drawText(totStr, { x: totalsBoxX + totalsBoxW - 10 - totW, y: totY, size: 8.5, font: fontBold, color: white });

    // 7. OBSERVACIONES Y TÉRMINOS LEGALES (Alineado a la izquierda frente a totales)
    const obsBoxW = totalsBoxX - 35 - 10;
    page.drawRectangle({
        x: 35,
        y: y - totalsBoxH,
        width: obsBoxW,
        height: totalsBoxH,
        color: bgCard,
        borderColor: borderGray,
        borderWidth: 0.8
    });

    page.drawText("NOTAS Y CONDICIONES GENERALES:", { x: 42, y: y - 11, size: 6.5, font: fontBold, color: primaryBlue });
    
    let userObs = safeText(ordenCompra.observaciones);
    if (!userObs || userObs === "-") {
        userObs = "Entregar mercancia con copia de esta orden de compra y remision o factura en planta Mazatepec.";
    }
    const obsLines = wrapText(userObs, obsBoxW - 14, fontRegular, 6.2).slice(0, 4);
    let obsLineY = y - 20;
    for (const ol of obsLines) {
        page.drawText(ol, { x: 42, y: obsLineY, size: 6.2, font: fontRegular, color: darkGray });
        obsLineY -= 7.5;
    }

    y -= (totalsBoxH + 12);

    // 8. CUADRO DE FIRMAS
    const signBoxW = (width - 70 - 20) / 3;
    const signH = 38;

    const drawSignature = (title, name, xPos) => {
        page.drawRectangle({
            x: xPos,
            y: y - signH,
            width: signBoxW,
            height: signH,
            color: white,
            borderColor: borderGray,
            borderWidth: 0.6
        });
        page.drawText(title, { x: xPos + 8, y: y - 10, size: 6.2, font: fontBold, color: mediumGray });
        page.drawLine({
            start: { x: xPos + 10, y: y - 28 },
            end: { x: xPos + signBoxW - 10, y: y - 28 },
            thickness: 0.5,
            color: borderGray
        });
        page.drawText(safeText(name).slice(0, 30), { x: xPos + 8, y: y - 35, size: 6, font: fontRegular, color: darkGray });
    };

    drawSignature("ELABORÓ / COMPRADOR:", ordenCompra.compradorResponsable, 35);
    drawSignature("AUTORIZÓ / DIRECCIÓN:", "DIRECCIÓN DE OPERACIONES", 35 + signBoxW + 10);
    drawSignature("ACEPTACIÓN DE PROVEEDOR:", ordenCompra.proveedor.nombre, 35 + (signBoxW * 2) + 20);

    const pdfBytes = await pdfDoc.save();
    return pdfBytes;
}
