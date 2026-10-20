import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStream } from '@react-pdf/renderer';
import { BomFabricacionPdf } from './components/BomFabricacionPdf.js';

const mockData = {
    orden: {
        folio: "OF6-007",
        nombre: "ORDEN DE FABRICACION KWS - LOGISTICA Y TRUCKING TREMOR",
        cliente: "KWS - LOGISTICA Y TRUCKING TREMOR",
        grabado: "LOGISTICA Y TRUCKING TREMOR S DE RL DE CV",
        codigoProducto: "PL A3E AMF EV2",
        codigoConfig: "PL-AD-40-3-AMF-2-C5101",
        catalogoConfig: "PLATAFOMA ADAPTIVE 3E AMF 1V2",
        color: "BLANCO",
        dimensiones: {
            largo: "12.19 M",
            ancho: "2.60 M",
            alto: "2.72 M"
        },
        cantidadUnidades: 1,
        tecnico: {
            niv: "3T9G1403",
            anoModelo: "2027",
            pesoVehicular: "7,700 KG",
            pesoBruto: "47,700 KG",
            cdePorEje: "10,300 KG"
        },
        observaciones: "1.- LLEVA DOS EJES RETRACTILES\n2.- GRABADO EN EL CHASIS Y TAPA TRASERA LOGO DE LA EMPRESA\n3.- EN LA DEFENSA LATERAL VA GRABADO EL NOMBRE DE LA EMPRESA Y PINTADO EN COLOR AZUL",
        descripcionFactura: "Semi-remolque Tipo Plataforma Adaptive Marca TRANSTOOLS, Unidad nueva, Modelo 2027..."
    },
    modulos: [
        {
            subitemId: "101",
            nombreItem: "ESTRUCTURA CHASIS",
            codigoModulo: "MOD-EPL-001",
            moduloNombre: "MODULO CHASIS PL40FT-M01/3E/2P",
            linkUrl: "https://transtools.monday.com/boards/18432845727/pulses/13291779484",
            submodulos: [
                { indice: "1", nombre: "SUBENSAMBLE ESTRUCTURA GENERAL CHASIS PL40FT", cantidad: 1, unidad: "PZA" },
                { indice: "2", nombre: "SUBENSAMBLE PUENTES INTERMEDIOS PL40FT 3E/2P", cantidad: 1, unidad: "PZA" },
                { indice: "3", nombre: "SUBENSAMBLE PUENTES DE SUSPENSION/ACERO", cantidad: 1, unidad: "PZA" },
                { indice: "4", nombre: "SUBENSAMBLE BORDA LATERAL PL40FT-M01/AC", cantidad: 1, unidad: "PZA" }
            ]
        },
        {
            subitemId: "102",
            nombreItem: "CAJA DE HERRAMIENTAS",
            codigoModulo: "MOD-HER-002",
            moduloNombre: "MODULO CAJA DE HERRAMIENTAS GRANDE PLATAFORMA (100cmx50cmx195cm)",
            linkUrl: "https://transtools.monday.com/boards/18432845727/pulses/13196914590",
            submodulos: [
                { indice: "1", nombre: "SUBENSAMBLE CUERPO CAJA DE HERRAMIENTAS 100X50X195", cantidad: 1, unidad: "PZA" },
                { indice: "2", nombre: "HERRAJES, CERRADURA INOXIDABLE Y EMPAQUE", cantidad: 1, unidad: "JGO" }
            ]
        },
        {
            subitemId: "103",
            nombreItem: "PORTALLANTAS",
            codigoModulo: "MOD-POR-001",
            moduloNombre: "MODULO PORTALLANTAS DOBLE PLATAFORMA",
            linkUrl: "https://transtools.monday.com/boards/18432845727/pulses/13295087137",
            submodulos: [
                { indice: "1", nombre: "SUBENSAMBLE CANASTILLA PORTALLANTA DOBLE", cantidad: 1, unidad: "PZA" }
            ]
        },
        {
            subitemId: "104",
            nombreItem: "BARRAS DE COLISION",
            codigoModulo: "MOD-COL-004",
            moduloNombre: "MODULO DEFENSA LATERAL PLATAFORMA 4 BLOQUES /CHG-PD",
            linkUrl: "https://transtools.monday.com/boards/18432845727/pulses/13301388289",
            submodulos: [
                { indice: "1", nombre: "DEFENSA LATERAL IZQUIERDA 4 BLOQUES", cantidad: 1, unidad: "PZA" },
                { indice: "2", nombre: "DEFENSA LATERAL DERECHA 4 BLOQUES", cantidad: 1, unidad: "PZA" }
            ]
        },
        {
            subitemId: "105",
            nombreItem: "CONCHA",
            codigoModulo: "MOD-CON-001",
            moduloNombre: "MODULO CONCHA A 1.20 MTS.",
            linkUrl: "https://transtools.monday.com/boards/18432845727/pulses/13292368513",
            submodulos: [
                { indice: "1", nombre: "SUBENSAMBLE ESTRUCTURA CONCHA FRONTAL 1.20M", cantidad: 1, unidad: "PZA" }
            ]
        },
        {
            subitemId: "106",
            nombreItem: "PATINES",
            codigoModulo: "MOD-PAT-001",
            moduloNombre: "MODULO DOBLE PATIN / AMPRO",
            linkUrl: "https://transtools.monday.com/boards/18432845727/pulses/13197383130",
            submodulos: [
                { indice: "1", nombre: "JUEGO DE PATINES AMPRO 2 VELOCIDADES", cantidad: 1, unidad: "JGO" }
            ]
        }
    ]
};

async function test() {
    const logoPath = path.resolve('Logo-azul.png');
    console.log("Generando PDF con Submódulos de Catálogo (18432845727)...");

    const doc = React.createElement(BomFabricacionPdf, {
        data: mockData,
        logoPath: fs.existsSync(logoPath) ? logoPath : null
    });

    const stream = await renderToStream(doc);
    const chunks = [];
    for await (const chunk of stream) {
        chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync('test_bom_fabricacion.pdf', buffer);
    console.log("PDF generado con exito (Tamano:", buffer.length, "bytes)");
}

test().catch(err => {
    console.error("Error en test:", err);
});
