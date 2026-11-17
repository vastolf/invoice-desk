import 'dotenv/config';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { Engine } from './engine.ts';
import { Store } from './store.ts';
import { LiveAdapter } from './live-adapter.ts';
import { DemoAdapter } from './demo-adapter.ts';
import { AppError, processSchema } from './domain.ts';
import { errorMessages } from '../shared/types.ts';
import { acquireWorkspaceLock } from './lock.ts';

const demo = process.argv.includes('--demo'),
  production = process.argv.includes('--production');
const port = Number(process.env.PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
const releaseLock = demo ? () => {} : acquireWorkspaceLock(resolve('data/worker.lock'));
const store = new Store(demo ? ':memory:' : resolve('data/queue.sqlite'));
const engine = new Engine(
  demo ? new DemoAdapter() : new LiveAdapter(process.env),
  store,
  demo ? 'demo' : 'live',
);
const token = randomBytes(32).toString('hex');
const app = express();
app.disable('x-powered-by');
const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
app.use((req, res, next) => {
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '')) {
    res.status(403).end();
    return;
  }
  if (req.path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.headers.origin && !origins.has(req.headers.origin)) {
      res.status(403).json({ error: 'ORIGIN_REJECTED' });
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-workspace-token'] !== token) {
      res.status(403).json({ error: 'TOKEN_REQUIRED' });
      return;
    }
  }
  next();
});
app.use(express.json({ limit: '256kb' }));
const clients = new Set<express.Response>();
function state() {
  const result = engine.state();
  try {
    if (!demo)
      result.origins = {
        encompass: new URL(process.env.ENCOMPASS_URL!).origin,
        invoiceApprove: new URL(process.env.INVOICE_APPROVE_URL!).origin,
      };
  } catch {}
  return result;
}
engine.onChange = () => {
  const message = `data: ${JSON.stringify(state())}\n\n`;
  for (const res of clients) res.write(message);
};
app.get('/api/state', (_req, res) => res.json({ ...state(), csrfToken: token }));
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  res.write(`data: ${JSON.stringify(state())}\n\n`);
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
  req.on('close', () => {
    clients.delete(res);
    clearInterval(heartbeat);
  });
});
app.post('/api/refresh', async (_req, res) => {
  await engine.sync();
  res.json({ ok: true });
});
app.post('/api/connect', async (_req, res) => {
  await engine.sync(true);
  res.json({ ok: true });
});
app.post('/api/process', (req, res) => {
  engine.enqueue(processSchema.parse(req.body).items);
  res.status(202).json({ ok: true });
});
app.post('/api/worker/pause', (_req, res) => {
  engine.pause(true);
  res.json({ ok: true });
});
app.post('/api/worker/resume', (_req, res) => {
  engine.pause(false);
  res.json({ ok: true });
});
app.post('/api/worker/cancel', (_req, res) => {
  engine.cancelQueued();
  res.json({ ok: true });
});
app.get('/api/invoices/:id/pdf', async (req, res) => {
  const row = engine.rows.get(req.params.id);
  if (!row?.inScope) throw new AppError('OUT_OF_SCOPE');
  if (engine.running || engine.syncing) throw new AppError('WORKER_BUSY');
  const bytes = await engine.adapter.pdf(row.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="invoice.pdf"');
  res.send(bytes);
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
app.use(
  (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const code =
      error instanceof AppError
        ? error.code
        : (error as { name?: string })?.name === 'ZodError'
          ? 'MAPPING_REQUIRED'
          : 'REMOTE_UNAVAILABLE';
    const status =
      code === 'WORKER_BUSY'
        ? 409
        : code === 'OUT_OF_SCOPE'
          ? 403
          : code === 'MAPPING_REQUIRED'
            ? 400
            : code === 'AUTH_REQUIRED'
              ? 401
              : 502;
    res.status(status).json({
      error: code,
      message:
        errorMessages[code] ??
        (code === 'WORKER_BUSY'
          ? 'The worker is busy. Wait for the current operation to finish.'
          : 'The request could not be completed.'),
    });
  },
);
let vite: import('vite').ViteDevServer | undefined;
const server = createHttpServer(app);
if (production) {
  app.use(express.static(resolve('dist'), { index: false }));
  app.use((_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  vite = await createServer({
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
server.listen(port, '127.0.0.1', () => {
  console.log(
    `Invoice Desk: http://127.0.0.1:${port} (${demo ? 'sample data' : 'live connections'})`,
  );
  void engine.sync().catch(() => {});
});
server.on('error', async () => {
  console.error(
    'Could not start Invoice Desk. Check whether the configured port is already in use.',
  );
  releaseLock();
  await engine.close();
  await vite?.close();
  process.exitCode = 1;
});
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const res of clients) res.end();
  clients.clear();
  await engine.close();
  releaseLock();
  await vite?.close();
  server.close();
}
process.on('SIGINT', () => {
  void shutdown();
});
process.on('SIGTERM', () => {
  void shutdown();
});
