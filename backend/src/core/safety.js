export function safeString(value) {
  return typeof value === "string" ? value : "";
}

export function safeSubstring(value, len = 200) {
  return safeString(value).substring(0, len);
}

export function extractSymbol(text) {
  if (!text || typeof text !== "string") return null;
  const cleaned = text
    .replace(/\//g, "")
    .replace(/analyze/gi, "")
    .trim()
    .toUpperCase();
  const parts = cleaned.split(" ").filter(Boolean);
  const symbol = parts[parts.length - 1];
  if (!symbol || symbol.length < 3) return null;
  return symbol;
}

export function shouldAnalyze(symbol) {
  if (!symbol) return false;
  if (symbol.length < 3) return false;
  if (!/^[A-Z]+$/.test(symbol)) return false;
  const IGNORE = ["HI", "HELLO", "HEY", "OK", "THANKS", "GOOD", "NICE"];
  if (IGNORE.includes(symbol)) return false;
  return true;
}

export function safeObject(obj) {
  return obj && typeof obj === "object" ? obj : {};
}
