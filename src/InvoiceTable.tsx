import {
  Box,
  Checkbox,
  CircularProgress,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TableSortLabel,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ChevronRightRounded,
  DescriptionOutlined,
  DragIndicatorRounded,
  OpenInNewRounded,
  ReceiptLongOutlined,
} from '@mui/icons-material';
import type { InvoiceRow, State } from '../shared/types.ts';
import {
  columns,
  columnValue,
  moveColumn,
  type ColumnId,
  type TablePreferences,
} from './table-model.ts';
import { errorMessages, stages } from '../shared/types.ts';
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
const date = (v: string, withTime = false) => {
  const d = new Date(withTime ? v : `${v}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? v
    : d.toLocaleString(
        'en-US',
        withTime
          ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
          : { month: 'short', day: 'numeric', year: 'numeric' },
      );
};
const colors: Record<string, [string, string]> = {
  pending: ['#54715d', '#eef3eb'],
  review: ['#a17b36', '#fcf5e7'],
  held: ['#965e7e', '#f7edf3'],
  queued: ['#687b94', '#edf1f7'],
  processing: ['#407a9b', '#eaf3f9'],
  attention: ['#b05b4e', '#fcf0ec'],
  completed: ['#398164', '#eaf4ed'],
};
export function RecordLinks({ row, state }: { row: InvoiceRow; state: State }) {
  const source = row.sourceAvailable !== false;
  const pdf =
    source &&
    row.pdfAvailable !== false &&
    row.inScope &&
    state.connected &&
    !state.syncing &&
    !state.worker.running;
  const enc = source && !!state.origins?.encompass;
  const portal = !!row.portalId && !!state.origins?.invoiceApprove;
  return (
    <Stack direction="row" spacing={0.2} onClick={(e) => e.stopPropagation()}>
      <Tooltip title="Source PDF">
        <span>
          <IconButton
            component="a"
            size="small"
            disabled={!pdf}
            href={pdf ? `/api/invoices/${encodeURIComponent(row.id)}/pdf` : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open PDF for ${row.invoiceNumber}`}
          >
            <DescriptionOutlined sx={{ fontSize: 17 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Encompass invoice">
        <span>
          <IconButton
            component="a"
            size="small"
            disabled={!enc}
            href={
              enc
                ? `${state.origins!.encompass}/Home?DashboardID=100100&TableName=Invoice&Search=InvoiceID~${encodeURIComponent(row.id)}`
                : undefined
            }
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open Encompass ${row.invoiceNumber}`}
          >
            <ReceiptLongOutlined sx={{ fontSize: 17 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="InvoiceApprove record">
        <span>
          <IconButton
            component="a"
            size="small"
            disabled={!portal}
            href={
              portal
                ? `${state.origins!.invoiceApprove}/invoices/${encodeURIComponent(row.portalId!)}`
                : undefined
            }
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open InvoiceApprove ${row.invoiceNumber}`}
          >
            <OpenInNewRounded sx={{ fontSize: 17 }} />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}
export default function InvoiceTable({
  rows,
  total,
  page,
  preferences,
  onPreferences,
  onPage,
  selected,
  onSelect,
  onSelectPage,
  eligible,
  state,
  onOpen,
}: {
  rows: InvoiceRow[];
  total: number;
  page: number;
  preferences: TablePreferences;
  onPreferences: (p: TablePreferences) => void;
  onPage: (n: number) => void;
  selected: Set<string>;
  onSelect: (id: string) => void;
  onSelectPage: (checked: boolean) => void;
  eligible: (r: InvoiceRow) => boolean;
  state: State;
  onOpen: (id: string) => void;
}) {
  const visible = preferences.order
    .filter((id) => preferences.visible.includes(id))
    .map((id) => columns.find((c) => c.id === id)!);
  const selectable = rows.filter(eligible);
  function sort(id: ColumnId) {
    onPreferences({
      ...preferences,
      sort: id,
      ascending: preferences.sort === id ? !preferences.ascending : true,
    });
    onPage(0);
  }
  function cell(id: ColumnId, row: InvoiceRow) {
    const value = columnValue(id, row, state);
    if (id === 'links') return <RecordLinks row={row} state={state} />;
    if (id === 'invoiceNumber')
      return (
        <Box>
          <Typography component="span" sx={{ fontSize: 12, fontWeight: 600 }}>
            {row.invoiceNumber}
          </Typography>
          {!preferences.visible.includes('brands') && (
            <div className="brand-cell">{row.brands.join(', ') || '—'}</div>
          )}
        </Box>
      );
    if (id === 'clientName')
      return (
        <Box>
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 500,
              maxWidth: 205,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.clientName}
          </Typography>
          {!preferences.visible.includes('storeName') && (
            <div className="brand-cell">{row.storeName}</div>
          )}
        </Box>
      );
    if (id === 'status') {
      const [color, background] = colors[row.status] ?? ['#78827c', '#f0f1ee'];
      return (
        <Tooltip
          title={
            row.errorCode
              ? errorMessages[row.errorCode]
              : row.status === 'processing'
                ? stages[row.stage]
                : row.issues.join(' ')
          }
        >
          <Box>
            <span className="status-pill" style={{ color, background }}>
              {row.status === 'processing' ? (
                <CircularProgress size={9} color="inherit" />
              ) : (
                <span className="status-dot" style={{ background: color }} />
              )}
              {String(value)}
            </span>
            {row.onHold && row.sourceActive && row.status !== 'held' && (
              <Typography sx={{ fontSize: 10, color: '#965e7e', mt: 0.6 }}>
                On hold in Encompass
              </Typography>
            )}
          </Box>
        </Tooltip>
      );
    }
    if (value === null) return '—';
    const definition = columns.find((c) => c.id === id)!;
    if (definition.kind === 'money') return money(Number(value));
    if (definition.kind === 'date' || definition.kind === 'datetime')
      return date(String(value), definition.kind === 'datetime');
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }
  return (
    <>
      <TableContainer>
        <Table
          aria-label="Invoice queue"
          stickyHeader
          sx={{ tableLayout: 'fixed', minWidth: visible.reduce((sum, c) => sum + c.width, 80) }}
        >
          <colgroup>
            <col style={{ width: 44 }} />
            {visible.map((c) => (
              <col key={c.id} style={{ width: c.width }} />
            ))}
            <col style={{ width: 36 }} />
          </colgroup>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  slotProps={{ input: { 'aria-label': 'Select invoices on this page' } }}
                  checked={!!selectable.length && selectable.every((r) => selected.has(r.id))}
                  indeterminate={
                    selectable.some((r) => selected.has(r.id)) &&
                    !selectable.every((r) => selected.has(r.id))
                  }
                  disabled={!selectable.length}
                  onChange={(_, checked) => onSelectPage(checked)}
                />
              </TableCell>
              {visible.map((c) => (
                <TableCell
                  key={c.id}
                  data-column-id={c.id}
                  align={['money', 'number'].includes(c.kind) ? 'right' : 'left'}
                  sortDirection={
                    preferences.sort === c.id ? (preferences.ascending ? 'asc' : 'desc') : false
                  }
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = e.dataTransfer.getData('text/plain') as ColumnId;
                    if (columns.some((c) => c.id === from))
                      onPreferences({
                        ...preferences,
                        order: moveColumn(preferences.order, from, c.id),
                      });
                  }}
                  sx={{ minWidth: c.width, whiteSpace: 'normal', px: 1.5 }}
                >
                  <Stack
                    direction="row"
                    spacing={0.4}
                    sx={{
                      alignItems: 'center',
                      justifyContent: ['money', 'number'].includes(c.kind)
                        ? 'flex-end'
                        : 'flex-start',
                    }}
                  >
                    <span
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}
                      title={`Drag ${c.label} to reorder`}
                      style={{ cursor: 'grab', display: 'inline-flex' }}
                    >
                      <DragIndicatorRounded sx={{ fontSize: 13, color: '#b1b9ad' }} />
                    </span>
                    <TableSortLabel
                      sx={{
                        whiteSpace: 'normal',
                        fontSize: 10,
                        '& .MuiTableSortLabel-icon': { fontSize: 14, mx: 0.3 },
                      }}
                      active={preferences.sort === c.id}
                      direction={preferences.ascending ? 'asc' : 'desc'}
                      onClick={() => sort(c.id)}
                    >
                      {c.label}
                    </TableSortLabel>
                  </Stack>
                </TableCell>
              ))}
              <TableCell sx={{ width: 35 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className="table-row"
                selected={selected.has(row.id)}
                onClick={() => onOpen(row.id)}
              >
                <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    size="small"
                    checked={selected.has(row.id)}
                    disabled={!eligible(row)}
                    onChange={() => onSelect(row.id)}
                    slotProps={{ input: { 'aria-label': `Select ${row.invoiceNumber}` } }}
                  />
                </TableCell>
                {visible.map((c) => (
                  <TableCell
                    key={c.id}
                    data-column-id={c.id}
                    align={['money', 'number'].includes(c.kind) ? 'right' : 'left'}
                    sx={{
                      fontSize: 11,
                      px: 1.5,
                      color: 'text.secondary',
                      maxWidth: c.id === 'issues' ? 350 : 290,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: ['issues', 'taskStatus', 'workNeeded'].includes(c.id)
                        ? 'normal'
                        : 'nowrap',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: c.kind === 'money' ? 550 : 400,
                    }}
                    title={
                      c.id === 'links' ? undefined : String(columnValue(c.id, row, state) ?? '')
                    }
                  >
                    {cell(c.id, row)}
                  </TableCell>
                ))}
                <TableCell>
                  <IconButton size="small" aria-label={`View ${row.invoiceNumber}`}>
                    <ChevronRightRounded sx={{ fontSize: 17, color: '#9ca994' }} />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        component="div"
        count={total}
        page={page}
        rowsPerPage={preferences.pageSize}
        onPageChange={(_, n) => onPage(n)}
        onRowsPerPageChange={(e) => {
          onPreferences({ ...preferences, pageSize: Number(e.target.value) });
          onPage(0);
        }}
        rowsPerPageOptions={[10, 25, 50, 100]}
        sx={{
          '.MuiTablePagination-toolbar': { minHeight: 59 },
          '.MuiTablePagination-selectLabel,.MuiTablePagination-displayedRows,.MuiSelect-select': {
            fontSize: 11,
            color: '#8a9786',
          },
        }}
      />
    </>
  );
}
