const internalDetail = /\b(sql|select|insert|update|delete\s+from|constraint|relation|column|database|postgres|sqlite|drizzle|econn\w*|etimedout|stack trace)\b/i;

export function publicActionError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  const message = error.message.trim();
  if (!message || message.length > 240 || message.includes("\n") || internalDetail.test(message)) {
    console.error(fallback, error);
    return fallback;
  }
  return message;
}
