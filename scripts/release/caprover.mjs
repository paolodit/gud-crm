// App tokens authorize only POST /apps/appData/:appName, not the GET status API.
// An empty JSON body reaches the authenticated handler's missing-source check,
// which returns before scheduleDeployNewVersion in CapRover 1.13+.
const missingSourceMessages = new Set([
  "Either tarballfile or captainDefinitionContent should be present.",
  "Either uploadedTarPathSource or captainDefinitionContent should be provided, but not both.",
]);

async function request(captainUrl, app, token, body, detached, fetchImpl) {
  if (!/^[a-z0-9-]+$/.test(app) || !token || /[\r\n\0]/.test(token)) throw new Error("Invalid app-token request configuration.");
  const url = new URL(captainUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("CapRover requires an HTTPS origin without credentials.");
  url.pathname = `/api/v2/user/apps/appData/${app}/`;
  url.search = detached ? "?detached=1" : "";
  url.hash = "";
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(60000),
      headers: { "Content-Type": "application/json", "x-namespace": "captain", "x-captain-app-token": token },
      body: JSON.stringify(body),
    });
  } catch { throw new Error(`${app}: cannot reach CapRover; request outcome is unknown. Inspect CapRover before retrying.`); }
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`${app}: unexpected CapRover response. Inspect CapRover before retrying.`); }
  return { response, result };
}

export async function verifyAppToken(captainUrl, app, token, fetchImpl = fetch) {
  const { response, result } = await request(captainUrl, app, token, {}, false, fetchImpl);
  if (!response.ok || result?.status !== 1108 || !missingSourceMessages.has(result.description)) {
    // Do not echo arbitrary remote messages, credentials or response bodies.
    const status = Number.isInteger(result?.status) ? result.status : "unknown";
    throw new Error(`${app}: token verification failed (HTTP ${response.status}, API ${status}). No image was submitted.`);
  }
}

export async function deployImage(captainUrl, app, token, body, fetchImpl = fetch) {
  if (typeof body?.captainDefinitionContent !== "string" || !body.captainDefinitionContent) throw new Error("An image definition is required.");
  const { response, result } = await request(captainUrl, app, token, body, true, fetchImpl);
  if (!response.ok || ![100, 101].includes(result?.status)) {
    throw new Error(`${app}: CapRover did not acknowledge deployment. Inspect CapRover before retrying.`);
  }
}

export function assertServiceStable(service) {
  const state = service.UpdateStatus?.State;
  if (service.UpdateStatus && state !== "completed") {
    throw new Error("Docker reports an incomplete/failed service update. Inspect CapRover before releasing.");
  }
}

export function assertQuietWindow(answer) {
  if (answer !== "yes") throw new Error("Rollout cancelled: confirm no queued/running CapRover builds before releasing.");
}
