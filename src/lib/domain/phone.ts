export function normaliseDialNumber(value: unknown): string | null {
  if (typeof value !== "string" || !/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  const number = value.trim().replace(/^(\+44|0044)[\s.-]*\(0\)/, "$1").replace(/[\s().-]/g, "");
  return /^\+?\d{5,15}$/.test(number) ? number.replace(/^00(?=\d)/, "+") : null;
}

export function phoneKey(value: unknown): string | null {
  const number = normaliseDialNumber(value);
  if (!number) return null;
  return /^0\d{10}$/.test(number) ? "+44" + number.slice(1) : number;
}

export function companyPhone(metadata: Record<string, unknown> | null | undefined) {
  const value = metadata?.switchboardPhone;
  return typeof value === "string" && normaliseDialNumber(value) ? value : null;
}
