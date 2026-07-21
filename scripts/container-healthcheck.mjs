const port = Number(process.env.PORT ?? 3000);

try {
  const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  const body = await response.json();
  if (!response.ok || body.status !== "ok") process.exit(1);
} catch {
  process.exit(1);
}
