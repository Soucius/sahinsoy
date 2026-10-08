// MongoDB's case-insensitive regex does not equate all Turkish I forms.
// Keep the query literal while allowing either keyboard spelling and NFC/NFD dots.
export function productSearchPattern(value) {
    if (typeof value !== "string") return "";
    const text = value.trim().replace(/([iI])\u0307/g, "$1");
    return text
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/[iIİı]/g, "[iIİı]\u0307?");
}
