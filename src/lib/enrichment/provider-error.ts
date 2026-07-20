export type EnrichmentProviderErrorCode =
  | "invalid_key"
  | "exhausted"
  | "rate_limited"
  | "pending"
  | "provider_error";

export class EnrichmentProviderError extends Error {
  constructor(
    public readonly provider: "hunter" | "norbert",
    public readonly code: EnrichmentProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EnrichmentProviderError";
  }
}
