import assert from "node:assert/strict";
import test from "node:test";
import { assertQuietWindow, assertServiceStable, deployImage, verifyAppToken } from "./caprover.mjs";

const origin = "https://captain.example";
const token = "test-only-token";
const oldMessage = "Either tarballfile or captainDefinitionContent should be present.";
const newMessage = "Either uploadedTarPathSource or captainDefinitionContent should be provided, but not both.";
const reply = (status, description, ok = true) => async () => ({ ok, status: ok ? 200 : 403, json: async () => ({ status, description }) });

test("token check sends no image or source and uses only the app-authorized POST route", async () => {
  for (const description of [oldMessage, newMessage]) {
    await verifyAppToken(origin, "gud-demo", token, async (url, options) => {
      assert.equal(url, `${origin}/api/v2/user/apps/appData/gud-demo/`);
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(options.body, "{}");
      assert.equal(options.headers["x-captain-app-token"], token);
      assert.equal(options.headers["x-captain-auth"], undefined);
      return reply(1108, description)();
    });
  }
});

test("authentication errors, arbitrary errors and unexpected successes fail closed without echoing secrets", async () => {
  for (const status of [100, 101, 1102, 1106, 1112, 1108]) {
    await assert.rejects(verifyAppToken(origin, "gud-demo", token, reply(status, token)), error => {
      assert.ok(!error.message.includes(token));
      return /verification failed/.test(error.message);
    });
  }
  await assert.rejects(verifyAppToken(origin, "gud-demo", token, reply(1108, oldMessage, false)));
});

test("real deployment accepts queued status 101, but acknowledgement does not substitute for health verification", async () => {
  const body = { captainDefinitionContent: '{"schemaVersion":2,"imageName":"registry.example/gud@sha256:abc"}', gitHash: "revision" };
  for (const status of [100, 101]) {
    await deployImage(origin, "gud-demo", token, body, async (url, options) => {
      assert.equal(url, `${origin}/api/v2/user/apps/appData/gud-demo/?detached=1`);
      assert.deepEqual(JSON.parse(options.body), body);
      return reply(status, "accepted")();
    });
  }
  await assert.rejects(deployImage(origin, "gud-demo", token, body, reply(1106, token)), /did not acknowledge/);
});

test("network/JSON failures never echo remote messages or tokens", async () => {
  await assert.rejects(verifyAppToken(origin, "gud-demo", token, async () => { throw new Error(token); }), /outcome is unknown/);
  await assert.rejects(verifyAppToken(origin, "gud-demo", token, async () => ({ json: async () => { throw new Error(token); } })), /unexpected CapRover response/);
});

test("active, paused, rollback and unknown Docker updates cannot pass the stability gate", () => {
  assertServiceStable({});
  assertServiceStable({ UpdateStatus: { State: "completed" } });
  for (const state of ["updating", "paused", "rollback_started", "rollback_completed", undefined]) {
    assert.throws(() => assertServiceStable({ UpdateStatus: { State: state } }));
  }
});

test("queue-status limitation requires explicit quiet-window confirmation, with no default acceptance", () => {
  assertQuietWindow("yes");
  for (const answer of ["", "no", undefined]) assert.throws(() => assertQuietWindow(answer));
});
