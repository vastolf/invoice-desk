import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { get as httpGet } from 'node:http';

test('local API rejects cross-origin, missing-token, and invalid processing requests', async () => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((r) => reservation.close(() => r()));
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'server/index.ts', '--demo', '--production'],
    { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const base = `http://127.0.0.1:${port}`;
  const end = Date.now() + 15000;
  let state: any;
  try {
    while (Date.now() < end) {
      try {
        const r = await fetch(`${base}/api/state`);
        state = await r.json();
        if (state.connected) break;
      } catch {}
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(state?.mode, 'demo');
    assert.equal(state?.connected, true);
    assert.ok(state.csrfToken);
    assert.equal(
      (
        await fetch(`${base}/api/process`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (await fetch(`${base}/api/state`, { headers: { Origin: 'https://unrelated.example' } }))
        .status,
      403,
    );
    const reboundStatus = await new Promise<number>((resolve, reject) => {
      httpGet(`${base}/api/state`, { headers: { Host: `rebound.example:${port}` } }, (r) => {
        r.resume();
        resolve(r.statusCode ?? 0);
      }).on('error', reject);
    });
    assert.equal(reboundStatus, 403);
    const invalid = await fetch(`${base}/api/process`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-workspace-token': state.csrfToken },
      body: JSON.stringify({ items: [] }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, 'MAPPING_REQUIRED');
    const last = await (await fetch(`${base}/api/state`)).json();
    assert.equal(last.worker.batchTotal, 0);
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
  }
});
