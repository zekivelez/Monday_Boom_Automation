# CONTEXTO TÉCNICO Y ARQUITECTURA: PANEL WEB DE CONTROL DE COMPRAS (TRANSTOOLS)

Este documento concentra todo el contexto técnico, IDs de tableros, IDs de columnas y reglas de negocio de **Transtools Manufacturing** en **Monday.com** para construir el **Panel Web de Control y Cotización de Compras** en un proyecto independiente sin alterar `Monday_Boom_Automation`.

---

## 1. Objetivo del Nuevo Proyecto Web
Reemplazar el proceso manual y limitado por webhooks de Monday al momento de **cotizar, elegir proveedores, calcular precios (incluyendo la regla especial de Aceros por Peso Teórico) y agrupar partidas**, mediante una **Aplicación Web Interactiva (Panel de Control de Compras)** que:

1. **Lea las partidas desde el tablero `SOLICITUDES DE COMPRA` (`18434424067`)**, separadas y filtradas por **Orden de Fabricación (OF)** (usando los grupos `OF: <FOLIO>` y/o la columna de OF relacionada `text_mm7xyyhr` / `board_relation_mm8gccw4`).
2. **Enriquezca cada partida** con los datos del **Catálogo de Artículos (`18432236328`)** y el **Catálogo de Proveedores (`18434817715`)** (SKU, Familia, Peso Teórico, Unidad de Medida, Precio Unitario Actual, Proveedor Principal, Proveedor Alterno, Código de Proveedor).
3. **Permita al comprador en una interfaz rápida y cómoda:**
   - Filtrar y buscar por Orden de Fabricación, Familia (`ACEROS`, `SUSPENSIÓN`, `NEUMÁTICA`, etc.) o Proveedor.
   - Seleccionar o cambiar el **Proveedor asignado** de cada partida (o en lote).
   - Ajustar **Cantidad a Comprar** y capturar el **Precio Negociado**.
   - **Cálculo en tiempo real:**
     - **Regla Especial ACEROS:** Si la Familia contiene la palabra `"ACERO"` (ej. `ACERO PLACAS`, `ACERO LAMINA`, `ACERO PERFILES`), calcular:
       $$\text{Precio Unitario Pieza} = \text{Peso Teórico} \times \text{Precio Negociado por Kg}$$
       $$\text{Importe Partida} = \text{Cantidad Ordenada} \times \text{Precio Unitario Pieza}$$
     - **Regla General (No Aceros):**
       $$\text{Precio Unitario} = \text{Precio Negociado (si > 0) o Precio Unitario Actual}$$
       $$\text{Importe Partida} = \text{Cantidad Ordenada} \times \text{Precio Unitario}$$
   - Consolidar partidas duplicadas automáticamente (misma descripción + código de proveedor).
   - **Agrupar por Proveedor** para previsualizar cuántas Órdenes de Compra se van a generar, sus subtotales, IVA (16%) y Total.
4. **Botón "Enviar / Generar Órdenes de Compra en Monday":**
   - Crea los ítems de cabecera en el tablero **`ÓRDENES DE COMPRA` (`18435123821`)** (uno por proveedor seleccionado).
   - Crea sus subelementos (partidas de la OC) con cantidades, precios negociados y vínculos.
   - Calcula y guarda el importe total en `numeric_mm8fs1f1`.
   - Genera y sube el PDF oficial de la Orden de Compra en la columna `file_mm8fdbd2`.

---

## 2. Mapa Oficial de Tableros en Monday.com

| Tablero | Board ID | Rol en el Panel Web |
| :--- | :--- | :--- |
| **SOLICITUDES DE COMPRA** | `18434424067` | **Fuente principal de lectura:** Contiene las partidas requeridas separadas por Orden de Fabricación (grupos `OF: ...`). |
| **ÓRDENES DE FABRICACIÓN** | `18434500734` | **Referencia de OF:** Folio (`text_mm86c6s1`), Producto (`text_mm86hsh9`), Configuración (`text_mm864yeg`), Cantidad de Equipos (`numeric_mm7yb4e`). |
| **CATÁLOGO DE ARTÍCULOS** | `18432236328` | **Catálogo Maestro de Materiales:** SKU, Familia, Peso Teórico, Precio Actual, Proveedor Principal/Alterno, Código de Proveedor. |
| **CATÁLOGO DE PROVEEDORES** | `18434817715` | **Catálogo Maestro de Proveedores:** Nombre fiscal, RFC, Ubicación/Dirección, Teléfono, Correo electrónico, Contacto. |
| **ÓRDENES DE COMPRA** | `18435123821` | **Tablero Destino Final:** Donde el panel web creará las Órdenes de Compra reales, sus subelementos, totales y PDFs. |
| **BOM MODULAR** | `18433468914` | Referencia de ingeniería (configuraciones base). |
| **CATÁLOGO DE MÓDULOS** | `18432845727` | Referencia de módulos. |
| **CATÁLOGO DE SUBMÓDULOS** | `18432844380` | Referencia de submódulos. |

---

## 3. Diccionario Exacto de Columnas por Tablero

### A. Tablero `SOLICITUDES DE COMPRA` (`18434424067`) — *Entrada*
Cada ítem representa un material requerido para una Orden de Fabricación, agrupado en grupos con nombre `OF: <FOLIO> (<PRODUCTO>)`:
- **Nombre del ítem (`name`):** `<SKU> - <NOMBRE DEL MATERIAL>`
- **`text_mm7xyyhr`**: OF Relacionada en texto (ej. `OF6-016`)
- **`board_relation_mm8gccw4`**: Vínculo a Orden de Fabricación (`18434500734`)
- **`text_mm7xy0s5`**: Producto / Configuración (`PL M2E AMF EV1 | PLATAFORMA...`)
- **`text_mm7xn7jy`**: Código de BOM / Configuración técnica (`PL-MC-40-2-AMF-1-Q1000`)
- **`numeric_mm7xdfcn`**: Cantidad a comprar (Total requerido para la OF)
- **`text_mm7xxmqp`**: Proveedor sugerido (texto)
- **`date_mm7xytge`**: Fecha de solicitud
- **`board_relation_mm7x4419`**: Relación directa al ítem en **Catálogo de Artículos (`18432236328`)**
- **`long_text_mm7xeqbm`**: Observaciones / Secuencia de fabricación

---

### B. Tablero `CATÁLOGO DE ARTÍCULOS` (`18432236328`) — *Consulta de Enriquecimiento*
- **`text_mm7ebpck`**: SKU del artículo
- **`dropdown_mm7ezyff`**: Proveedor Principal
- **`dropdown_mm7epfbk`**: Proveedor Alterno
- **`text_mm7epwa2`**: Código de Proveedor
- **Columnas adicionales en Artículos (y/o Mirrors en OC):**
  - Familia / Categoría (identifica si contiene `"ACERO"`, ej. `ACERO PLACAS`, `ACERO LAMINA`)
  - Peso Teórico (kg por pieza, usado cuando la familia incluye `"ACERO"`)
  - Unidad de Medida (`PZA`, `KG`, `M`, `LT`, etc.)
  - Precio Unitario Actual

---

### C. Tablero `ÓRDENES DE COMPRA` (`18435123821`) — *Destino Final (Escritura)*

#### Columnas de Cabecera (Ítem Principal de la OC):
- **`name`**: Folio de la OC (ej. `OC-001` o `OC-<FOLIO>`)
- **`pulse_id_mm8ffv4s`**: ID pulso Monday
- **`board_relation_mm8fk8az`**: Relación al Proveedor en `CATÁLOGO DE PROVEEDORES` (`18434817715`)
- **`lookup_mm8rv3tg`**: Ubicación / Dirección del Proveedor (Mirror)
- **`lookup_mm8rykzv`**: Teléfono del Proveedor (Mirror)
- **`lookup_mm8redrm`**: Correo Electrónico del Proveedor (Mirror)
- **`color_mm8fvdt5`**: Prioridad (`NORMAL`, `URGENTE`, etc.)
- **`color_mm7xx0e8`**: Estatus de la OC (`GENERADA`, etc.)
- **`date_mm7xytge`**: Fecha de emisión (`{ date: "YYYY-MM-DD" }`)
- **`date_mm8f45wm`**: Fecha comprometida de entrega (`{ date: "YYYY-MM-DD" }`)
- **`color_mm8fwjg7`**: Condiciones de pago (`CONTADO`, `CRÉDITO 30 DÍAS`, etc.)
- **`color_mm8fsf4m`**: Moneda (`MXN`, `USD`)
- **`multiple_person_mm7xv7pt`**: Comprador responsable
- **`color_mm8j46nz`**: Método de pago (`PUE (PAGO EN UNA SOLA EXHIBICIÓN)`, `PPD`, etc.)
- **`color_mm8jmev`**: Forma de pago (`03 TRANSFERENCIA ELECTRÓNICA`, etc.)
- **`color_mm8j5cps`**: Uso de CFDI (`G01 ADQUISICIÓN DE MERCANCÍAS`, etc.)
- **`color_mm8j5558`**: Entrega L.A.B. (`PLANTA MAZATEPEC (L.A.B.)`)
- **`text_mm8fvgsb`**: Órdenes de Fabricación relacionadas (ej. `OF6-016`)
- **`long_text_mm7xeqbm`**: Observaciones / Notas de la OC
- **`numeric_mm8fs1f1`**: **IMPORTE TOTAL DE OC** (Subtotal + 16% IVA)
- **`file_mm8fdbd2`**: **Columna de Archivo donde se sube el PDF oficial de la OC**

#### Columnas de los Subelementos (Partidas de la OC):
- **`name`**: Descripción del Material / Artículo
- **`numeric_mm8fhc9y`**: Cantidad Ordenada
- **`numeric_mm8fptc1`**: Precio Negociado (en Aceros es el precio por kg; en demás artículos es el precio unitario negociado)
- **`date0`**: Fecha de llegada de la partida
- **`lookup_mm8fxhk1`**: Unidad de compra (Mirror del artículo)
- **`lookup_mm8sksr0`**: Código de proveedor (Mirror del artículo)
- **`lookup_mm8ft668`**: Precio unitario actual (Mirror del artículo)
- **`lookup_mm91s0ea`**: Familia del artículo (Mirror — si contiene `"ACERO"`, aplica fórmula por peso teórico)
- **`lookup_mm91grdh`**: Peso Teórico del artículo (Mirror — se multiplica por `numeric_mm8fptc1` cuando `lookup_mm91s0ea` contiene `"ACERO"`)

---

## 4. Datos Fiscales Fijos del Comprador (Para PDF de Orden de Compra)
```javascript
export const DATOS_TRANSTOOLS = {
    razonSocial: "TransTools Manufacturing S.A. de C.V.",
    rfc: "TMA0910229Z7",
    direccion: "Carretera México - Veracruz km 175. S/n, Col. Mazatepec, Villa del Carmen Tequexquitla, Tlaxcala, C.P. 90570",
    correos: "facturas_transtools@outlook.com & compras@transtools.com.mx",
};
```

