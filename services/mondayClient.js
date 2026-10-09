// services/mondayClient.js
// Cliente y utilerías de conexión GraphQL con Monday.com

export const normalizeStr = (s) => {
    if (!s) return "";
    return String(s)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
};

export const cleanCode = (s) => {
    if (!s) return "";
    return String(s).toUpperCase().replace(/[^A-Z0-9]/g, "");
};

export const parseSecuenciaRank = (sec, fallbackPos = 999999) => {
    if (sec !== undefined && sec !== null && String(sec).trim() !== "") {
        const str = String(sec).trim();
        const match = str.match(/^(\d+(?:\.\d+)?)/);
        if (match) {
            return parseFloat(match[1]);
        }
        const anyNum = str.match(/(\d+(?:\.\d+)?)/);
        if (anyNum) {
            return parseFloat(anyNum[1]);
        }
    }
    return fallbackPos !== undefined ? fallbackPos : 999999;
};

export const createMondayClient = (token) => {
    return async (query, variables = {}) => {
        const response = await fetch("https://api.monday.com/v2", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': token,
                'API-Version': '2023-10'
            },
            body: JSON.stringify({ query, variables })
        });
        const result = await response.json();
        if (result.errors) {
            console.error("Error devuelto por Monday API:", JSON.stringify(result.errors));
        }
        return result;
    };
};

export const extractColText = (col) => {
    if (!col) return "";
    if (col.display_value && String(col.display_value).trim() !== "") {
        return String(col.display_value).trim();
    }
    if (col.text && String(col.text).trim() !== "") {
        return String(col.text).trim();
    }
    if (col.linked_items && col.linked_items.length > 0) {
        return col.linked_items.map(li => li.name).filter(Boolean).join(", ");
    }
    if (col.value) {
        try {
            const v = JSON.parse(col.value);
            if (typeof v === 'string' || typeof v === 'number') return String(v).trim();
            if (v && typeof v === 'object') {
                if (v.text) return String(v.text).trim();
                if (v.label) return String(v.label).trim();
                if (Array.isArray(v.labels)) return v.labels.join(", ").trim();
                if (v.item_ids && Array.isArray(v.item_ids)) return v.item_ids.join(", ");
            }
        } catch {}
    }
    return "";
};

export const extractColNumber = (col, defaultVal = 0) => {
    if (!col) return defaultVal;
    const txt = extractColText(col);
    if (!txt) return defaultVal;
    const clean = txt.replace(/[^0-9.-]/g, "");
    const num = parseFloat(clean);
    return isNaN(num) ? defaultVal : num;
};

export const getLinkedIds = (col) => {
    if (!col) return [];
    if (Array.isArray(col.linked_item_ids) && col.linked_item_ids.length) return col.linked_item_ids.map(String);
    if (Array.isArray(col.linked_items) && col.linked_items.length) return col.linked_items.map(li => String(li.id));
    try {
        const v = JSON.parse(col.value || "null");
        if (Array.isArray(v?.linkedPulseIds)) return v.linkedPulseIds.map(l => String(l.linkedPulseId));
    } catch {}
    return [];
};

export const uploadPdfToMonday = async (itemId, token, pdfBytes, fileName) => {
    const form = new FormData();
    const mutation = `mutation ($file: File!) {
        add_file_to_column (
            item_id: ${itemId}, 
            column_id: "file_mm7m2b35", 
            file: $file
        ) {
            id
        }
    }`;

    form.append("query", mutation);
    form.append("map", JSON.stringify({ "file": "variables.file" }));
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    form.append("file", blob, fileName);

    const response = await fetch("https://api.monday.com/v2/file", {
        method: "POST",
        headers: {
            "Authorization": token
        },
        body: form
    });
    return await response.json();
};
