import type { IncomingMessage } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// In production the OpenWAF edge serves /__waf/challenge/* on your own host.
// In development, Vite proxies it to a host behind OpenWAF. The edge accepts
// challenge requests only from its own origin, so the proxy presents that
// origin. The test sitekeys work on every host with Verify; a real sitekey
// needs a host of its own zone.
const edge = process.env.OPENWAF_EDGE_ORIGIN ?? 'https://developers.openwaf.dev';
const siteverifyUrl = process.env.OPENWAF_SITEVERIFY_URL ?? 'https://dash.openwaf.dev/v1/challenge/siteverify';

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** A tiny backend: POST /api/signup checks the widget token with siteverify. */
function signupApi(): Plugin {
  return {
    name: 'signup-api',
    configureServer(server) {
      server.middlewares.use('/api/signup', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        const form = new URLSearchParams(await readBody(req));
        res.setHeader('content-type', 'application/json');
        try {
          const reply = await fetch(siteverifyUrl, {
            method: 'POST',
            body: new URLSearchParams({
              // Test secret by default: any token passes and nothing is spent.
              secret: process.env.OPENWAF_VERIFY_SECRET ?? 'ows_test_pass',
              response: form.get('owaf-verify-response') ?? '',
            }),
            signal: AbortSignal.timeout(10_000),
          });
          const verdict: unknown = await reply.json();
          const ok = typeof verdict === 'object' && verdict !== null && 'success' in verdict && verdict.success === true;
          res.end(JSON.stringify({ ok, siteverify: verdict }));
        } catch (err) {
          // Transport failure (timeout, network, non-JSON): fail closed.
          res.statusCode = 502;
          res.end(JSON.stringify({ ok: false, siteverify: { error: String(err) } }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), signupApi()],
  resolve: {
    // @openwaf/verify-react is linked from ../../react; use one copy of React.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    proxy: {
      '/__waf/challenge': {
        target: edge,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            if (proxyReq.getHeader('origin')) proxyReq.setHeader('origin', edge);
          });
        },
      },
    },
  },
});
