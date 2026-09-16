export type DensityPage = "pipeline" | "live" | "companies";

export function cardDensityKey(memberKey: string, page: DensityPage) {
  return `gud-card-density:${encodeURIComponent(memberKey)}:${page}`;
}

export function isCompactDensity(value: string | null) {
  return value === "compact";
}
