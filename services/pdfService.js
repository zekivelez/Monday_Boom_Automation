import { PDFDocument, StandardFonts, rgb, PDFName, PDFString } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { normalizeStr, parseSecuenciaRank } from './mondayClient.js';

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
    page.drawText("MODELO:", { x: 330, y: rowY, size: 6.5, font: fontBold, color: mediumGray });
    page.drawText(safeText(orden.tecnico?.anoModelo || '2027'), { x: 330 + 44, y: rowY, size: 7, font: fontBold, color: darkGray });
    page.drawText("UNIDADES:", { x: 440, y: rowY, size: 6.5, font: fontBold, color: mediumGray });
    page.drawText(String(orden.cantidadUnidades || 1), { x: 440 + 52, y: rowY, size: 7, font: fontBold, color: primaryBlue });

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

        // Título del Módulo (Limpio según Opción A)
        const modTitle = `${numPartida}. ${safeText(mod.nombreItem)}`;
        page.drawText(modTitle.slice(0, 38), { x: 36, y: y - 10, size: 7.5, font: fontBold, color: white });

        if (mod.moduloNombre && mod.moduloNombre.trim() !== '') {
            const codTxt = mod.codigoModulo ? `${mod.codigoModulo} : ` : "";
            const catTxt = `[${codTxt}${safeText(mod.moduloNombre)}]`;
            page.drawText(catTxt.slice(0, 52), { x: 190, y: y - 10, size: 6.5, font: fontRegular, color: rgb(0.68, 0.82, 1) });
        } else {
            page.drawText("[SIN MODULO AGREGADO]", { x: 190, y: y - 10, size: 6.5, font: fontBold, color: rgb(1, 0.85, 0.6) });
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
            // Sin submódulos o sin módulo asignado
            const tieneMod = Boolean(mod.moduloNombre && mod.moduloNombre.trim() !== '');
            page.drawLine({
                start: { x: 30, y: y - 11 },
                end: { x: width - 30, y: y - 11 },
                thickness: 0.4,
                color: borderGray
            });

            page.drawText("-", { x: 38, y: y - 8, size: 6.5, font: fontBold, color: mediumGray });

            const textoFila = tieneMod
                ? "Subensamble directo / Sin componentes secundarios."
                : "SIN MODULO AGREGADO, FAVOR DE REVISAR";

            const colorFila = tieneMod ? mediumGray : amberText;

            page.drawText(textoFila, { x: 60, y: y - 8, size: 6.5, font: fontBold, color: colorFila });
            page.drawText(tieneMod ? "1 PZA" : "-", { x: 485, y: y - 8, size: 6.5, font: fontBold, color: tieneMod ? primaryBlue : mediumGray });
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

/**
 * Motor de generación visual del reporte PDF corporativo para Lista de Compras
 */
export async function generateComprasReportPdf({ orderName, producto, configNombre, configCodigo, cantidadEquipos, consolidado }) {
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

        // Encabezados de la tabla continua (se repiten en cada página dentro de drawHeader)
        page.drawRectangle({
            x: 35,
            y: y - 3,
            width: width - 70,
            height: 14,
            color: headerBgLight
        });

        page.drawText("#", { x: 38, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("COD. PROV.", { x: 54, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("SKU", { x: 106, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("DESCRIPCION DEL MATERIAL", { x: 144, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("FAMILIA / TIPO", { x: 288, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("U.M.", { x: 362, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("TOTAL", { x: 384, y: y + 2, size: 6.8, font: fontBold, color: primaryColor });
        page.drawText("PROV. SUGERIDO", { x: 420, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("PROV. ALTERNO", { x: 498, y: y + 2, size: 6.8, font: fontBold, color: darkGray });
        page.drawText("[ ]", { x: 558, y: y + 2, size: 6.8, font: fontBold, color: darkGray });

        page.drawLine({
            start: { x: 35, y: y - 3 },
            end: { x: width - 35, y: y - 3 },
            color: borderColor,
            thickness: 0.5
        });

        y -= 15;
    };

    drawHeader();

    // =========================================================================
    // ORDENAMIENTO POR FAMILIA (Garantiza aceros juntos al inicio, luego sistemas)
    // =========================================================================
    const getFamiliaRank = (fam, sku, nombre) => {
        const fNorm = normalizeStr(fam || "");
        const sNorm = normalizeStr(sku || "");
        const nNorm = normalizeStr(nombre || "");

        // 0. ACEROS Y PERFILES (Placas, Vigas, Soleras, Canales, Láminas, PTRs, etc.)
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

    const itemsOrdenados = [...consolidado].sort((a, b) => {
        // 1. Criterio primario: SECUENCIA DE FABRICACION (text_mm7snaqa) del BOM Modular
        const rankSecA = parseSecuenciaRank(a.secuenciaFabricacion, a.posicionBom);
        const rankSecB = parseSecuenciaRank(b.secuenciaFabricacion, b.posicionBom);

        if (rankSecA !== rankSecB) {
            return rankSecA - rankSecB;
        }

        if (a.secuenciaFabricacion && b.secuenciaFabricacion && a.secuenciaFabricacion !== b.secuenciaFabricacion) {
            const cmp = a.secuenciaFabricacion.localeCompare(b.secuenciaFabricacion, 'es', { numeric: true });
            if (cmp !== 0) return cmp;
        }

        // 2. Criterio secundario: Agrupación por familia / tipo de material
        const rankFamA = getFamiliaRank(a.familia, a.sku, a.nombre);
        const rankFamB = getFamiliaRank(b.familia, b.sku, b.nombre);

        if (rankFamA !== rankFamB) {
            return rankFamA - rankFamB;
        }

        // 3. Criterio terciario: Alfabético por descripción
        return (a.nombre || "").localeCompare(b.nombre || "", 'es');
    });

    // =========================================================================
    // TABLA CONTINUA CORRIDA (Sin banners divisores repetidos)
    // =========================================================================
    let partidaContador = 0;
    const proveedoresUnicosSet = new Set();
    const familiasUnicasSet = new Set();

    for (const mat of itemsOrdenados) {
        partidaContador++;

        if (mat.proveedorPrincipal && mat.proveedorPrincipal !== "SIN ASIGNAR" && mat.proveedorPrincipal !== "-") {
            proveedoresUnicosSet.add(mat.proveedorPrincipal.trim());
        }
        if (mat.familia) {
            familiasUnicasSet.add(mat.familia.trim());
        }

        if (y < 42) {
            page = pdfDoc.addPage([612, 792]);
            y = 750;
            drawHeader();
        }

        // Fondo alternado (cebra) para lectura fluida
        if (partidaContador % 2 === 0) {
            page.drawRectangle({
                x: 35,
                y: y - 3,
                width: width - 70,
                height: 13,
                color: lightGray
            });
        }

        const numStr = String(partidaContador);
        const codProvStr = truncate(mat.codigoProveedor || "-", 48, fontRegular, 6.8);
        const skuStr = truncate(mat.sku || "S/SKU", 36, fontBold, 6.8);
        const descStr = truncate(mat.nombre, 138, fontRegular, 6.8);
        const famStr = truncate(mat.familia || "GENERAL", 68, fontRegular, 6.8);
        const umStr = safeText(mat.unidad);
        const cantStr = mat.cantTotal.toLocaleString('es-MX', { maximumFractionDigits: 2 });
        
        const tieneProv = Boolean(mat.proveedorPrincipal && mat.proveedorPrincipal !== "SIN ASIGNAR" && mat.proveedorPrincipal !== "-");
        const provSugStr = truncate(tieneProv ? mat.proveedorPrincipal : "POR ASIGNAR", 72, fontRegular, 6.8);
        const altProvStr = truncate(mat.proveedorAlterno || "-", 56, fontRegular, 6.8);

        page.drawText(numStr, { x: 38, y, size: 6.8, font: fontRegular, color: darkGray });
        page.drawText(codProvStr, { x: 54, y, size: 6.8, font: fontRegular, color: darkGray });
        page.drawText(skuStr, { x: 106, y, size: 6.8, font: fontBold, color: primaryColor });
        page.drawText(descStr, { x: 144, y, size: 6.8, font: fontRegular, color: darkGray });
        page.drawText(famStr, { x: 288, y, size: 6.8, font: fontRegular, color: darkGray });
        page.drawText(umStr, { x: 362, y, size: 6.8, font: fontRegular, color: darkGray });
        page.drawText(cantStr, { x: 384, y, size: 7, font: fontBold, color: primaryColor });
        
        // Proveedor sugerido
        page.drawText(provSugStr, { 
            x: 420, 
            y, 
            size: 6.8, 
            font: fontRegular, 
            color: tieneProv ? darkGray : rgb(0.6, 0.4, 0.2) 
        });
        
        page.drawText(altProvStr, { x: 498, y, size: 6.8, font: fontRegular, color: rgb(0.4, 0.4, 0.4) });

        // Casilla de verificación cuadrada [ ]
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

    // =========================================================================
    // SECCIÓN FINAL: Resumen de Requisición y Cuadro de Firmas
    // =========================================================================
    if (y < 95) {
        page = pdfDoc.addPage([612, 792]);
        y = 750;
        drawHeader();
    }

    const totalProveedoresAsignados = proveedoresUnicosSet.size;
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

    const summaryTxt = `RESUMEN DE REQUISICION:  ${familiasUnicasSet.size} Familias  |  ${totalProveedoresAsignados} Proveedores Sugeridos  |  ${consolidado.length} Partidas Unicas  |  ${totalPiezasVal.toLocaleString('es-MX', { maximumFractionDigits: 2 })} Unidades Requeridas`;
    page.drawText(summaryTxt, {
        x: 45,
        y: y - 2,
        size: 7.2,
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
