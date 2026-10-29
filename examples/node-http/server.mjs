// Minimal OpenWAF Verify integration with plain node:http (no dependencies).
//
//   cd node && npm ci && npm run build && cd ../examples/node-http
//   OPENWAF_VERIFY_SECRET=ows_test_pass node server.mjs
//
// The page must be served through the OpenWAF edge for /__waf/challenge/v1/widget.js
// to load. Without the edge, POST the test token directly:
//   curl -d owaf-verify-response=v1.TEST.TOKEN http://127.0.0.1:3000/login
import { createServer } from "node:http";
import { SiteverifyClient, SiteverifyError, newIdempotencyKey } from "../../node/dist/index.js";

const secret = process.env.OPENWAF_VERIFY_SECRET;
if (!secret) {
  console.error("Set OPENWAF_VERIFY_SECRET (ows_test_pass for testing).");
  process.exit(1);
}
const sitekey = process.env.OPENWAF_VERIFY_SITEKEY ?? "owk_test_pass";
const port = Number(process.env.PORT ?? 3000);
const verifier = new SiteverifyClient({ secret });

const page = `<!doctype html>
<meta charset="utf-8">
<title>OpenWAF Verify example</title>
<form method="post" action="/login">
  <input name="user" placeholder="user">
  <div id="verify"></div>
  <button>Sign in</button>
</form>
<script>
  window.onVerifyReady = () => owafVerify.render("#verify", { sitekey: ${JSON.stringify(sitekey)}, action: "login" });
</script>
<script src="/__waf/challenge/v1/widget.js?render=explicit&onload=onVerifyReady" async defer></script>`;

// Test secrets answer without an action, so only enforce it with a real secret.
const expectedAction = secret.startsWith("ows_test_") ? undefined : "login";

async function readForm(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 16 * 1024) throw new Error("body too large");
  }
  return new URLSearchParams(body);
}

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page);
  }
  if (req.method === "POST" && req.url === "/login") {
    try {
      const form = await readForm(req);
      const result = await verifier.verify(form.get("owaf-verify-response") ?? "", {
        remoteIp: req.socket.remoteAddress,
        expectedAction,
        idempotencyKey: newIdempotencyKey(),
      });
      res.writeHead(result.success ? 200 : 403, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: result.success, errorCodes: result.errorCodes }));
    } catch (err) {
      const code = err instanceof SiteverifyError ? err.code : "internal";
      res.writeHead(503, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: false, error: code }));
    }
  }
  res.writeHead(404).end();
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}/`));
