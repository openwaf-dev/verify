// Live tests against the public siteverify endpoint, using test secrets only.
// Skip with OPENWAF_VERIFY_LIVE=0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SiteverifyClient, TEST_SECRETS, TEST_TOKEN, newIdempotencyKey } from "../dist/index.js";

const skip = process.env.OPENWAF_VERIFY_LIVE === "0" ? "OPENWAF_VERIFY_LIVE=0" : false;

test("live: pass secret", { skip }, async () => {
  const r = await new SiteverifyClient({ secret: TEST_SECRETS.pass }).verify(TEST_TOKEN, {
    idempotencyKey: newIdempotencyKey(),
  });
  assert.equal(r.success, true);
  assert.equal(r.hostname, "example.com");
  assert.equal(r.metadata?.resultWithTestingKey, true);
  assert.deepEqual(r.errorCodes, []);
});

test("live: fail secret", { skip }, async () => {
  const r = await new SiteverifyClient({ secret: TEST_SECRETS.fail }).verify(TEST_TOKEN);
  assert.deepEqual([r.success, r.errorCodes], [false, ["invalid-input-response"]]);
});

test("live: spent secret", { skip }, async () => {
  const r = await new SiteverifyClient({ secret: TEST_SECRETS.spent }).verify(TEST_TOKEN);
  assert.deepEqual([r.success, r.errorCodes], [false, ["timeout-or-duplicate"]]);
});

test("live: invalid real-format secret", { skip }, async () => {
  const r = await new SiteverifyClient({ secret: "ows_" + "A".repeat(43) }).verify(TEST_TOKEN);
  assert.equal(r.success, false);
  // The server validates the token before the secret: without a genuine token the
  // answer is invalid-input-response; with one it is invalid-input-secret.
  assert.ok(
    r.errorCodes.some((c) => c === "invalid-input-secret" || c === "invalid-input-response"),
    String(r.errorCodes),
  );
});
