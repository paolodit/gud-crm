export function normaliseName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

export function isSafeHttpUrl(value: string) {
  const candidate = value.trim();
  if (!candidate || !URL.canParse(candidate)) return false;
  const protocol = new URL(candidate).protocol;
  return protocol === "http:" || protocol === "https:";
}

export function normaliseHttpUrlInput(value: string) {
  const candidate = value.trim();
  if (!candidate) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) return candidate;
  return `https://${candidate.replace(/^\/+/, "")}`;
}

export function safeExternalUrl(value: string | null | undefined) {
  const candidate = value?.trim() ?? "";
  return isSafeHttpUrl(candidate) ? candidate : null;
}

export function extractDomain(value: string) {
  const candidate = value.trim();
  if (!candidate) return null;
  try {
    const complete = candidate.includes("://") ? candidate : `https://${candidate}`;
    if (!isSafeHttpUrl(complete)) return null;
    const url = new URL(complete);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
