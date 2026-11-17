import type { InvoiceRow, State } from '../shared/types.ts';
export const statusLabels = {
  pending: 'Pending',
  review: 'Needs review',
  held: 'On hold',
  queued: 'Queued',
  processing: 'Processing',
  attention: 'Needs attention',
  completed: 'Completed',
  excluded: 'Other clients',
  unclassified: 'Unclassified',
  portal_only: 'Portal only',
};
export const taskLabels: Record<string, string> = {
  '1': 'Assigned',
  '4': 'Completed',
  '19': 'Invoice Not Complete–Do Not Pick',
};
export const words = (s: string) => s.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
export function workLabel(r: InvoiceRow) {
  if (r.status === 'held') return 'Resolve Encompass hold';
  if (r.workNeeded === 'submit') return 'Submit to InvoiceApprove';
  if (r.workNeeded === 'complete') return 'Complete Encompass';
  if (r.status === 'completed') return 'None';
  if (r.portalStatus === 'rejected') return 'Resolve portal rejection';
  if (r.status === 'excluded') return 'Not applicable';
  if (r.status === 'portal_only') return 'Locate source invoice';
  if (r.status === 'review') return 'Review record links';
  return 'Establish applicability';
}
export type ColumnKind =
  'text' | 'number' | 'money' | 'date' | 'datetime' | 'choice' | 'boolean' | 'links';
export const columns = [
  { id: 'invoiceNumber', label: 'Invoice', kind: 'text', width: 140, default: true },
  { id: 'clientName', label: 'Client', kind: 'text', width: 165, default: true },
  { id: 'brands', label: 'Brands', kind: 'text', width: 160 },
  { id: 'memo', label: 'Invoice memo', kind: 'text', width: 250 },
  { id: 'storeName', label: 'Final store', kind: 'choice', width: 150 },
  { id: 'deliveryMethod', label: 'Delivery method', kind: 'choice', width: 150 },
  { id: 'invoiceDate', label: 'Invoice date', kind: 'date', width: 130 },
  { id: 'createdDate', label: 'Encompass creation date', kind: 'date', width: 160 },
  { id: 'sourceDeliveryDate', label: 'Encompass delivery date', kind: 'date', width: 160 },
  { id: 'portalInvoiceDate', label: 'Portal invoice date', kind: 'date', width: 145 },
  { id: 'portalDeliveryDate', label: 'Portal delivery date', kind: 'date', width: 145 },
  { id: 'deliveryDate', label: 'Delivery date', kind: 'date', width: 115, default: true },
  { id: 'amountMinor', label: 'Encompass gross', kind: 'money', width: 110, default: true },
  { id: 'portalAmountMinor', label: 'Portal gross', kind: 'money', width: 120 },
  { id: 'status', label: 'Queue status', kind: 'choice', width: 115, default: true },
  { id: 'taskStatus', label: 'Sales-task status', kind: 'choice', width: 155, default: true },
  { id: 'portalStatus', label: 'Portal status', kind: 'choice', width: 110, default: true },
  { id: 'workNeeded', label: 'Next action', kind: 'choice', width: 185 },
  { id: 'sourceStatus', label: 'Encompass status', kind: 'choice', width: 140 },
  { id: 'sourceActive', label: 'Encompass active', kind: 'boolean', width: 140 },
  { id: 'pdfAvailable', label: 'Source PDF available', kind: 'boolean', width: 160 },
  { id: 'onHold', label: 'Encompass hold', kind: 'boolean', width: 140 },
  { id: 'termName', label: 'Payment terms', kind: 'choice', width: 145 },
  { id: 'routeName', label: 'Planned route', kind: 'choice', width: 160 },
  { id: 'offDayDelivery', label: 'Off-day delivery', kind: 'boolean', width: 135 },
  { id: 'totalCases', label: 'Cases', kind: 'number', width: 90 },
  { id: 'lineCount', label: 'Line items', kind: 'number', width: 100 },
  { id: 'openBalanceMinor', label: 'Open balance', kind: 'money', width: 125 },
  { id: 'openCreditMinor', label: 'Open credit', kind: 'money', width: 120 },
  { id: 'chainName', label: 'Customer chain', kind: 'choice', width: 185 },
  { id: 'distributorName', label: 'Distributor', kind: 'choice', width: 160 },
  { id: 'intakeStatus', label: 'Intake status', kind: 'choice', width: 145 },
  { id: 'creditStatus', label: 'Credit status', kind: 'choice', width: 155 },
  { id: 'waitingOnRep', label: 'Waiting on rep', kind: 'boolean', width: 135 },
  { id: 'paymentDate', label: 'Payment date', kind: 'date', width: 130 },
  { id: 'acceptedAt', label: 'Store acceptance', kind: 'datetime', width: 165 },
  { id: 'portalArchived', label: 'Portal archived', kind: 'boolean', width: 135 },
  { id: 'portalEditability', label: 'Portal header/file editing', kind: 'choice', width: 185 },
  { id: 'attachmentCount', label: 'Portal files', kind: 'number', width: 110 },
  { id: 'mappingCount', label: 'Mapping examples', kind: 'number', width: 140 },
  { id: 'differences', label: 'Record differences', kind: 'text', width: 210 },
  { id: 'issues', label: 'Issues', kind: 'text', width: 270 },
  { id: 'applicability', label: 'Client mapping basis', kind: 'choice', width: 165 },
  { id: 'stage', label: 'Worker stage', kind: 'choice', width: 165 },
  { id: 'updatedAt', label: 'Last checked', kind: 'datetime', width: 165 },
  { id: 'id', label: 'Encompass invoice ID', kind: 'text', width: 170 },
  { id: 'clientId', label: 'Encompass client ID', kind: 'text', width: 165 },
  { id: 'taskId', label: 'Sales-task ID', kind: 'text', width: 150 },
  { id: 'portalId', label: 'InvoiceApprove ID', kind: 'text', width: 275 },
  { id: 'links', label: 'Links', kind: 'links', width: 110, default: true },
] as const;
export type ColumnId = (typeof columns)[number]['id'];
export type Column = (typeof columns)[number];
export type CellValue = string | number | boolean | null;
export interface TablePreferences {
  version: 1;
  order: ColumnId[];
  visible: ColumnId[];
  sort: ColumnId;
  ascending: boolean;
  pageSize: number;
}
export const preferenceKey = 'invoice-desk.table.v1';
const ids = new Set<string>(columns.map((c) => c.id));
const validId = (id: unknown): id is ColumnId => typeof id === 'string' && ids.has(id);
export function defaultPreferences(): TablePreferences {
  return {
    version: 1,
    order: columns.map((c) => c.id),
    visible: columns.filter((c) => 'default' in c && c.default).map((c) => c.id),
    sort: 'deliveryDate',
    ascending: false,
    pageSize: 10,
  };
}
export function parsePreferences(raw: string | null): TablePreferences {
  const defaults = defaultPreferences();
  try {
    const p = JSON.parse(raw ?? 'null');
    if (!p || p.version !== 1) return defaults;
    const order: ColumnId[] = Array.isArray(p.order)
      ? [...new Set<ColumnId>(p.order.filter(validId))]
      : [];
    for (const c of columns) if (!order.includes(c.id)) order.push(c.id);
    const visible: ColumnId[] = Array.isArray(p.visible)
      ? [...new Set<ColumnId>(p.visible.filter(validId))]
      : defaults.visible;
    return {
      version: 1,
      order,
      visible: visible.length ? visible : defaults.visible,
      sort: validId(p.sort) ? p.sort : defaults.sort,
      ascending: typeof p.ascending === 'boolean' ? p.ascending : defaults.ascending,
      pageSize: [10, 25, 50, 100].includes(p.pageSize) ? p.pageSize : 10,
    };
  } catch {
    return defaults;
  }
}
export function serializePreferences(p: TablePreferences) {
  return JSON.stringify(parsePreferences(JSON.stringify(p)));
}
export function moveColumn(order: ColumnId[], from: ColumnId, to: ColumnId) {
  const next = order.filter((id) => id !== from);
  const at = order.indexOf(to);
  if (at < 0 || from === to) return order;
  next.splice(at, 0, from);
  return next;
}
export function columnValue(id: ColumnId, r: InvoiceRow, s: State): CellValue {
  switch (id) {
    case 'brands':
      return [...r.brands].sort().join(', ') || null;
    case 'deliveryMethod':
      return r.draft.deliveryMethod || null;
    case 'createdDate':
      return r.sourceValues?.createdDate || null;
    case 'sourceDeliveryDate':
      return r.sourceValues?.deliveryDate || null;
    case 'portalInvoiceDate':
      return r.portalId ? r.draft.invoiceDate || null : null;
    case 'portalDeliveryDate':
      return r.portalId ? r.draft.deliveryDate || null : null;
    case 'portalAmountMinor':
      return r.portalId ? Math.round(Number(r.draft.amount) * 100) : null;
    case 'status':
      return statusLabels[r.status];
    case 'workNeeded':
      return workLabel(r);
    case 'taskStatus':
      return r.taskComplete
        ? 'Completed'
        : r.taskStatus
          ? (taskLabels[r.taskStatus] ?? words(r.taskStatus))
          : null;
    case 'portalStatus':
      return r.portalStatus ? words(r.portalStatus) : 'Not found';
    case 'portalEditability':
      return r.portalEditability ? words(r.portalEditability) : null;
    case 'sourceStatus':
      return r.sourceStatus || null;
    case 'lineCount':
      return r.sourceAvailable === false ? null : (r.lineCount ?? null);
    case 'chainName':
      return s.clients?.find((c) => c.id === r.clientId)?.chainName || null;
    case 'distributorName':
      return s.options.distributors.find((d) => d.id === r.draft.distributorId)?.name || null;
    case 'mappingCount':
      return r.mappingEvidence?.length
        ? Math.max(...r.mappingEvidence.map((e) => e.count ?? e.sourceIds.length))
        : null;
    case 'differences':
      return r.differences?.map(words).join(', ') || null;
    case 'issues':
      return r.issues.join(' ') || null;
    case 'intakeStatus':
      return r.intakeStatus ? words(r.intakeStatus) : null;
    case 'creditStatus':
      return r.creditStatus ? words(r.creditStatus) : null;
    case 'applicability':
      return r.applicability
        ? {
            established: 'Invoice history',
            same_chain: 'Established chain',
            other_chain: 'Other chain',
            unclassified: 'Unclassified',
          }[r.applicability]
        : null;
    case 'stage':
      return words(r.stage);
    case 'links':
      return (
        Number(r.pdfAvailable !== false && r.sourceAvailable !== false) +
        Number(r.sourceAvailable !== false) +
        Number(!!r.portalId)
      );
    case 'id':
      return r.sourceAvailable === false ? null : r.id;
    case 'storeName':
      return ['—', 'Destination unresolved'].includes(r.storeName) ? null : r.storeName;
    default: {
      const v = r[id as keyof InvoiceRow];
      return typeof v === 'string'
        ? v || null
        : typeof v === 'number' || typeof v === 'boolean'
          ? v
          : null;
    }
  }
}
const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function compareRows(
  a: InvoiceRow,
  b: InvoiceRow,
  s: State,
  id: ColumnId,
  ascending: boolean,
) {
  const av = columnValue(id, a, s),
    bv = columnValue(id, b, s);
  if (av === null && bv !== null) return 1;
  if (bv === null && av !== null) return -1;
  const difference =
    av === null && bv === null
      ? 0
      : typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : typeof av === 'boolean' && typeof bv === 'boolean'
          ? Number(av) - Number(bv)
          : collator.compare(String(av), String(bv));
  return (
    difference * (ascending ? 1 : -1) ||
    collator.compare(a.invoiceNumber, b.invoiceNumber) ||
    a.id.localeCompare(b.id)
  );
}
export interface ColumnFilter {
  id: string;
  column: ColumnId;
  operator: string;
  value: string;
  upper: string;
}
export function operators(kind: ColumnKind): { id: string; label: string }[] {
  const common = [
    { id: 'empty', label: 'Is empty' },
    { id: 'notEmpty', label: 'Is not empty' },
  ];
  if (kind === 'boolean') return [{ id: 'equals', label: 'Is' }, ...common];
  if (['number', 'money', 'links', 'date', 'datetime'].includes(kind))
    return [
      { id: 'equals', label: kind === 'date' ? 'Is on' : 'Equals' },
      { id: 'notEquals', label: 'Does not equal' },
      { id: 'gte', label: kind === 'date' ? 'On or after' : 'At least' },
      { id: 'lte', label: kind === 'date' ? 'On or before' : 'At most' },
      { id: 'between', label: 'Between' },
      ...common,
    ];
  return [
    { id: 'contains', label: 'Contains' },
    { id: 'equals', label: 'Is' },
    { id: 'notEquals', label: 'Is not' },
    { id: 'notContains', label: 'Does not contain' },
    ...common,
  ];
}
export function validFilter(f: ColumnFilter): boolean {
  const c = columns.find((c) => c.id === f.column);
  if (!c || !operators(c.kind).some((op) => op.id === f.operator)) return false;
  if (['empty', 'notEmpty'].includes(f.operator)) return true;
  const valid = (v: string) =>
    c.kind === 'boolean'
      ? ['true', 'false'].includes(v)
      : ['money', 'number', 'links'].includes(c.kind)
        ? v.trim() !== '' && Number.isFinite(Number(v))
        : ['date', 'datetime'].includes(c.kind)
          ? /^\d{4}-\d{2}-\d{2}$/.test(v) &&
            !Number.isNaN(Date.parse(v)) &&
            new Date(v).toISOString().slice(0, 10) === v
          : !!v.trim();
  if (!valid(f.value) || (f.operator === 'between' && !valid(f.upper))) return false;
  return (
    f.operator !== 'between' ||
    (['money', 'number', 'links'].includes(c.kind)
      ? Number(f.value) <= Number(f.upper)
      : f.value <= f.upper)
  );
}
export function matchesFilter(row: InvoiceRow, state: State, f: ColumnFilter): boolean {
  if (!validFilter(f)) return true;
  const c = columns.find((c) => c.id === f.column)!;
  let value = columnValue(f.column, row, state);
  if (f.operator === 'empty') return value === null;
  if (f.operator === 'notEmpty') return value !== null;
  if (value === null) return false;
  if (c.kind === 'money') value = Number(value) / 100;
  if (c.kind === 'datetime') {
    const d = new Date(String(value));
    value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const a = ['money', 'number', 'links'].includes(c.kind)
    ? Number(value)
    : c.kind === 'boolean'
      ? String(value)
      : String(value).toLocaleLowerCase();
  const parse = (v: string) =>
    ['money', 'number', 'links'].includes(c.kind) ? Number(v) : v.trim().toLocaleLowerCase();
  const b = parse(f.value);
  switch (f.operator) {
    case 'equals':
      return a === b;
    case 'notEquals':
      return a !== b;
    case 'contains':
      return String(a).includes(String(b));
    case 'notContains':
      return !String(a).includes(String(b));
    case 'gte':
      return a >= b;
    case 'lte':
      return a <= b;
    case 'between':
      return a >= b && a <= parse(f.upper);
    default:
      return true;
  }
}

export function filterSummary(f: ColumnFilter) {
  const c = columns.find((c) => c.id === f.column)!;
  const operator = operators(c.kind).find((op) => op.id === f.operator)?.label ?? f.operator;
  const value = c.kind === 'boolean' ? (f.value === 'true' ? 'Yes' : 'No') : f.value;
  return `${c.label}: ${operator}${['empty', 'notEmpty'].includes(f.operator) ? '' : ` ${value}${f.operator === 'between' ? ` and ${f.upper}` : ''}`}`;
}
