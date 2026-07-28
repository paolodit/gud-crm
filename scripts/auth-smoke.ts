export {};

async function main() {
  const baseUrl = (process.env.AUTH_SMOKE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
  const email = process.env.AUTH_SMOKE_EMAIL;
  const password = process.env.AUTH_SMOKE_PASSWORD;

  if (!email || !password) {
    throw new Error("AUTH_SMOKE_EMAIL and AUTH_SMOKE_PASSWORD are required.");
  }

  const unauthenticated = await fetch(`${baseUrl}/pipeline`, { redirect: "manual" });
  assertRedirectToSignIn(unauthenticated, "Unauthenticated workspace request");

  const signIn = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ email, password, rememberMe: false }),
    redirect: "manual",
  });
  if (!signIn.ok) throw new Error(`Sign-in failed with HTTP ${signIn.status}.`);

  const setCookies = signIn.headers.getSetCookie();
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
  if (!cookie) throw new Error("Sign-in did not issue a session cookie.");

  const session = await fetch(`${baseUrl}/api/auth/get-session`, { headers: { Cookie: cookie, Origin: baseUrl } });
  if (!session.ok) throw new Error(`Session lookup failed with HTTP ${session.status}.`);
  const sessionBody = await session.json() as { user?: { email?: string } };
  if (sessionBody.user?.email?.toLowerCase() !== email.toLowerCase()) {
    throw new Error("The authenticated session did not resolve to the expected user.");
  }

  const workspace = await fetch(`${baseUrl}/pipeline`, { headers: { Cookie: cookie }, redirect: "manual" });
  if (!workspace.ok) throw new Error(`Authenticated workspace request failed with HTTP ${workspace.status}.`);
  const workspaceHtml = await workspace.text();
  if (!workspaceHtml.includes("Your next moves") && !workspaceHtml.includes("Your owned queue is clear")) {
    throw new Error("The authenticated landing page did not render the command centre.");
  }

  const signOut = await fetch(`${baseUrl}/api/auth/sign-out`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, Origin: baseUrl },
    body: "{}",
  });
  if (!signOut.ok) throw new Error(`Sign-out failed with HTTP ${signOut.status}.`);

  const revokedCookies = signOut.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  const afterSignOut = await fetch(`${baseUrl}/pipeline`, {
    headers: { Cookie: revokedCookies || cookie },
    redirect: "manual",
  });
  assertRedirectToSignIn(afterSignOut, "Signed-out workspace request");

  console.log("Authentication smoke test passed: protected route, sign-in, session, landing page and sign-out.");
}

function assertRedirectToSignIn(response: Response, label: string) {
  const location = response.headers.get("location") ?? "";
  if (![301, 302, 303, 307, 308].includes(response.status) || !location.includes("/sign-in")) {
    throw new Error(`${label} was not redirected to sign-in.`);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
