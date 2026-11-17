import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DemoAdapter } from '../server/demo-adapter.ts';
import { Engine } from '../server/engine.ts';
import { Store } from '../server/store.ts';
import {
  columns,
  columnValue,
  compareRows,
  defaultPreferences,
  matchesFilter,
  moveColumn,
  parsePreferences,
  serializePreferences,
  validFilter,
  type ColumnFilter,
} from '../src/table-model.ts';
async function fixture() {
  const engine = new Engine(new DemoAdapter(0), new Store(':memory:'), 'demo');
  await engine.sync();
  return engine;
}
const filter = (changes: Partial<ColumnFilter>): ColumnFilter => ({
  id: 'filter-1',
  column: 'amountMinor',
  operator: 'between',
  value: '100',
  upper: '1500',
  ...changes,
});

test('table preferences round-trip only permitted layout values, never invoice or filter contents', () => {
  const prefs = {
    ...defaultPreferences(),
    visible: ['invoiceNumber', 'brands'] as const,
    sort: 'amountMinor',
    ascending: true,
    pageSize: 25,
    invoice: 'PRIVATE-1',
    clientName: 'Private client',
    filters: [{ value: 'Private text' }],
  };
  const text = serializePreferences(prefs as any),
    parsed = parsePreferences(text);
  assert.deepEqual(parsed.visible, ['invoiceNumber', 'brands']);
  assert.equal(parsed.sort, 'amountMinor');
  assert.equal(parsed.pageSize, 25);
  for (const forbidden of ['PRIVATE-1', 'Private client', 'Private text', 'filters'])
    assert.equal(text.includes(forbidden), false);
  assert.equal(parsed.order.length, columns.length);
});

test('invalid or outdated preferences recover known columns without losing access to the table', () => {
  assert.deepEqual(parsePreferences('bad JSON'), defaultPreferences());
  assert.deepEqual(parsePreferences('{"version":99}'), defaultPreferences());
  const p = parsePreferences(
    JSON.stringify({
      version: 1,
      order: ['brands', 'brands', 'not-a-column'],
      visible: ['unknown'],
      sort: 'bad',
      ascending: 'yes',
      pageSize: 999,
    }),
  );
  assert.equal(p.order[0], 'brands');
  assert.equal(new Set(p.order).size, columns.length);
  assert.ok(p.visible.length > 0);
  assert.equal(p.sort, 'deliveryDate');
  assert.equal(p.ascending, false);
  assert.equal(p.pageSize, 10);
});

test('column moves support moving in both directions and preserve hidden columns', () => {
  const order = defaultPreferences().order;
  const down = moveColumn(order, 'invoiceNumber', 'deliveryDate');
  assert.equal(down.indexOf('invoiceNumber'), order.indexOf('deliveryDate'));
  const up = moveColumn(down, 'invoiceNumber', 'clientName');
  assert.equal(up.indexOf('invoiceNumber'), down.indexOf('clientName'));
  assert.equal(new Set(up).size, columns.length);
  assert.notEqual(up, order);
});

test('numeric sorting uses actual amounts, keeps missing values last in both directions, and supports every column', async () => {
  const e = await fixture();
  try {
    const s = e.state(),
      a = { ...s.rows[0], amountMinor: 900 },
      b = { ...s.rows[1], amountMinor: 10000 };
    assert.ok(compareRows(a, b, s, 'amountMinor', true) < 0);
    assert.ok(compareRows(a, b, s, 'amountMinor', false) > 0);
    const unknown = { ...a, openBalanceMinor: undefined },
      known = { ...b, openBalanceMinor: 0 };
    assert.ok(compareRows(unknown, known, s, 'openBalanceMinor', true) > 0);
    assert.ok(compareRows(unknown, known, s, 'openBalanceMinor', false) > 0);
    for (const c of columns) {
      assert.ok(Number.isFinite(compareRows(a, b, s, c.id, true)), c.id);
      const v = columnValue(c.id, a, s);
      assert.ok(v === null || ['string', 'number', 'boolean'].includes(typeof v), c.id);
    }
  } finally {
    await e.close();
  }
});

test('column filters combine dollars, dates, boolean values, text and empty values without converting unknown metadata to zero', async () => {
  const e = await fixture();
  try {
    const s = e.state(),
      row = { ...s.rows[0], amountMinor: 128000, onHold: false, deliveryDate: '2026-11-14' };
    assert.equal(matchesFilter(row, s, filter({})), true);
    assert.equal(
      matchesFilter(row, s, filter({ operator: 'gte', value: '1280', upper: '' })),
      true,
    );
    assert.equal(
      matchesFilter(row, s, filter({ operator: 'lte', value: '1279.99', upper: '' })),
      false,
    );
    assert.equal(
      matchesFilter(
        row,
        s,
        filter({ column: 'deliveryDate', value: '2026-11-13', upper: '2026-11-15' }),
      ),
      true,
    );
    assert.equal(
      matchesFilter(row, s, filter({ column: 'onHold', operator: 'equals', value: 'false' })),
      true,
    );
    assert.equal(
      matchesFilter(row, s, filter({ column: 'brands', operator: 'contains', value: 'golden' })),
      true,
    );
    assert.equal(
      matchesFilter(
        { ...row, openBalanceMinor: undefined },
        s,
        filter({ column: 'openBalanceMinor', operator: 'equals', value: '0' }),
      ),
      false,
    );
    assert.equal(
      matchesFilter(
        { ...row, openBalanceMinor: undefined },
        s,
        filter({ column: 'openBalanceMinor', operator: 'empty' }),
      ),
      true,
    );
    assert.equal(
      validFilter(filter({ column: 'deliveryDate', value: '2026-02-30', upper: '2026-11-15' })),
      false,
    );
    assert.equal(validFilter(filter({ value: '1500', upper: '100' })), false);
    assert.equal(validFilter(filter({ value: 'not a number' })), false);
  } finally {
    await e.close();
  }
});

test('linked and unlinked records expose distinct portal metadata and unavailable source data stays empty', async () => {
  const e = await fixture();
  try {
    const s = e.state(),
      missing = s.rows.find((r) => !r.portalId)!,
      linked = s.rows.find((r) => r.portalId)!;
    assert.equal(columnValue('portalStatus', missing, s), 'Not found');
    assert.equal(columnValue('portalAmountMinor', missing, s), null);
    assert.equal(
      columnValue('portalAmountMinor', linked, s),
      Math.round(Number(linked.draft.amount) * 100),
    );
    const portalOnly = { ...linked, sourceAvailable: false };
    assert.equal(columnValue('id', portalOnly, s), null);
    assert.equal(columnValue('lineCount', portalOnly, s), null);
  } finally {
    await e.close();
  }
});

test('source and portal dates remain distinguishable, and timestamp day filters match the displayed local date', async () => {
  const e = await fixture();
  try {
    const s = e.state(),
      linked = s.rows.find((r) => r.portalId)!;
    const stamp = '2026-11-14T01:30:00Z',
      d = new Date(stamp),
      local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const row = {
      ...linked,
      updatedAt: stamp,
      sourceValues: { createdDate: '2026-11-01', deliveryDate: '2026-11-17', amountMinor: 10000 },
      draft: { ...linked.draft, invoiceDate: '2026-11-12', deliveryDate: '2026-11-13' },
    };
    assert.equal(columnValue('sourceDeliveryDate', row, s), '2026-11-17');
    assert.equal(columnValue('portalDeliveryDate', row, s), '2026-11-13');
    assert.equal(columnValue('portalInvoiceDate', row, s), '2026-11-12');
    assert.equal(
      matchesFilter(row, s, filter({ column: 'updatedAt', operator: 'equals', value: local })),
      true,
    );
  } finally {
    await e.close();
  }
});
