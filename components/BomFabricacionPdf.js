// components/BomFabricacionPdf.js
// Componente de React-PDF: Módulos de la OF y sus Subensambles/Submódulos del Catálogo (18432845727)

import React from 'react';
import {
    Document,
    Page,
    Text,
    View,
    Link,
    Image,
    StyleSheet
} from '@react-pdf/renderer';

const styles = StyleSheet.create({
    page: {
        paddingTop: 24,
        paddingBottom: 36,
        paddingHorizontal: 28,
        backgroundColor: '#FFFFFF',
        fontFamily: 'Helvetica',
        fontSize: 8,
        color: '#1E293B'
    },
    // Header
    headerContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: '#0B2046',
        paddingBottom: 8,
        marginBottom: 8
    },
    logoCol: {
        width: 140
    },
    logoImage: {
        width: 130,
        height: 'auto'
    },
    headerCenter: {
        flex: 1,
        textAlign: 'center',
        paddingHorizontal: 10
    },
    companyTitle: {
        fontSize: 15,
        fontFamily: 'Helvetica-Bold',
        color: '#0B2046',
        letterSpacing: 0.5
    },
    documentSubtitle: {
        fontSize: 10,
        color: '#475569',
        marginTop: 2,
        fontFamily: 'Helvetica-Bold'
    },
    folioBox: {
        backgroundColor: '#0B2046',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 4,
        alignItems: 'center',
        minWidth: 110
    },
    folioLabel: {
        fontSize: 7,
        color: '#94A3B8',
        fontFamily: 'Helvetica-Bold'
    },
    folioValue: {
        fontSize: 12,
        color: '#FFFFFF',
        fontFamily: 'Helvetica-Bold',
        marginTop: 1
    },

    // Info Grid
    infoCard: {
        backgroundColor: '#F8FAFC',
        borderWidth: 1,
        borderColor: '#E2E8F0',
        borderRadius: 5,
        padding: 7,
        marginBottom: 8
    },
    gridRow: {
        flexDirection: 'row',
        marginBottom: 3
    },
    gridCol: {
        flex: 1,
        flexDirection: 'row'
    },
    label: {
        fontSize: 7.5,
        fontFamily: 'Helvetica-Bold',
        color: '#64748B',
        width: 75
    },
    value: {
        fontSize: 7.5,
        fontFamily: 'Helvetica',
        color: '#0F172A',
        flex: 1
    },
    valueHighlight: {
        fontSize: 7.5,
        fontFamily: 'Helvetica-Bold',
        color: '#0B2046'
    },

    // Alert / Observaciones Box
    alertBox: {
        backgroundColor: '#FEF3C7',
        borderWidth: 1,
        borderColor: '#F59E0B',
        borderRadius: 5,
        padding: 6,
        marginBottom: 8
    },
    alertTitle: {
        fontSize: 7.5,
        fontFamily: 'Helvetica-Bold',
        color: '#B45309',
        marginBottom: 2
    },
    alertText: {
        fontSize: 7.5,
        fontFamily: 'Helvetica-Bold',
        color: '#78350F',
        lineHeight: 1.2
    },

    // Section Title
    sectionTitle: {
        fontSize: 9,
        fontFamily: 'Helvetica-Bold',
        color: '#0B2046',
        backgroundColor: '#E2E8F0',
        paddingVertical: 3.5,
        paddingHorizontal: 6,
        marginBottom: 6,
        borderRadius: 3
    },

    // Module Card
    moduleCard: {
        marginBottom: 7,
        borderWidth: 1,
        borderColor: '#CBD5E1',
        borderRadius: 4,
        overflow: 'hidden'
    },
    moduleHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#0B2046',
        paddingVertical: 4.5,
        paddingHorizontal: 7
    },
    moduleTitleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        paddingRight: 6
    },
    moduleTitle: {
        fontSize: 8.5,
        fontFamily: 'Helvetica-Bold',
        color: '#FFFFFF'
    },
    moduleCatalog: {
        fontSize: 7.5,
        color: '#93C5FD',
        marginLeft: 6
    },
    mondayBtn: {
        backgroundColor: '#2563EB',
        paddingVertical: 2.5,
        paddingHorizontal: 6,
        borderRadius: 3,
        textDecoration: 'none'
    },
    mondayBtnText: {
        fontSize: 7,
        fontFamily: 'Helvetica-Bold',
        color: '#FFFFFF'
    },

    // Table
    subTableHeader: {
        flexDirection: 'row',
        backgroundColor: '#F1F5F9',
        borderBottomWidth: 1,
        borderBottomColor: '#CBD5E1',
        paddingVertical: 3,
        paddingHorizontal: 6
    },
    subTableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: '#E2E8F0',
        paddingVertical: 3.5,
        paddingHorizontal: 6,
        alignItems: 'center'
    },
    subTableRowAlt: {
        backgroundColor: '#F8FAFC'
    },

    colIdx: { width: '6%', textAlign: 'center' },
    colName: { flex: 1, paddingRight: 6 },
    colQty: { width: '12%', textAlign: 'center' },
    colCheck: { width: '12%', alignItems: 'center' },

    txtIdx: { fontSize: 7, color: '#64748B', fontFamily: 'Helvetica-Bold' },
    txtSubName: { fontSize: 7.5, color: '#0F172A' },
    txtQty: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: '#0B2046' },
    txtEmpty: { fontSize: 7, color: '#64748B', fontStyle: 'italic' },

    checkBox: {
        width: 11,
        height: 11,
        borderWidth: 1,
        borderColor: '#64748B',
        borderRadius: 2
    },

    // Signatures
    signatureContainer: {
        marginTop: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 20
    },
    signatureBox: {
        width: '28%',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#64748B',
        paddingTop: 4
    },
    signTitle: {
        fontSize: 7,
        fontFamily: 'Helvetica-Bold',
        color: '#0B2046'
    },
    signSub: {
        fontSize: 6,
        color: '#64748B',
        marginTop: 1
    },

    // Footer
    footer: {
        position: 'absolute',
        bottom: 12,
        left: 28,
        right: 28,
        flexDirection: 'row',
        justifyContent: 'space-between',
        fontSize: 7,
        color: '#94A3B8',
        borderTopWidth: 0.5,
        borderTopColor: '#E2E8F0',
        paddingTop: 4
    }
});

export const BomFabricacionPdf = ({ data, logoPath }) => {
    const { orden, modulos } = data;

    const fechaHoy = new Date().toLocaleDateString('es-MX', {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
    }).toUpperCase();

    return React.createElement(Document, null,
        React.createElement(Page, { size: 'LETTER', orientation: 'portrait', style: styles.page },
            // 1. ENCABEZADO
            React.createElement(View, { style: styles.headerContainer },
                React.createElement(View, { style: styles.logoCol },
                    logoPath
                        ? React.createElement(Image, { src: logoPath, style: styles.logoImage })
                        : React.createElement(Text, { style: styles.companyTitle }, 'TRANSTOOLS')
                ),
                React.createElement(View, { style: styles.headerCenter },
                    React.createElement(Text, { style: styles.companyTitle }, 'TRANSTOOLS REMOLQUES'),
                    React.createElement(Text, { style: styles.documentSubtitle }, 'BOM DE FABRICACIÓN Y SUBENSAMBLES')
                ),
                React.createElement(View, { style: styles.folioBox },
                    React.createElement(Text, { style: styles.folioLabel }, 'ORDEN DE FABRICACIÓN'),
                    React.createElement(Text, { style: styles.folioValue }, orden.folio || 'OF-N/A')
                )
            ),

            // 2. FICHA TÉCNICA
            React.createElement(View, { style: styles.infoCard },
                React.createElement(View, { style: styles.gridRow },
                    React.createElement(View, { style: styles.gridCol },
                        React.createElement(Text, { style: styles.label }, 'CLIENTE:'),
                        React.createElement(Text, { style: [styles.value, styles.valueHighlight] }, orden.cliente || 'NO ASIGNADO')
                    ),
                    React.createElement(View, { style: styles.gridCol },
                        React.createElement(Text, { style: styles.label }, 'COLOR:'),
                        React.createElement(Text, { style: [styles.value, styles.valueHighlight] }, orden.color || 'BLANCO')
                    )
                ),
                React.createElement(View, { style: styles.gridRow },
                    React.createElement(View, { style: styles.gridCol },
                        React.createElement(Text, { style: styles.label }, 'CONFIGURACIÓN:'),
                        React.createElement(Text, { style: styles.value }, orden.catalogoConfig || orden.codigoConfig || 'PL-ADAPTIVE')
                    ),
                    React.createElement(View, { style: styles.gridCol },
                        React.createElement(Text, { style: styles.label }, 'DIMENSIONES:'),
                        React.createElement(Text, { style: styles.value }, `${orden.dimensiones.largo} x ${orden.dimensiones.ancho} x ${orden.dimensiones.alto}`)
                    )
                ),
                React.createElement(View, { style: styles.gridRow },
                    React.createElement(View, { style: styles.gridCol },
                        React.createElement(Text, { style: styles.label }, 'NIV / SERIE:'),
                        React.createElement(Text, { style: [styles.value, styles.valueHighlight] }, orden.tecnico.niv)
                    ),
                    React.createElement(View, { style: styles.gridCol },
                        React.createElement(Text, { style: styles.label }, 'AÑO MODELO:'),
                        React.createElement(Text, { style: styles.value }, `${orden.tecnico.anoModelo} | Unidades: ${orden.cantidadUnidades}`)
                    )
                ),
                orden.grabado ? React.createElement(View, { style: styles.gridRow },
                    React.createElement(View, { style: styles.gridCol },
                        React.createElement(Text, { style: styles.label }, 'GRABADO:'),
                        React.createElement(Text, { style: styles.value }, orden.grabado)
                    )
                ) : null
            ),

            // 3. CAJA DE ADVERTENCIAS / NOTAS CRÍTICAS
            orden.observaciones && orden.observaciones !== 'SIN OBSERVACIONES ESPECIALES' ? React.createElement(View, { style: styles.alertBox },
                React.createElement(Text, { style: styles.alertTitle }, '⚠️ NOTAS CRÍTICAS DE FABRICACIÓN:'),
                React.createElement(Text, { style: styles.alertText }, orden.observaciones)
            ) : null,

            // 4. DESGLOSE DE MÓDULOS Y SUBENSAMBLES
            React.createElement(Text, { style: styles.sectionTitle }, 'MÓDULOS Y SUBENSAMBLES DE PRODUCCIÓN (Clic en botón azul para ver en Monday)'),

            modulos.map((mod, index) => {
                const numPartida = String(index + 1).padStart(2, '0');
                const hasSubmodulos = mod.submodulos && mod.submodulos.length > 0;
                const tieneModulo = mod.moduloNombre && mod.moduloNombre.trim() !== '';

                return React.createElement(View, {
                    key: mod.subitemId || index,
                    style: styles.moduleCard,
                    wrap: false
                },
                    // Cabecera del Módulo
                    React.createElement(View, { style: styles.moduleHeader },
                        React.createElement(View, { style: styles.moduleTitleRow },
                            React.createElement(Text, { style: styles.moduleTitle }, `${numPartida}. ${mod.nombreItem}`),
                            tieneModulo
                                ? React.createElement(Text, { style: styles.moduleCatalog }, `[${mod.codigoModulo ? mod.codigoModulo + ' : ' : ''}${mod.moduloNombre}]`)
                                : React.createElement(Text, { style: [styles.moduleCatalog, { color: '#CBD5E1' }] }, '[SIN ASIGNAR]')
                        ),
                        mod.linkUrl ? React.createElement(Link, { src: mod.linkUrl, style: styles.mondayBtn },
                            React.createElement(Text, { style: styles.mondayBtnText }, '🔗 Ver en Monday ↗')
                        ) : null
                    ),

                    // Tabla de Subensambles / Submódulos
                    hasSubmodulos ? React.createElement(View, null,
                        React.createElement(View, { style: styles.subTableHeader },
                            React.createElement(Text, { style: [styles.colIdx, { fontFamily: 'Helvetica-Bold' }] }, '#'),
                            React.createElement(Text, { style: [styles.colName, { fontFamily: 'Helvetica-Bold' }] }, 'SUBENSAMBLE / SUBMÓDULO'),
                            React.createElement(Text, { style: [styles.colQty, { fontFamily: 'Helvetica-Bold' }] }, 'CANTIDAD'),
                            React.createElement(Text, { style: [styles.colCheck, { fontFamily: 'Helvetica-Bold' }] }, 'ENSAMBLE')
                        ),
                        mod.submodulos.map((sm, sIdx) => {
                            const isAlt = sIdx % 2 === 1;
                            return React.createElement(View, {
                                key: sm.id || sIdx,
                                style: [styles.subTableRow, isAlt ? styles.subTableRowAlt : {}]
                            },
                                React.createElement(View, { style: styles.colIdx },
                                    React.createElement(Text, { style: styles.txtIdx }, sm.indice || String(sIdx + 1))
                                ),
                                React.createElement(View, { style: styles.colName },
                                    React.createElement(Text, { style: styles.txtSubName }, sm.nombre)
                                ),
                                React.createElement(View, { style: styles.colQty },
                                    React.createElement(Text, { style: styles.txtQty }, `${sm.cantidad || 1} ${sm.unidad || 'PZA'}`)
                                ),
                                React.createElement(View, { style: styles.colCheck },
                                    React.createElement(View, { style: styles.checkBox })
                                )
                            );
                        })
                    ) : React.createElement(View, { style: [styles.subTableRow, { paddingVertical: 4 }] },
                        React.createElement(View, { style: styles.colIdx },
                            React.createElement(Text, { style: styles.txtIdx }, '1')
                        ),
                        React.createElement(View, { style: styles.colName },
                            React.createElement(Text, { style: styles.txtEmpty },
                                tieneModulo ? 'Componente directo / Sin subensambles secundarios registrados.' : 'Partida sin asignar.'
                            )
                        ),
                        React.createElement(View, { style: styles.colQty },
                            React.createElement(Text, { style: styles.txtQty }, '1 PZA')
                        ),
                        React.createElement(View, { style: styles.colCheck },
                            React.createElement(View, { style: styles.checkBox })
                        )
                    )
                );
            }),

            // 5. FIRMAS DE CONTROL
            React.createElement(View, { style: styles.signatureContainer, wrap: false },
                React.createElement(View, { style: styles.signatureBox },
                    React.createElement(Text, { style: styles.signTitle }, 'INGENIERÍA Y DISEÑO'),
                    React.createElement(Text, { style: styles.signSub }, 'Liberación Técnica')
                ),
                React.createElement(View, { style: styles.signatureBox },
                    React.createElement(Text, { style: styles.signTitle }, 'SUPERVISOR DE PLANTA'),
                    React.createElement(Text, { style: styles.signSub }, 'Ejecución y Ensamble')
                ),
                React.createElement(View, { style: styles.signatureBox },
                    React.createElement(Text, { style: styles.signTitle }, 'CONTROL DE CALIDAD'),
                    React.createElement(Text, { style: styles.signSub }, 'Inspección Final')
                )
            ),

            // 6. PIE DE PÁGINA
            React.createElement(View, { style: styles.footer, fixed: true },
                React.createElement(Text, null, `Transtools S.A. de C.V. | Sistema de Fabricación Monday | Emisión: ${fechaHoy}`),
                React.createElement(Text, {
                    render: ({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`
                })
            )
        )
    );
};
