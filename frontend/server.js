'use strict';
// zzz855 — production server: Next's own request handler + br/gzip
// compression for every compressible response (including App Router /api
// JSON, which `next start` sent uncompressed). See compress-policy.js.
//
// Behaves like `next start`: PORT env (default 3000), listens on all
// interfaces (no host passed, same as `next start` without -H — dual-stack
// `::`, which includes 0.0.0.0). We do NOT read HOSTNAME for binding:
// Docker sets HOSTNAME to the container id, and `next start` ignores it too.
// Set COMPRESS=0 to switch our compression off (emergency kill-switch).

const http = require('node:http');
const next = require('next');
const { attachCompression } = require('./compress-policy');

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const port = parseInt(process.env.PORT, 10) || 3000;
const compressOn = process.env.COMPRESS !== '0';

const app = next({ dev: false, dir: __dirname, port, hostname: 'localhost' });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const server = http.createServer((req, res) => {
      if (compressOn) attachCompression(req, res);
      Promise.resolve(handle(req, res)).catch((err) => {
        console.error('[server] request failed', req.url, err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Internal Server Error');
        } else {
          res.destroy(err);
        }
      });
    });

    server.listen(port, () => {
      console.log(`  ▲ Next.js production server (compression ${compressOn ? 'br/gzip' : 'off'}) on port ${port}`);
    });

    let shuttingDown = false;
    const shutdown = (signal) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[server] ${signal} received — closing`);
      // Stop accepting, let in-flight requests finish, hard-exit after 10 s.
      const timer = setTimeout(() => process.exit(0), 10_000);
      timer.unref();
      server.close(() => {
        Promise.resolve(typeof app.close === 'function' ? app.close() : undefined)
          .catch(() => {})
          .finally(() => process.exit(0));
      });
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  })
  .catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
  });
