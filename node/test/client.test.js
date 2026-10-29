import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { inspect } from "node:util";
import {
  SiteverifyClient,
  SiteverifyError,
  newIdempotencyKey,
  TEST_SECRETS,
  TEST_SITEKEYS,
  TEST_TOKEN,
  VERSION,
} from "../dist/index.js";

const SECRET = "ows_" + "Q".repeat(43);

let server;
let base;
let last;
let handler;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      last = { method: req.method, headers: req.headers, body, form: new URLSearchParams(body) };
      handler(req, res, last);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}/v1/challenge/siteverify`;
});
after(() => {
  server.closeAllConnections?.();
  server.close();
});

function reply(status, json, headers = {}) {
  handler = (_req, res) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(typeof json === "string" ? json : JSON.stringify(json));
  };
}

const client = (opts = {}) => new SiteverifyClient({ secret: SECRET, endpoint: base, ...opts });

const OK = {
  success: true,
  challenge_ts: "2026-10-29T10:00:00Z",
  hostname: "example.com",
  action: "login",
  cdata: "abc",
  "error-codes": [],
  metadata: { mode: "managed", interactive: false, risk: "low" },
};

describe("configuration", () => {
  test("empty secret is a config error", () => {
    assert.throws(() => new SiteverifyClient({ secret: "" }), (e) => e instanceof SiteverifyError && e.code === "config");
  });
  test("constants", () => {
    assert.equal(TEST_SECRETS.pass, "ows_test_pass");
    assert.equal(TEST_SITEKEYS.interactive, "owk_test_interactive");
    assert.equal(TEST_TOKEN, "v1.TEST.TOKEN");
  });
  test("newIdempotencyKey is a UUID v4", () => {
    assert.match(newIdempotencyKey(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.notEqual(newIdempotencyKey(), newIdempotencyKey());
  });
  test("secret hidden from inspect, JSON and String", () => {
    const c = client();
    for (const s of [inspect(c, { showHidden: true, depth: 5 }), JSON.stringify(c), String(c), `${c}`]) {
      assert.ok(!s.includes(SECRET), s);
    }
  });
});

describe("request encoding", () => {
  test("form fields, UA, method", async () => {
    reply(200, OK);
    await client().verify("v1.tok", { remoteIp: "203.0.113.7", idempotencyKey: "k-1" });
    assert.equal(last.method, "POST");
    assert.equal(last.headers["content-type"], "application/x-www-form-urlencoded");
    assert.equal(last.headers["user-agent"], `openwaf-verify-node/${VERSION}`);
    assert.equal(last.form.get("secret"), SECRET);
    assert.equal(last.form.get("response"), "v1.tok");
    assert.equal(last.form.get("remoteip"), "203.0.113.7");
    assert.equal(last.form.get("idempotency_key"), "k-1");
  });
  test("optional fields omitted, custom UA", async () => {
    reply(200, OK);
    await client({ userAgent: "my-app/1" }).verify("v1.tok");
    assert.equal(last.form.has("remoteip"), false);
    assert.equal(last.form.has("idempotency_key"), false);
    assert.equal(last.headers["user-agent"], "my-app/1");
  });
  test("injectable fetch", async () => {
    let seen;
    const c = new SiteverifyClient({
      secret: SECRET,
      fetch: async (url, init) => {
        seen = { url, init };
        return new Response(JSON.stringify(OK), { status: 200 });
      },
    });
    const r = await c.verify("v1.tok");
    assert.equal(seen.url, "https://dash.openwaf.dev/v1/challenge/siteverify");
    assert.equal(r.success, true);
  });
});

describe("responses", () => {
  test("success maps camelCase fields", async () => {
    reply(200, { ...OK, metadata: { ...OK.metadata, result_with_testing_key: true } });
    const r = await client().verify("v1.tok");
    assert.equal(r.success, true);
    assert.equal(r.challengeTs, OK.challenge_ts);
    assert.equal(r.hostname, "example.com");
    assert.equal(r.action, "login");
    assert.equal(r.cdata, "abc");
    assert.deepEqual(r.errorCodes, []);
    assert.deepEqual(r.metadata, { mode: "managed", interactive: false, risk: "low", resultWithTestingKey: true });
    assert.equal(r.status, 200);
    assert.equal(r.raw.hostname, "example.com");
  });
  for (const code of [
    "missing-input-secret",
    "invalid-input-secret",
    "missing-input-response",
    "invalid-input-response",
    "timeout-or-duplicate",
    "remoteip-mismatch",
    "internal-error",
  ]) {
    test(`error code ${code}`, async () => {
      reply(200, { success: false, "error-codes": [code] });
      const r = await client().verify("v1.tok");
      assert.equal(r.success, false);
      assert.deepEqual(r.errorCodes, [code]);
    });
  }
  test("400 bad-request", async () => {
    reply(400, { success: false, "error-codes": ["bad-request"] });
    const r = await client().verify("v1.tok");
    assert.deepEqual([r.success, r.status, r.errorCodes], [false, 400, ["bad-request"]]);
  });
  test("405 bad-request", async () => {
    reply(405, { success: false, "error-codes": ["bad-request"] });
    const r = await client().verify("v1.tok");
    assert.deepEqual([r.success, r.status, r.errorCodes], [false, 405, ["bad-request"]]);
  });
  test("429 rate-limited with Retry-After", async () => {
    reply(429, { success: false, "error-codes": ["rate-limited"] }, { "retry-after": "17" });
    const r = await client().verify("v1.tok");
    assert.deepEqual([r.success, r.errorCodes, r.retryAfter], [false, ["rate-limited"], 17]);
  });
  test("non-200 claiming success is not success", async () => {
    reply(400, { success: true, "error-codes": [] });
    assert.equal((await client().verify("v1.tok")).success, false);
  });
});

describe("transport errors", () => {
  const rejectsWith = (p, code, status) =>
    assert.rejects(p, (e) => {
      assert.ok(e instanceof SiteverifyError);
      assert.equal(e.code, code);
      if (status) assert.equal(e.status, status);
      assert.ok(!e.message.includes(SECRET) && !inspect(e).includes(SECRET));
      return true;
    });
  test("5xx is http error", () => {
    reply(502, { "error-codes": [] });
    return rejectsWith(client().verify("v1.tok"), "http", 502);
  });
  test("non-JSON is bad-response", () => {
    reply(200, "<html>oops</html>");
    return rejectsWith(client().verify("v1.tok"), "bad-response", 200);
  });
  test("JSON without error-codes is bad-response", () => {
    reply(200, { success: true });
    return rejectsWith(client().verify("v1.tok"), "bad-response");
  });
  test("timeout", async () => {
    handler = (_req, res) => setTimeout(() => res.end("{}"), 1000);
    const t = Date.now();
    await rejectsWith(client({ timeoutMs: 100 }).verify("v1.tok"), "timeout");
    assert.ok(Date.now() - t < 900);
  });
  test("network error", () =>
    rejectsWith(client({ endpoint: "http://127.0.0.1:1/siteverify" }).verify("v1.tok"), "network"));
});

describe("local checks", () => {
  const boom = async () => {
    throw new Error("must not be called");
  };
  test("empty token short-circuits", async () => {
    const r = await new SiteverifyClient({ secret: SECRET, fetch: boom }).verify("");
    assert.deepEqual([r.success, r.errorCodes, r.status], [false, ["missing-input-response"], 0]);
  });
  test("token over 2048 bytes short-circuits", async () => {
    const c = new SiteverifyClient({ secret: SECRET, fetch: boom });
    assert.deepEqual((await c.verify("v1." + "a".repeat(2046))).errorCodes, ["invalid-input-response"]);
  });
  test("token of exactly 2048 bytes is sent", async () => {
    reply(200, OK);
    assert.equal((await client().verify("v1." + "a".repeat(2045))).success, true);
  });
  test("expected hostname/action match", async () => {
    reply(200, OK);
    const r = await client().verify("v1.tok", { expectedHostname: "example.com", expectedAction: "login" });
    assert.equal(r.success, true);
  });
  test("hostname-mismatch", async () => {
    reply(200, OK);
    const r = await client().verify("v1.tok", { expectedHostname: "www.example.com" });
    assert.deepEqual([r.success, r.errorCodes], [false, ["hostname-mismatch"]]);
  });
  test("action-mismatch", async () => {
    reply(200, OK);
    const r = await client().verify("v1.tok", { expectedAction: "signup" });
    assert.deepEqual([r.success, r.errorCodes], [false, ["action-mismatch"]]);
  });
});
