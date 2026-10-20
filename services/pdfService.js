import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

// Helper para incrustar hipervínculo interactivo clickable en el PDF
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
        console.warn("[PDF]: No se pudo agregar anotación de link:", e.message);
    }
};

export async function generateBomFabricacionPdf({ orden, modulos }) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]); // Carta vertical
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Cargar Logotipo oficial con escalado estricto
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
    let y = height - 28;

    // Colores corporativos Transtools
    const primaryBlue = rgb(13 / 255, 114 / 255, 183 / 255);    // #0D72B7 Oficial
    const buttonBlue = rgb(8 / 255, 75 / 255, 122 / 255);        // Azul oscuro para botón interactivo
    const darkGray = rgb(30 / 255, 41 / 255, 59 / 255);         // #1E293B
    const mediumGray = rgb(100 / 255, 116 / 255, 139 / 255);    // #64748B
    const bgCard = rgb(248 / 255, 250 / 255, 252 / 255);        // #F8FAFC
    const borderGray = rgb(203 / 255, 213 / 255, 225 / 255);    // #CBD5E1
    const white = rgb(1, 1, 1);
    const amberBg = rgb(254 / 255, 243 / 255, 199 / 255);       // #FEF3C7
    const amberBorder = rgb(245 / 255, 158 / 255, 11 / 255);    // #F59E0B
    const amberText = rgb(180 / 255, 83 / 255, 9 / 255);        // #B45309

    const safeText = (txt) => {
        if (!txt) return "";
        return String(txt)
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^\x20-\x7E\xA0-\xFF]/g, " ")
            .trim();
    };

    const checkPageBreak = (neededHeight) => {
        if (y - neededHeight < 45) {
            page = pdfDoc.addPage([612, 792]);
            y = height - 32;
            return true;
        }
        return false;
    };

    // 1. ENCABEZADO
    const headerHeight = 36;
    if (logoImage) {
        // Escalar de forma estricta para que el logo mida máx 125 x 34 px
        const maxW = 125;
        const maxH = 34;
        const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height);
        const logoW = logoImage.width * scale;
        const logoH = logoImage.height * scale;
        page.drawImage(logoImage, {
            x: 30,
            y: y - logoH,
            width: logoW,
            height: logoH
        });
    }

    // Título del Documento (sin repetir Transtools Remolques porque ya está en el logo)
    page.drawText("BOM DE FABRICACION", { x: 180, y: y - 13, size: 14, font: fontBold, color: primaryBlue });
    page.drawText("ESPECIFICACION TECNICA Y SUBENSAMBLES", { x: 180, y: y - 24, size: 7.5, font: fontBold, color: mediumGray });

    // Folio Box en la esquina superior derecha
    const folioBoxW = 125;
    const folioBoxX = width - 30 - folioBoxW;
    page.drawRectangle({
        x: folioBoxX,
        y: y - 28,
        width: folioBoxW,
        height: 28,
        color: primaryBlue
    });
    page.drawText("ORDEN DE FABRICACION", { x: folioBoxX + 10, y: y - 10, size: 6.5, font: fontBold, color: rgb(0.7, 0.8, 0.95) });

    // Limpiar folio corto (ej: OF6-007)
    let folioCorto = safeText(orden.folio || "");
    if (folioCorto.length > 18) {
        const match = folioCorto.match(/OF[0-9A-Za-z_-]+/i);
        folioCorto = match ? match[0] : folioCorto.slice(0, 16);
    }
    if (!folioCorto) folioCorto = "OF-TRANSTOOLS";
    page.drawText(folioCorto, { x: folioBoxX + 10, y: y - 22, size: 10, font: fontBold, color: white });

    y -= (headerHeight + 6);
    // Línea divisoria
    page.drawLine({ start: { x: 30, y }, end: { x: width - 30, y }, thickness: 1.5, color: primaryBlue });
    y -= 8;

    // 2. FICHA TÉCNICA
    const infoHeight = 54;
    page.drawRectangle({
        x: 30,
        y: y - infoHeight,
        width: width - 60,
        height: infoHeight,
        color: bgCard,
        borderColor: borderGray,
        borderWidth: 0.8
    });

    const drawInfo = (label, val, xPos, yPos, maxChars = 38) => {
        page.drawText(label, { x: xPos, y: yPos, size: 6.5, font: fontBold, color: mediumGray });
        const cleanVal = safeText(val || "-").slice(0, maxChars);
        page.drawText(cleanVal, { x: xPos + 68, y: yPos, size: 7, font: fontBold, color: darkGray });
    };

    let rowY = y - 11;
    // Fila 1: Nombre de la Orden (Primer elemento)
    page.drawText("ORDEN:", { x: 38, y: rowY, size: 6.5, font: fontBold, color: mediumGray });
    page.drawText(safeText(orden.nombre || orden.folio || "").slice(0, 85), { x: 38 + 68, y: rowY, size: 7.5, font: fontBold, color: primaryBlue });

    rowY -= 10;
    drawInfo("CLIENTE:", orden.cliente, 38, rowY, 35);
    drawInfo("COLOR:", orden.color || "BLANCO", 330, rowY, 25);

    rowY -= 10;
    drawInfo("CONFIGURACION:", orden.catalogoConfig || orden.codigoConfig, 38, rowY, 35);
    drawInfo("DIMENSIONES:", `${orden.dimensiones?.largo || '12.19 M'} x ${orden.dimensiones?.ancho || '2.60 M'} x ${orden.dimensiones?.alto || '2.72 M'}`, 330, rowY, 28);

    rowY -= 10;
    drawInfo("NIV / SERIE:", orden.tecnico?.niv || "PENDIENTE", 38, rowY, 35);
    drawInfo("ANO MODELO:", `${orden.tecnico?.anoModelo || '2027'} | Unidades: ${orden.cantidadUnidades || 1}`, 330, rowY, 25);

    rowY -= 10;
    if (orden.grabado && !orden.grabado.toLowerCase().includes("1.-")) {
        drawInfo("GRABADO:", orden.grabado, 38, rowY, 60);
    }

    y -= (infoHeight + 6);

    // 3. CAJA DE OBSERVACIONES CRÍTICAS
    if (orden.observaciones && orden.observaciones !== 'SIN OBSERVACIONES ESPECIALES') {
        const rawObs = safeText(orden.observaciones);
        // Dividir por líneas o por "1.-", "2.-", etc.
        let obsLines = rawObs.split('\n');
        if (obsLines.length === 1 && rawObs.includes('2.-')) {
            obsLines = rawObs.split(/(?=\d+\.-)/);
        }
        obsLines = obsLines.map(l => l.trim()).filter(Boolean).slice(0, 4);

        const alertH = 12 + (obsLines.length * 8.5);
        page.drawRectangle({
            x: 30,
            y: y - alertH,
            width: width - 60,
            height: alertH,
            color: amberBg,
            borderColor: amberBorder,
            borderWidth: 0.8
        });
        page.drawText("NOTAS CRITICAS DE FABRICACION:", { x: 38, y: y - 9, size: 6.5, font: fontBold, color: amberText });
        let obsY = y - 17;
        for (const line of obsLines) {
            page.drawText(line.slice(0, 110), { x: 38, y: obsY, size: 6.5, font: fontBold, color: rgb(0.45, 0.2, 0.05) });
            obsY -= 8.5;
        }
        y -= (alertH + 6);
    }

    // 4. MÓDULOS Y SUBENSAMBLES
    for (let i = 0; i < modulos.length; i++) {
        const mod = modulos[i];
        const numPartida = String(i + 1).padStart(2, '0');
        const subItems = mod.submodulos || [];
        const numRows = Math.max(subItems.length, 1);
        const cardHeight = 15 + 11 + (numRows * 11) + 4;

        checkPageBreak(cardHeight);

        // Barra del Módulo
        page.drawRectangle({
            x: 30,
            y: y - 14,
            width: width - 60,
            height: 14,
            color: primaryBlue
        });

        // Título del Módulo
        const modTitle = `${numPartida}. ${safeText(mod.nombreItem)}`;
        page.drawText(modTitle.slice(0, 35), { x: 36, y: y - 10, size: 7.5, font: fontBold, color: white });

        if (mod.moduloNombre) {
            const codTxt = mod.codigoModulo ? `${mod.codigoModulo} : ` : "";
            const catTxt = `[${codTxt}${safeText(mod.moduloNombre)}]`;
            page.drawText(catTxt.slice(0, 52), { x: 190, y: y - 10, size: 6.5, font: fontRegular, color: rgb(0.68, 0.82, 1) });
        }

        // Botón Ver en Monday con Enlace Clickable Interactivo
        if (mod.linkUrl) {
            const btnW = 80;
            const btnX = width - 35 - btnW;
            const btnY = y - 12.5;
            page.drawRectangle({
                x: btnX,
                y: btnY,
                width: btnW,
                height: 11,
                color: buttonBlue
            });
            page.drawText("Ver en Monday ->", { x: btnX + 7, y: y - 9.5, size: 6, font: fontBold, color: white });

            // Registrar hipervínculo interactivo clickable en el PDF
            addLinkToPage(page, pdfDoc, mod.linkUrl, btnX, btnY, btnW, 11);
        }

        y -= 14;

        // Header de la tabla de subensambles
        page.drawRectangle({
            x: 30,
            y: y - 10.5,
            width: width - 60,
            height: 10.5,
            color: rgb(0.93, 0.95, 0.98),
            borderColor: borderGray,
            borderWidth: 0.5
        });

        page.drawText("#", { x: 38, y: y - 8, size: 6, font: fontBold, color: mediumGray });
        page.drawText("SUBENSAMBLE / SUBMODULO", { x: 60, y: y - 8, size: 6, font: fontBold, color: mediumGray });
        page.drawText("CANTIDAD", { x: 485, y: y - 8, size: 6, font: fontBold, color: mediumGray });

        y -= 10.5;

        // Filas de subensambles
        if (subItems.length > 0) {
            for (let sIdx = 0; sIdx < subItems.length; sIdx++) {
                const sub = subItems[sIdx];
                const isAlt = sIdx % 2 === 1;

                if (isAlt) {
                    page.drawRectangle({
                        x: 30,
                        y: y - 11,
                        width: width - 60,
                        height: 11,
                        color: bgCard
                    });
                }

                // Línea separadora
                page.drawLine({
                    start: { x: 30, y: y - 11 },
                    end: { x: width - 30, y: y - 11 },
                    thickness: 0.4,
                    color: borderGray
                });

                // Número estricto (1, 2, 3...)
                const numSub = String(sIdx + 1);
                page.drawText(numSub, { x: 38, y: y - 8, size: 6.5, font: fontBold, color: mediumGray });

                // Nombre limpio sin duplicar
                let nombreLimpio = safeText(sub.nombre || "");
                const mitad = Math.floor(nombreLimpio.length / 2);
                if (mitad > 10 && nombreLimpio.slice(0, mitad).trim() === nombreLimpio.slice(mitad).trim()) {
                    nombreLimpio = nombreLimpio.slice(0, mitad).trim();
                }

                page.drawText(nombreLimpio.slice(0, 95), { x: 60, y: y - 8, size: 6.5, font: fontRegular, color: darkGray });
                page.drawText(`${sub.cantidad || 1} ${sub.unidad || 'PZA'}`, { x: 485, y: y - 8, size: 6.5, font: fontBold, color: primaryBlue });

                y -= 11;
            }
        } else {
            // Componente directo
            page.drawLine({
                start: { x: 30, y: y - 11 },
                end: { x: width - 30, y: y - 11 },
                thickness: 0.4,
                color: borderGray
            });
            page.drawText("1", { x: 38, y: y - 8, size: 6.5, font: fontBold, color: mediumGray });
            page.drawText("Componente directo / Sin subensambles secundarios registrados.", { x: 60, y: y - 8, size: 6, font: fontRegular, color: mediumGray });
            page.drawText("1 PZA", { x: 485, y: y - 8, size: 6.5, font: fontBold, color: primaryBlue });
            y -= 11;
        }

        y -= 3.5; // Espacio limpio entre módulos
    }

    // 5. FIRMAS DE CONTROL
    checkPageBreak(40);
    y -= 12;
    const signColWidth = (width - 100) / 3;

    const drawSignature = (title, sub, xPos) => {
        page.drawLine({ start: { x: xPos, y }, end: { x: xPos + signColWidth - 20, y }, thickness: 0.8, color: mediumGray });
        page.drawText(title, { x: xPos + 6, y: y - 9, size: 6.5, font: fontBold, color: primaryBlue });
        page.drawText(sub, { x: xPos + 6, y: y - 16, size: 5, font: fontRegular, color: mediumGray });
    };

    drawSignature("INGENIERIA Y DISENO", "Liberacion Tecnica", 40);
    drawSignature("SUPERVISOR DE PLANTA", "Ejecucion y Ensamble", 40 + signColWidth);
    drawSignature("CONTROL DE CALIDAD", "Inspeccion Final", 40 + (signColWidth * 2));

    // 6. NUMERACIÓN DE PÁGINAS EN EL FOOTER
    const totalPages = pdfDoc.getPageCount();
    const todayStr = new Date().toISOString().split('T')[0];

    for (let pIdx = 0; pIdx < totalPages; pIdx++) {
        const p = pdfDoc.getPage(pIdx);
        p.drawLine({ start: { x: 30, y: 20 }, end: { x: width - 30, y: 20 }, thickness: 0.4, color: borderGray });
        p.drawText(`Transtools S.A. de C.V. | Sistema de Fabricacion Monday | Emision: ${todayStr}`, {
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
