// services/pdfService.js
// Motor de generación visual del reporte PDF corporativo para Lista de Compras

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { normalizeStr, parseSecuenciaRank } from './mondayClient.js';

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
