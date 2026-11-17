import type { State } from '../shared/types.ts';
let token = '';
export async function getState(): Promise<State> {
  const r = await fetch('/api/state', { cache: 'no-store' });
  if (!r.ok) throw new Error('The local service is unavailable.');
  const s: State = await r.json();
  token = s.csrfToken ?? token;
  return s;
}
export async function mutate(path: string, body: unknown = {}) {
  if (!token) await getState();
  const r = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-workspace-token': token },
    body: JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.message ?? 'The request could not be completed.');
  return value;
}
