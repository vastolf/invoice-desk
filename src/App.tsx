import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputAdornment,
  InputLabel,
  LinearProgress,
  MenuItem,
  Popover,
  Select,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArrowBackRounded,
  ArrowForwardRounded,
  CheckRounded,
  CheckCircleOutlineRounded,
  ChevronRightRounded,
  CloseRounded,
  DescriptionOutlined,
  ExpandMoreRounded,
  FilterListRounded,
  HistoryRounded,
  InboxOutlined,
  LinkRounded,
  MoreHorizRounded,
  ViewColumnOutlined,
  TuneRounded,
  PauseRounded,
  PlayArrowRounded,
  ReceiptLongOutlined,
  RefreshRounded,
  SearchRounded,
  SyncRounded,
  TodayOutlined,
  WarningAmberRounded,
} from '@mui/icons-material';
import type { Draft, InvoiceRow, QueueStatus, State } from '../shared/types.ts';
import { errorMessages, stages } from '../shared/types.ts';
import { getState, mutate } from './api.ts';
import Clients from './Clients.tsx';
import RecordDetails from './RecordDetails.tsx';
import InvoiceTable from './InvoiceTable.tsx';
import { ColumnSettings, ColumnFilters } from './TableSettings.tsx';
import {
  columns,
  columnValue,
  compareRows,
  matchesFilter,
  parsePreferences,
  preferenceKey,
  serializePreferences,
  filterSummary,
  type ColumnFilter,
  type TablePreferences,
} from './table-model.ts';

const currency = (minor: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(minor / 100);
const dateLabel = (value: string) =>
  value
    ? new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';
const timeLabel = (value: string) =>
  new Date(value).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const eligible = (r: InvoiceRow) =>
  r.inScope &&
  r.canProcess !== false &&
  !!r.revision &&
  !['completed', 'queued', 'processing', 'excluded', 'unclassified', 'portal_only'].includes(
    r.status,
  );
const unfinished = (r: InvoiceRow) =>
  ['submit', 'complete'].includes(r.workNeeded ?? '') && r.status !== 'completed';
const needsReview = (r: InvoiceRow) =>
  ['review', 'attention'].includes(r.status) && r.workNeeded !== 'none';
const statusInfo: Record<QueueStatus, { label: string; color: string; background: string }> = {
  pending: { label: 'Pending', color: '#54715d', background: '#eef3eb' },
  review: { label: 'Needs review', color: '#a17b36', background: '#fcf5e7' },
  held: { label: 'On hold', color: '#965e7e', background: '#f7edf3' },
  queued: { label: 'Queued', color: '#687b94', background: '#edf1f7' },
  processing: { label: 'Processing', color: '#407a9b', background: '#eaf3f9' },
  attention: { label: 'Needs attention', color: '#b05b4e', background: '#fcf0ec' },
  completed: { label: 'Completed', color: '#398164', background: '#eaf4ed' },
  excluded: { label: 'Other clients', color: '#78827c', background: '#f0f1ee' },
  unclassified: { label: 'Unclassified', color: '#8c7856', background: '#f6f2eb' },
  portal_only: { label: 'Portal only', color: '#687b94', background: '#edf1f7' },
};
function Status({ row }: { row: InvoiceRow }) {
  const s = statusInfo[row.status];
  return (
    <span className="status-pill" style={{ color: s.color, background: s.background }}>
      {row.status === 'processing' ? (
        <CircularProgress size={9} color="inherit" />
      ) : (
        <span className="status-dot" style={{ background: s.color }} />
      )}
      {s.label}
    </span>
  );
}
const validDraft = (d: Draft) =>
  !!d.distributorId &&
  d.brandIds.length > 0 &&
  !!d.deliveryMethod &&
  (d.deliveryMethod === 'CK Distribution' || !!d.storeId) &&
  /^\d{4}-\d{2}-\d{2}$/.test(d.invoiceDate) &&
  /^\d{4}-\d{2}-\d{2}$/.test(d.deliveryDate) &&
  /^\d+(\.\d{1,2})?$/.test(d.amount);
const initial: State = {
  mode: 'live',
  connected: false,
  syncing: false,
  lastSync: null,
  connectionError: null,
  rows: [],
  options: { brands: [], stores: [], distributors: [] },
  worker: {
    running: false,
    paused: false,
    queued: 0,
    activeId: null,
    batchTotal: 0,
    batchFinished: 0,
  },
};

export default function App() {
  const [state, setState] = useState<State>(initial),
    [loaded, setLoaded] = useState(false),
    [streamConnected, setStreamConnected] = useState(true),
    [notice, setNotice] = useState('');
  const [view, setView] = useState<'queue' | 'activity' | 'clients'>('queue'),
    [connections, setConnections] = useState(false),
    [tab, setTab] = useState('queue');
  const [search, setSearch] = useState(
      () => new URLSearchParams(window.location.search).get('invoice')?.slice(0, 100) ?? '',
    ),
    [client, setClient] = useState<string | null>(null),
    [mine, setMine] = useState(true),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [dateField, setDateField] = useState<'invoiceDate' | 'deliveryDate'>('deliveryDate');
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [detailId, setDetailId] = useState<string | null>(null),
    [reviewIds, setReviewIds] = useState<string[]>([]);
  const [preferences, setPreferences] = useState<TablePreferences>(() => {
    try {
      return parsePreferences(localStorage.getItem(preferenceKey));
    } catch {
      return parsePreferences(null);
    }
  });
  const [columnSettings, setColumnSettings] = useState(false),
    [filterSettings, setFilterSettings] = useState(false),
    [advancedFilters, setAdvancedFilters] = useState<ColumnFilter[]>([]),
    [page, setPage] = useState(0),
    [acting, setActing] = useState(false);
  const { sort, ascending, pageSize } = preferences;
  useEffect(() => {
    try {
      localStorage.setItem(preferenceKey, serializePreferences(preferences));
    } catch {
      setNotice('Table preferences could not be saved in this browser.');
    }
  }, [preferences]);
  useEffect(() => {
    let alive = true;
    getState()
      .then((s) => {
        if (alive) {
          setState(s);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (alive) {
          setNotice(e.message);
          setLoaded(true);
        }
      });
    const stream = new EventSource('/api/events');
    stream.onmessage = (e) => {
      if (alive) {
        setState(JSON.parse(e.data));
        setLoaded(true);
        setStreamConnected(true);
      }
    };
    stream.onerror = () => setStreamConnected(false);
    return () => {
      alive = false;
      stream.close();
    };
  }, []);
  useEffect(() => {
    setPage(0);
  }, [
    search,
    client,
    mine,
    start,
    end,
    dateField,
    tab,
    pageSize,
    sort,
    ascending,
    advancedFilters,
  ]);
  useEffect(() => {
    setSelected(
      (current) =>
        new Set(
          [...current].filter((id) => {
            const row = state.rows.find((r) => r.id === id);
            return row && eligible(row);
          }),
        ),
    );
  }, [state.rows]);
  const rows = state.rows.filter((r) => !mine || r.inScope);
  const counts = {
    queue: rows.filter(unfinished).length,
    submit: rows.filter((r) => unfinished(r) && r.workNeeded === 'submit').length,
    complete: rows.filter((r) => unfinished(r) && r.workNeeded === 'complete').length,
    attention: rows.filter(needsReview).length,
    held: rows.filter((r) => r.onHold && r.sourceActive).length,
    processing: rows.filter((r) => ['queued', 'processing'].includes(r.status)).length,
    completed: rows.filter((r) => r.status === 'completed').length,
  };
  const filtered = useMemo(
    () =>
      state.rows
        .filter(
          (r) =>
            (!mine || r.inScope) &&
            (tab === 'all' ||
              (tab === 'queue'
                ? unfinished(r)
                : tab === 'attention'
                  ? needsReview(r)
                  : tab === 'held'
                    ? r.onHold && r.sourceActive
                    : tab === 'portal_issues'
                      ? r.portalStatus === 'rejected' && r.workNeeded === 'none'
                      : tab === 'completed'
                        ? r.status === 'completed'
                        : tab === 'excluded'
                          ? r.status === 'excluded'
                          : tab === 'unclassified'
                            ? r.status === 'unclassified'
                            : tab === 'portal_only'
                              ? r.status === 'portal_only'
                              : tab === 'submit'
                                ? unfinished(r) && r.workNeeded === 'submit'
                                : tab === 'complete'
                                  ? unfinished(r) && r.workNeeded === 'complete'
                                  : ['queued', 'processing'].includes(r.status))) &&
            (!client || r.clientId === client) &&
            (!search ||
              columns.some((c) =>
                String(columnValue(c.id, r, state) ?? '')
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              ) ||
              r.memo.toLowerCase().includes(search.toLowerCase())) &&
            advancedFilters.every((f) => matchesFilter(r, state, f)) &&
            (!start || r[dateField] >= start) &&
            (!end || r[dateField] <= end),
        )
        .sort((a, b) => compareRows(a, b, state, sort, ascending)),
    [
      state.rows,
      state.options,
      state.clients,
      mine,
      tab,
      client,
      search,
      start,
      end,
      dateField,
      sort,
      ascending,
      advancedFilters,
    ],
  );
  const safePage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1)),
    pageRows = filtered.slice(safePage * pageSize, (safePage + 1) * pageSize),
    selectable = pageRows.filter(eligible);
  const active = state.rows.find((r) => r.id === state.worker.activeId),
    detail = state.rows.find((r) => r.id === detailId);
  const selectedRows = state.rows.filter((r) => selected.has(r.id));
  async function action(path: string) {
    setActing(true);
    try {
      await mutate(path);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setActing(false);
    }
  }
  function select(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      next.has(id)
        ? next.delete(id)
        : next.size < 100
          ? next.add(id)
          : setNotice('Process up to 100 invoices in one batch.');
      return next;
    });
  }
  const connected = state.connected && streamConnected;
  const hasFilters = !!(search || client || start || end || !mine || advancedFilters.length);
  const events = state.rows
    .flatMap((r) =>
      r.events.map((event, i) => ({
        ...event,
        invoice: r.invoiceNumber,
        row: r,
        id: `${r.id}-${i}`,
      })),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <ReceiptLongOutlined sx={{ fontSize: 21 }} />
          </span>
          Invoice Desk
        </div>
        <Nav
          active={view === 'queue'}
          onClick={() => setView('queue')}
          icon={<InboxOutlined sx={{ fontSize: 18 }} />}
          label="Invoice queue"
          count={counts.queue}
        />
        <Nav
          active={view === 'activity'}
          onClick={() => setView('activity')}
          icon={<HistoryRounded sx={{ fontSize: 18 }} />}
          label="Activity"
        />
        <Nav
          active={view === 'clients'}
          onClick={() => setView('clients')}
          icon={<LinkRounded sx={{ fontSize: 18 }} />}
          label="Clients & mappings"
          count={
            state.clients?.filter((c) => ['established', 'same_chain'].includes(c.classification))
              .length
          }
        />
        <Nav
          active={false}
          onClick={() => setConnections(true)}
          icon={<LinkRounded sx={{ fontSize: 18 }} />}
          label="Connections"
        />
        {(state.worker.running || state.worker.paused) && (
          <Stack
            className="sidebar-footer"
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', p: 1.5 }}
          >
            <span className="connection-dot" />
            <Typography sx={{ fontSize: 11 }}>
              {state.worker.paused ? 'Processing paused' : 'Processing'}
            </Typography>
          </Stack>
        )}
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <Typography className="topbar-date" sx={{ fontSize: 11, color: 'text.secondary' }}>
            {new Date().toLocaleDateString('en-US', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
            })}
          </Typography>
          <div className="mobile-brand">
            <ReceiptLongOutlined fontSize="small" />
            Invoice Desk
          </div>
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <IconButton
              className="mobile-nav"
              aria-label={view === 'clients' ? 'Show invoice queue' : 'Show clients and mappings'}
              onClick={() => setView(view === 'clients' ? 'queue' : 'clients')}
              size="small"
            >
              {view === 'clients' ? (
                <InboxOutlined fontSize="small" />
              ) : (
                <LinkRounded fontSize="small" />
              )}
            </IconButton>
            <IconButton
              className="mobile-nav"
              aria-label={view === 'queue' ? 'Show activity' : 'Show invoice queue'}
              onClick={() => setView(view === 'queue' ? 'activity' : 'queue')}
              size="small"
            >
              {view === 'queue' ? (
                <HistoryRounded fontSize="small" />
              ) : (
                <InboxOutlined fontSize="small" />
              )}
            </IconButton>
            <ButtonBase
              onClick={() => setConnections(true)}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                fontSize: 11,
                color: 'text.secondary',
                borderRadius: 1,
                p: 0.6,
              }}
            >
              <span
                className="connection-dot"
                style={{
                  background: state.mode === 'demo' ? '#bf943d' : connected ? '#5b9976' : '#ad8c67',
                }}
              />
              {state.mode === 'demo'
                ? 'Demo mode'
                : state.syncing
                  ? 'Connecting…'
                  : connected
                    ? 'Apps connected'
                    : 'Connect apps'}
            </ButtonBase>
          </Stack>
        </header>
        <main className="main-content">
          {state.mode === 'demo' && (
            <Alert
              severity="info"
              icon={<DescriptionOutlined fontSize="small" />}
              sx={{
                mb: 2.5,
                bgcolor: '#edf2eb',
                color: '#5b715c',
                fontSize: 12,
                '& .MuiAlert-icon': { color: '#6c8268' },
              }}
            >
              Demo data. No live invoices will be changed.
            </Alert>
          )}
          {!streamConnected && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              Live updates disconnected. Reconnecting to the local service…
            </Alert>
          )}
          {state.connectionError && (
            <Alert
              severity="error"
              sx={{ mb: 2 }}
              action={
                <Button color="inherit" size="small" onClick={() => setConnections(true)}>
                  Connections
                </Button>
              }
            >
              {errorMessages[state.connectionError] ?? 'The apps could not be connected.'}
            </Alert>
          )}
          <div className="page-heading">
            <Box>
              <Typography variant="h4" sx={{ fontSize: { xs: 28, md: 32 } }}>
                {view === 'queue'
                  ? 'Invoice queue'
                  : view === 'clients'
                    ? 'Clients & mappings'
                    : 'Activity'}
              </Typography>
            </Box>
            <Stack className="page-heading-actions" direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={
                  state.syncing ? (
                    <CircularProgress size={14} />
                  ) : (
                    <RefreshRounded sx={{ fontSize: 17 }} />
                  )
                }
                disabled={
                  acting || state.syncing || state.worker.running || state.worker.queued > 0
                }
                onClick={() => action(state.connected ? 'refresh' : 'connect')}
              >
                {state.syncing ? 'Refreshing' : 'Refresh invoices'}
              </Button>
              {view === 'queue' && (
                <Button
                  variant="contained"
                  startIcon={<PlayArrowRounded sx={{ fontSize: 17 }} />}
                  disabled={!selected.size || !connected || state.syncing || acting}
                  onClick={() => setReviewIds(selectedRows.map((r) => r.id))}
                >
                  Process selected{selected.size ? ` (${selected.size})` : ''}
                </Button>
              )}
            </Stack>
          </div>
          {state.worker.batchTotal > 0 &&
            (state.worker.running || state.worker.queued > 0 || state.worker.paused) && (
              <div className="worker-banner">
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    {state.worker.paused && !active ? (
                      <PauseRounded color="primary" />
                    ) : (
                      <CircularProgress size={20} />
                    )}
                    <Box>
                      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                        {active
                          ? `${active.invoiceNumber} · ${stages[active.stage]}`
                          : state.worker.paused
                            ? 'Batch paused'
                            : 'Starting batch'}
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.4 }}>
                        {state.worker.batchFinished} of {state.worker.batchTotal} finished ·{' '}
                        {state.worker.queued} waiting
                        {state.worker.paused && active ? ' · pausing after this invoice' : ''}
                      </Typography>
                    </Box>
                  </Stack>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      startIcon={state.worker.paused ? <PlayArrowRounded /> : <PauseRounded />}
                      onClick={() => action(`worker/${state.worker.paused ? 'resume' : 'pause'}`)}
                    >
                      {state.worker.paused ? 'Resume' : 'Pause'}
                    </Button>
                    {state.worker.queued > 0 && (
                      <Button
                        size="small"
                        color="secondary"
                        onClick={() => action('worker/cancel')}
                      >
                        Clear waiting
                      </Button>
                    )}
                  </Stack>
                </Stack>
                <LinearProgress
                  variant="determinate"
                  value={
                    state.worker.batchTotal
                      ? (state.worker.batchFinished / state.worker.batchTotal) * 100
                      : 0
                  }
                  sx={{ mt: 1.5, height: 3, borderRadius: 2, bgcolor: '#dfeadc' }}
                />
              </div>
            )}
          {view === 'queue' && (
            <div className="stats">
              <Stat
                title="To submit"
                value={counts.submit}
                icon={<InboxOutlined sx={{ fontSize: 17 }} />}
                color="#617759"
                background="#f0f3eb"
                onClick={() => {
                  setView('queue');
                  setTab('submit');
                }}
              />
              <Stat
                title="Complete Encompass"
                value={counts.complete}
                icon={<CheckCircleOutlineRounded sx={{ fontSize: 17 }} />}
                color="#6a8798"
                background="#eef3f6"
                onClick={() => {
                  setView('queue');
                  setTab('complete');
                }}
              />
              <Stat
                title="Needs review"
                value={counts.attention}
                icon={<WarningAmberRounded sx={{ fontSize: 17 }} />}
                color="#ae8b4b"
                background="#fbf5e9"
                onClick={() => {
                  setView('queue');
                  setTab('attention');
                }}
              />
              <Stat
                title="Completed"
                value={counts.completed}
                icon={<CheckCircleOutlineRounded sx={{ fontSize: 17 }} />}
                color="#5b9674"
                background="#eaf3ed"
                onClick={() => {
                  setView('queue');
                  setTab('completed');
                }}
              />
            </div>
          )}
          {view === 'clients' ? (
            <Clients
              state={state}
              onInvoices={(id) => {
                setClient(id);
                setMine(false);
                setView('queue');
                setTab('all');
              }}
            />
          ) : view === 'activity' ? (
            <div className="activity-list">
              {events.length ? (
                events.map((e) => (
                  <ButtonBase
                    key={e.id}
                    onClick={() => setDetailId(e.row.id)}
                    sx={{
                      display: 'flex',
                      textAlign: 'left',
                      width: '100%',
                      py: 2,
                      gap: 2,
                      borderBottom: '1px solid #eef0ea',
                    }}
                  >
                    <span
                      className="step-icon"
                      style={{
                        background: e.outcome === 'failed' ? '#fcf0ec' : '#edf4ec',
                        color: e.outcome === 'failed' ? '#b05b4e' : '#508064',
                      }}
                    >
                      {e.outcome === 'failed' ? (
                        <WarningAmberRounded sx={{ fontSize: 16 }} />
                      ) : (
                        <CheckRounded sx={{ fontSize: 16 }} />
                      )}
                    </span>
                    <Box sx={{ flex: 1 }}>
                      <Typography sx={{ fontSize: 12, fontWeight: 550 }}>
                        {e.invoice}{' '}
                        <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
                          · {stages[e.stage]}
                        </Box>
                      </Typography>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5 }}>
                        {e.errorCode
                          ? errorMessages[e.errorCode]
                          : e.outcome === 'started'
                            ? 'Started'
                            : e.outcome === 'verified'
                              ? 'Verified'
                              : e.outcome}
                      </Typography>
                    </Box>
                    <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
                      {timeLabel(e.at)}
                    </Typography>
                    <ChevronRightRounded sx={{ fontSize: 16, color: '#8f9c8a' }} />
                  </ButtonBase>
                ))
              ) : (
                <Empty icon={<HistoryRounded />} title="No activity" />
              )}
            </div>
          ) : (
            <div className="table-shell">
              <Stack
                className="table-toolbar-tabs"
                direction="row"
                sx={{
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  px: { xs: 1, md: 2.5 },
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Tabs
                  value={tab}
                  onChange={(_, v) => setTab(v)}
                  sx={{
                    minHeight: 53,
                    '& .MuiTab-root': {
                      minHeight: 53,
                      fontSize: 12,
                      textTransform: 'none',
                      px: 1.6,
                    },
                    '& .MuiTabs-indicator': { height: 2 },
                  }}
                  variant="scrollable"
                  scrollButtons="auto"
                >
                  <Tab value="queue" label={<TabLabel text="To finish" count={counts.queue} />} />
                  {(tab === 'submit' || tab === 'complete') && (
                    <Tab
                      value={tab}
                      label={tab === 'submit' ? 'To submit' : 'Complete Encompass'}
                    />
                  )}
                  <Tab
                    value="attention"
                    label={<TabLabel text="Needs review" count={counts.attention} />}
                  />
                  <Tab value="processing" label="In progress" />
                  <Tab value="held" label={<TabLabel text="On hold" count={counts.held} />} />
                  <Tab value="completed" label="Completed" />
                  <Tab value="excluded" label="Other clients" />
                  <Tab value="unclassified" label="Unclassified" />
                  <Tab value="portal_only" label="Portal only" />
                  <Tab value="portal_issues" label="Past rejections" />
                  <Tab value="all" label="All invoices" />
                </Tabs>
                <Tooltip title="Show all invoices">
                  <IconButton
                    size="small"
                    onClick={() => {
                      setTab('all');
                      setMine(false);
                    }}
                    aria-label="Show all visible invoices"
                  >
                    <MoreHorizRounded sx={{ fontSize: 20, color: '#91a08b' }} />
                  </IconButton>
                </Tooltip>
              </Stack>
              <div className="filter-toolbar">
                <TextField
                  placeholder="Search invoices, clients, or brands…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  sx={{ flex: 1, minWidth: 220 }}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchRounded sx={{ fontSize: 18, color: '#96a18f' }} />
                        </InputAdornment>
                      ),
                    },
                    htmlInput: { 'aria-label': 'Search invoices' },
                  }}
                />
                <Autocomplete
                  className="client-filter"
                  options={state.clients ?? []}
                  getOptionLabel={(c) => c.name}
                  isOptionEqualToValue={(a, b) => a.id === b.id}
                  value={(state.clients ?? []).find((c) => c.id === client) ?? null}
                  onChange={(_, v) => setClient(v?.id ?? null)}
                  sx={{ width: 210 }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      placeholder="All clients"
                      slotProps={{
                        ...params.slotProps,
                        htmlInput: {
                          ...params.slotProps.htmlInput,
                          'aria-label': 'Filter by client',
                        },
                      }}
                    />
                  )}
                />
                <Button
                  className="date-trigger"
                  variant="outlined"
                  color="secondary"
                  startIcon={<TodayOutlined sx={{ fontSize: 15 }} />}
                  endIcon={<ExpandMoreRounded sx={{ fontSize: 15 }} />}
                  onClick={(e) => setDateAnchor(e.currentTarget)}
                >
                  {start || end ? 'Date range applied' : 'Date range'}
                </Button>
                <Tooltip
                  title={
                    mine
                      ? 'Showing your assigned and managed rep scope'
                      : 'Showing every visible invoice'
                  }
                >
                  <Button
                    variant="outlined"
                    color="secondary"
                    startIcon={<FilterListRounded sx={{ fontSize: 16 }} />}
                    onClick={() => setMine(!mine)}
                  >
                    {mine ? 'Assigned scope' : 'All visible'}
                  </Button>
                </Tooltip>
                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={<TuneRounded sx={{ fontSize: 16 }} />}
                  onClick={() => setFilterSettings(true)}
                >
                  Filters{advancedFilters.length ? ` (${advancedFilters.length})` : ''}
                </Button>
                <Button
                  variant="outlined"
                  color="secondary"
                  startIcon={<ViewColumnOutlined sx={{ fontSize: 16 }} />}
                  onClick={() => setColumnSettings(true)}
                >
                  Columns
                </Button>
                {hasFilters && (
                  <Button
                    color="secondary"
                    onClick={() => {
                      setSearch('');
                      setClient(null);
                      setStart('');
                      setEnd('');
                      setMine(true);
                      setAdvancedFilters([]);
                    }}
                  >
                    Reset
                  </Button>
                )}
              </div>
              {advancedFilters.length > 0 && (
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ px: 2.5, pb: 1.5, flexWrap: 'wrap' }}
                >
                  {advancedFilters.map((f) => (
                    <Chip
                      key={f.id}
                      size="small"
                      label={filterSummary(f)}
                      onDelete={() =>
                        setAdvancedFilters((filters) => filters.filter((v) => v.id !== f.id))
                      }
                    />
                  ))}
                </Stack>
              )}
              {selected.size > 0 && (
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{
                    alignItems: 'center',
                    py: 1,
                    px: 2.5,
                    bgcolor: '#f1f6ed',
                    borderTop: '1px solid #e3ebdf',
                    borderBottom: '1px solid #e3ebdf',
                  }}
                >
                  <Typography sx={{ fontSize: 11, fontWeight: 600 }}>
                    {selected.size} invoice{selected.size === 1 ? '' : 's'} selected
                  </Typography>
                  <Button
                    size="small"
                    sx={{ fontSize: 11, minHeight: 26 }}
                    onClick={() => setSelected(new Set())}
                  >
                    Clear selection
                  </Button>
                  {filtered.filter(eligible).length > selected.size && (
                    <Button
                      size="small"
                      sx={{ fontSize: 11, minHeight: 26 }}
                      onClick={() =>
                        setSelected(
                          new Set(
                            filtered
                              .filter(eligible)
                              .slice(0, 100)
                              .map((r) => r.id),
                          ),
                        )
                      }
                    >
                      Select all {Math.min(filtered.filter(eligible).length, 100)} matches
                    </Button>
                  )}
                </Stack>
              )}
              {(!loaded || state.syncing) && !state.rows.length ? (
                <Box sx={{ p: 8, textAlign: 'center' }}>
                  <CircularProgress size={25} />
                  <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 2 }}>
                    Connecting to Encompass and InvoiceApprove…
                  </Typography>
                </Box>
              ) : !state.connected && !state.rows.length ? (
                <Empty
                  icon={<LinkRounded />}
                  title="Apps not connected"
                  text="Connect Encompass and InvoiceApprove."
                  action={
                    <Button
                      variant="contained"
                      onClick={() => action('connect')}
                      disabled={acting || state.syncing}
                    >
                      Connect apps
                    </Button>
                  }
                />
              ) : !filtered.length ? (
                <Empty
                  icon={<CheckCircleOutlineRounded />}
                  title={
                    hasFilters
                      ? 'No matching invoices'
                      : tab === 'completed'
                        ? 'No completed invoices'
                        : tab === 'attention'
                          ? 'No invoices need review'
                          : tab === 'processing'
                            ? 'No invoices in progress'
                            : tab === 'queue'
                              ? 'No pending invoices'
                              : 'No invoices'
                  }
                />
              ) : (
                <InvoiceTable
                  rows={pageRows}
                  total={filtered.length}
                  page={safePage}
                  preferences={preferences}
                  onPreferences={setPreferences}
                  onPage={setPage}
                  selected={selected}
                  onSelect={select}
                  eligible={eligible}
                  state={state}
                  onOpen={setDetailId}
                  onSelectPage={(checked) =>
                    setSelected((current) => {
                      const next = new Set(current);
                      for (const row of selectable)
                        checked ? next.size < 100 && next.add(row.id) : next.delete(row.id);
                      return next;
                    })
                  }
                />
              )}
            </div>
          )}
          <div className="page-footer">
            {state.reconciliation && (
              <span>
                {state.reconciliation.sourceInvoices.toLocaleString()} Encompass ·{' '}
                {state.reconciliation.portalInvoices.toLocaleString()} InvoiceApprove ·{' '}
                {state.reconciliation.linkedInvoices.toLocaleString()} linked
              </span>
            )}
            <span>
              {state.lastSync ? `Last refreshed ${timeLabel(state.lastSync)}` : 'Not refreshed'}
            </span>
          </div>
        </main>
      </div>
      {columnSettings && (
        <ColumnSettings
          preferences={preferences}
          onClose={() => setColumnSettings(false)}
          onApply={(p) => {
            setPreferences(p);
            setColumnSettings(false);
          }}
        />
      )}
      {filterSettings && (
        <ColumnFilters
          filters={advancedFilters}
          state={state}
          onClose={() => setFilterSettings(false)}
          onApply={(f) => {
            setAdvancedFilters(f);
            setFilterSettings(false);
          }}
        />
      )}
      <Popover
        open={!!dateAnchor}
        anchorEl={dateAnchor}
        onClose={() => setDateAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ p: 2.5, width: 310 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 2 }}>Filter by date</Typography>
          <Stack spacing={2}>
            <TextField
              select
              label="Date field"
              value={dateField}
              onChange={(e) => setDateField(e.target.value as typeof dateField)}
            >
              <MenuItem value="deliveryDate">Delivery date</MenuItem>
              <MenuItem value="invoiceDate">Invoice date</MenuItem>
            </TextField>
            <TextField
              label="From"
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              label="Through"
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
              <Button
                onClick={() => {
                  setStart('');
                  setEnd('');
                }}
              >
                Clear
              </Button>
              <Button variant="contained" onClick={() => setDateAnchor(null)}>
                Apply
              </Button>
            </Stack>
          </Stack>
        </Box>
      </Popover>
      <Drawer
        anchor="right"
        open={!!detail}
        onClose={() => setDetailId(null)}
        slotProps={{ paper: { sx: { width: { xs: '100%', sm: 470 }, p: 3.5 } } }}
      >
        {detail && (
          <>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                INVOICE DETAILS
              </Typography>
              <IconButton onClick={() => setDetailId(null)} aria-label="Close details">
                <CloseRounded fontSize="small" />
              </IconButton>
            </Stack>
            <Typography variant="h5" sx={{ fontWeight: 600, mt: 2 }}>
              {detail.invoiceNumber}
            </Typography>
            <Typography sx={{ fontSize: 13, color: 'text.secondary', mt: 0.7, mb: 2 }}>
              {detail.clientName}
            </Typography>
            <Box>
              <Status row={detail} />
            </Box>
            <Divider sx={{ my: 3 }} />
            <Stack spacing={2}>
              {[
                ['Encompass total', currency(detail.amountMinor)],
                ['Invoice date', dateLabel(detail.draft.invoiceDate)],
                ['Delivery date', dateLabel(detail.deliveryDate)],
                ['Store', detail.storeName || '—'],
                ['Brands', detail.brands.join(', ') || 'Not mapped'],
                ['Portal status', detail.portalStatus ?? 'Not submitted'],
              ].map(([label, value]) => (
                <Stack
                  direction="row"
                  spacing={2}
                  key={label}
                  sx={{ justifyContent: 'space-between' }}
                >
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{label}</Typography>
                  <Typography
                    sx={{ fontSize: 12, fontWeight: 500, textAlign: 'right', maxWidth: 240 }}
                  >
                    {value}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            {detail.errorCode && (
              <Alert severity="error" sx={{ mt: 3, fontSize: 12 }}>
                {errorMessages[detail.errorCode] ?? detail.errorCode}
              </Alert>
            )}
            {detail.issues.length > 0 && (
              <Alert severity="warning" sx={{ mt: 3, fontSize: 12 }}>
                {detail.issues.map((i) => (
                  <Box key={i} sx={{ mb: 0.6 }}>
                    {i}
                  </Box>
                ))}
              </Alert>
            )}
            <RecordDetails row={detail} state={state} />
            {['submit', 'complete'].includes(detail.workNeeded ?? '') && (
              <>
                <Typography sx={{ fontSize: 12, fontWeight: 600, mt: 4, mb: 2 }}>
                  Processing steps
                </Typography>
                <Steps row={detail} />
              </>
            )}
            {detail.events.length > 0 && (
              <>
                <Typography sx={{ fontSize: 12, fontWeight: 600, mt: 1, mb: 1 }}>
                  Recent activity
                </Typography>
                {detail.events.slice(0, 6).map((e, i) => (
                  <Stack key={i} direction="row" sx={{ justifyContent: 'space-between', py: 0.8 }}>
                    <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                      {stages[e.stage]} · {e.outcome}
                    </Typography>
                    <Typography sx={{ fontSize: 10, color: 'text.secondary' }}>
                      {timeLabel(e.at)}
                    </Typography>
                  </Stack>
                ))}
              </>
            )}
            <Box sx={{ mt: 'auto', pt: 3 }}>
              <Stack spacing={1}>
                {['submit', 'complete'].includes(detail.workNeeded ?? '') && (
                  <Button
                    variant="contained"
                    disabled={!eligible(detail) || !connected || state.syncing}
                    startIcon={<PlayArrowRounded />}
                    onClick={() => {
                      setReviewIds([detail.id]);
                      setDetailId(null);
                    }}
                  >
                    {detail.portalVerified ? 'Complete Encompass' : 'Process invoice'}
                  </Button>
                )}
                <Button
                  variant="outlined"
                  disabled={
                    !detail.inScope ||
                    detail.sourceAvailable === false ||
                    state.worker.running ||
                    state.syncing
                  }
                  startIcon={<DescriptionOutlined />}
                  onClick={() =>
                    window.open(
                      `/api/invoices/${encodeURIComponent(detail.id)}/pdf`,
                      '_blank',
                      'noopener,noreferrer',
                    )
                  }
                >
                  View Encompass PDF
                </Button>
              </Stack>
            </Box>
          </>
        )}
      </Drawer>
      <Dialog open={connections} onClose={() => setConnections(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 19 }}>
          Connections
          <IconButton
            onClick={() => setConnections(false)}
            sx={{ position: 'absolute', right: 14, top: 13 }}
            aria-label="Close connections"
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 3 }}>
            Credentials are configured in .env.
          </Typography>
          {['Encompass', 'InvoiceApprove'].map((name, i) => (
            <Stack
              key={name}
              direction="row"
              spacing={2}
              sx={{
                alignItems: 'center',
                border: '1px solid #e5e9e0',
                borderRadius: 2,
                p: 2,
                mb: 1.5,
              }}
            >
              <Avatar
                variant="rounded"
                sx={{ bgcolor: i ? '#eef0e8' : '#eaf1eb', color: '#63816a', fontSize: 16 }}
              >
                {name[0]}
              </Avatar>
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ fontSize: 13, fontWeight: 600 }}>{name}</Typography>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.4 }}>
                  {i
                    ? 'Submit invoice details and attachments'
                    : 'Read invoices and complete sales tasks'}
                </Typography>
              </Box>
              <Chip
                size="small"
                label={
                  state.mode === 'demo'
                    ? 'Sample'
                    : state.syncing
                      ? 'Connecting'
                      : connected
                        ? 'Connected'
                        : 'Not connected'
                }
                color={connected ? 'success' : 'default'}
                variant="outlined"
              />
            </Stack>
          ))}
          {state.connectionError && (
            <Alert severity="error" sx={{ fontSize: 12, mt: 2 }}>
              {errorMessages[state.connectionError]}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3 }}>
          <Button onClick={() => setConnections(false)}>Close</Button>
          <Button
            variant="contained"
            disabled={
              state.syncing ||
              state.worker.running ||
              (state.worker.queued > 0 && !state.worker.paused) ||
              acting
            }
            startIcon={state.syncing ? <CircularProgress size={14} /> : <RefreshRounded />}
            onClick={() => action('connect')}
          >
            Reconnect apps
          </Button>
        </DialogActions>
      </Dialog>
      {reviewIds.length > 0 && (
        <ReviewDialog
          ids={reviewIds}
          state={state}
          onClose={() => setReviewIds([])}
          onError={setNotice}
          onStarted={() => {
            setReviewIds([]);
            setSelected(new Set());
            setTab('processing');
            setNotice('Batch queued.');
          }}
        />
      )}
      <Snackbar
        open={!!notice}
        autoHideDuration={6500}
        onClose={() => setNotice('')}
        message={notice}
        action={
          <IconButton
            size="small"
            color="inherit"
            onClick={() => setNotice('')}
            aria-label="Dismiss notification"
          >
            <CloseRounded fontSize="small" />
          </IconButton>
        }
      />
    </div>
  );
}

function Nav({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.4,
        textAlign: 'left',
        width: '100%',
        px: 1.6,
        py: 1.3,
        borderRadius: 1.5,
        mb: 0.5,
        bgcolor: active ? '#eaf1e6' : 'transparent',
        color: active ? '#3c6345' : '#82907b',
        '&:hover': { bgcolor: active ? '#eaf1e6' : '#f6f8f3' },
      }}
    >
      {icon}
      <Typography sx={{ fontSize: 12, fontWeight: active ? 600 : 450, flex: 1 }}>
        {label}
      </Typography>
      {count !== undefined && (
        <Box
          sx={{
            fontSize: 10,
            fontWeight: 600,
            bgcolor: active ? '#dce8d5' : '#eff2eb',
            px: 0.7,
            py: 0.1,
            borderRadius: 0.8,
          }}
        >
          {count}
        </Box>
      )}
    </ButtonBase>
  );
}
function Stat({
  title,
  value,
  icon,
  color,
  background,
  onClick,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  background: string;
  onClick: () => void;
}) {
  return (
    <ButtonBase
      className="stat-card"
      onClick={onClick}
      sx={{ display: 'block', textAlign: 'left', background: '#fff' }}
    >
      <div className="stat-top">
        <Typography sx={{ fontSize: 11, fontWeight: 500, color: '#809078' }}>{title}</Typography>
        <span className="stat-icon" style={{ color, background }}>
          {icon}
        </span>
      </div>
      <div className="stat-number">{value.toLocaleString()}</div>
    </ButtonBase>
  );
}
function TabLabel({ text, count }: { text: string; count: number }) {
  return (
    <Stack direction="row" spacing={0.9} sx={{ alignItems: 'center' }}>
      <span>{text}</span>
      <Box
        sx={{
          fontSize: 9,
          px: 0.6,
          py: 0.1,
          bgcolor: '#eef1e9',
          borderRadius: 0.7,
          color: '#849278',
        }}
      >
        {count}
      </Box>
    </Stack>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Box sx={{ color: '#92a58a', mb: 1.6 }}>{icon}</Box>
      <Typography sx={{ fontSize: 16, fontWeight: 550, mb: 0.8 }}>{title}</Typography>
      {text && (
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2.5 }}>{text}</Typography>
      )}
      {action}
    </div>
  );
}
function Steps({ row }: { row: InvoiceRow }) {
  return (
    <Box>
      {[
        {
          label: 'Validate invoice',
          detail: 'Check source data and invoice fields',
          done: row.portalVerified || row.status === 'completed',
          active: ['validate', 'duplicate'].includes(row.stage),
        },
        {
          label: 'Submit to InvoiceApprove',
          detail: row.portalVerified
            ? 'Submission verified'
            : 'Upload PDF and verify the portal record',
          done: row.portalVerified,
          active: ['upload', 'submit', 'verify'].includes(row.stage),
        },
        {
          label: 'Complete in Encompass',
          detail: row.taskComplete
            ? 'Sales task completed'
            : 'Check order minimum and complete sales task',
          done: row.taskComplete,
          active: row.stage === 'complete_task',
        },
      ].map((s) => (
        <div className="step-item" key={s.label}>
          <span
            className="step-icon"
            style={{
              background: s.done ? '#e7f1e7' : '#f0f3ec',
              color: s.done ? '#5d8b63' : '#a1af98',
            }}
          >
            {s.done ? (
              <CheckRounded sx={{ fontSize: 16 }} />
            ) : s.active && row.status === 'processing' ? (
              <CircularProgress size={13} />
            ) : (
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#b5c2ab' }} />
            )}
          </span>
          <Box sx={{ pt: 0.2 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 550 }}>{s.label}</Typography>
            <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.4 }}>
              {s.detail}
            </Typography>
          </Box>
        </div>
      ))}
    </Box>
  );
}

function ReviewDialog({
  ids,
  state,
  onClose,
  onStarted,
  onError,
}: {
  ids: string[];
  state: State;
  onClose: () => void;
  onStarted: () => void;
  onError: (s: string) => void;
}) {
  const rows = ids
    .map((id) => state.rows.find((r) => r.id === id))
    .filter((r): r is InvoiceRow => !!r);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
      Object.fromEntries(rows.map((r) => [r.id, structuredClone(r.draft)])),
    ),
    [index, setIndex] = useState(0),
    [busy, setBusy] = useState(false),
    [pdf, setPdf] = useState(false);
  const row = rows[index],
    draft = row ? drafts[row.id] : null;
  const invalid = rows.filter(
    (r) =>
      r.workNeeded !== 'complete' &&
      (!validDraft(drafts[r.id]) ||
        Math.round(Number(drafts[r.id].amount) * 100) !== r.amountMinor),
  );
  if (!row || !draft) return null;
  function update(patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [row.id]: { ...current[row.id], ...patch } }));
  }
  const groups: Record<string, string[]> = {
    'RCP Northside': [
      'Northside Sac',
      'Eastside Sac',
      'Marysville',
      'Wild Seed Wellness',
      'Turlock',
      'Shasta Lake',
      'Napa',
      'Woodland',
    ],
    'CK Distribution': ['Metro', 'Jackpot', 'Morro Bay', 'Banning', 'San Diego', 'San Jose'],
  };
  const stores = state.options.stores.filter(
    (s) => !groups[draft.deliveryMethod] || groups[draft.deliveryMethod].includes(s.name),
  );
  async function process() {
    setBusy(true);
    try {
      await mutate('process', {
        items: rows.map((r) => ({
          id: r.id,
          revision: r.revision,
          draft: drafts[r.id],
          action: r.workNeeded === 'complete' ? 'complete' : 'submit',
        })),
      });
      onStarted();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      maxWidth="lg"
      fullWidth
      fullScreen={window.innerWidth < 600}
      slotProps={{ paper: { sx: { borderRadius: { xs: 0, sm: 2.5 } } } }}
    >
      <DialogTitle sx={{ px: 3.5, pt: 3, fontSize: 20, fontWeight: 600 }}>
        Review invoices
        <IconButton
          onClick={onClose}
          disabled={busy}
          sx={{ position: 'absolute', right: 16, top: 17 }}
          aria-label="Close batch review"
        >
          <CloseRounded fontSize="small" />
        </IconButton>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mt: 0.8, mr: 4 }}>
          {rows.length} selected · {rows.filter((r) => r.workNeeded !== 'complete').length}{' '}
          submissions · {rows.filter((r) => r.workNeeded === 'complete').length} completion-only
        </Typography>
        <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 1, mr: 4 }}>
          Processing creates portal records and uploads PDFs where needed, then completes the
          Encompass sales tasks. Portal edits can close after intake, credit, or manager actions.
        </Typography>
      </DialogTitle>
      <DialogContent
        sx={{ p: 0, borderTop: '1px solid #e5e9e1', borderBottom: '1px solid #e5e9e1' }}
      >
        <div className="review-layout">
          <nav className="review-nav" aria-label="Invoices in batch">
            {rows.map((r, i) => (
              <ButtonBase
                key={r.id}
                className={i === index ? 'active' : ''}
                onClick={() => {
                  setIndex(i);
                  setPdf(false);
                }}
              >
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{r.invoiceNumber}</Typography>
                  {validDraft(drafts[r.id]) ? (
                    <CheckCircleOutlineRounded sx={{ fontSize: 14, color: '#75966d' }} />
                  ) : (
                    <WarningAmberRounded sx={{ fontSize: 14, color: '#bc944d' }} />
                  )}
                </Stack>
                <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: 0.6 }}>
                  {r.clientName}
                </Typography>
              </ButtonBase>
            ))}
          </nav>
          <section className="review-form">
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}
            >
              <Box>
                <Typography sx={{ fontSize: 16, fontWeight: 600 }}>{row.invoiceNumber}</Typography>
                <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.4 }}>
                  {row.clientName} · Encompass total {currency(row.amountMinor)}
                </Typography>
              </Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={<DescriptionOutlined sx={{ fontSize: 15 }} />}
                disabled={state.worker.running}
                onClick={() => setPdf(!pdf)}
              >
                {pdf ? 'Hide PDF' : 'Source PDF'}
              </Button>
            </Stack>
            {pdf ? (
              <Box sx={{ mb: 3 }}>
                <iframe
                  title={`Source PDF for ${row.invoiceNumber}`}
                  src={`/api/invoices/${encodeURIComponent(row.id)}/pdf`}
                  style={{
                    width: '100%',
                    height: 400,
                    border: '1px solid #e5e9e1',
                    borderRadius: 7,
                  }}
                />
              </Box>
            ) : null}
            {(row.errorCode || row.issues.length > 0) && (
              <Alert
                severity={row.errorCode ? 'warning' : 'info'}
                sx={{
                  fontSize: 11,
                  mb: 3,
                  bgcolor: '#f7f6ed',
                  color: '#8c815a',
                  '& .MuiAlert-icon': { color: '#ac9d6f' },
                }}
              >
                {row.errorCode ? errorMessages[row.errorCode] : row.issues.join(' ')}
              </Alert>
            )}
            {row.portalVerified && (
              <Alert severity="success" sx={{ mb: 3, fontSize: 11 }}>
                Portal record found. Submission will be checked before completing Encompass.
              </Alert>
            )}
            {row.workNeeded === 'complete' ? (
              <>
                <Steps row={row} />
                <RecordDetails row={row} state={state} showLines={false} />
              </>
            ) : (
              <div className="field-grid">
                <TextField
                  select
                  label="Distributor"
                  value={draft.distributorId}
                  onChange={(e) => update({ distributorId: e.target.value })}
                  required
                >
                  {state.options.distributors.map((o) => (
                    <MenuItem key={o.id} value={o.id}>
                      {o.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  label="Amount before credit (USD)"
                  value={draft.amount}
                  onChange={(e) => update({ amount: e.target.value })}
                  error={
                    !!draft.amount && Math.round(Number(draft.amount) * 100) !== row.amountMinor
                  }
                  helperText={
                    !!draft.amount && Math.round(Number(draft.amount) * 100) !== row.amountMinor
                      ? 'Must match the current Encompass total.'
                      : undefined
                  }
                  required
                  slotProps={{
                    input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                    htmlInput: { inputMode: 'decimal' },
                  }}
                />
                <FormControl size="small" sx={{ gridColumn: '1 / -1' }} required>
                  <InputLabel id="batch-brands-label">Brands</InputLabel>
                  <Select
                    labelId="batch-brands-label"
                    multiple
                    label="Brands"
                    value={draft.brandIds}
                    onChange={(e) =>
                      update({
                        brandIds:
                          typeof e.target.value === 'string'
                            ? e.target.value.split(',')
                            : e.target.value,
                      })
                    }
                    renderValue={(ids) => (
                      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                        {ids.map((id) => (
                          <Chip
                            size="small"
                            key={id}
                            label={
                              state.options.brands.find((b) => b.id === id)?.name ?? 'Unknown brand'
                            }
                          />
                        ))}
                      </Stack>
                    )}
                  >
                    {state.options.brands.map((b) => (
                      <MenuItem key={b.id} value={b.id}>
                        <Checkbox size="small" checked={draft.brandIds.includes(b.id)} />
                        {b.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  select
                  label="Delivery method"
                  value={draft.deliveryMethod}
                  onChange={(e) =>
                    update({
                      deliveryMethod: e.target.value as Draft['deliveryMethod'],
                      storeId: null,
                    })
                  }
                  required
                >
                  {['RCP Northside', 'CK Distribution', 'Direct to Store'].map((m) => (
                    <MenuItem value={m} key={m}>
                      {m}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label={
                    draft.deliveryMethod === 'CK Distribution'
                      ? 'Final store (optional)'
                      : 'Final store'
                  }
                  value={draft.storeId ?? ''}
                  onChange={(e) => update({ storeId: e.target.value || null })}
                  required={draft.deliveryMethod !== 'CK Distribution'}
                >
                  <MenuItem value="">
                    {draft.deliveryMethod === 'CK Distribution'
                      ? 'Warehouse / no final store'
                      : 'Select store'}
                  </MenuItem>
                  {stores.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.name}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  type="date"
                  label="Invoice date"
                  value={draft.invoiceDate}
                  onChange={(e) => update({ invoiceDate: e.target.value })}
                  slotProps={{ inputLabel: { shrink: true } }}
                  required
                  helperText="Confirm the business invoice date."
                />
                <TextField
                  type="date"
                  label="Delivery date"
                  value={draft.deliveryDate}
                  onChange={(e) => update({ deliveryDate: e.target.value })}
                  slotProps={{ inputLabel: { shrink: true } }}
                  required
                />
              </div>
            )}
            {row.workNeeded !== 'complete' && (
              <Box component="details" sx={{ mt: 3 }}>
                <Box component="summary" sx={{ cursor: 'pointer', fontSize: 12, fontWeight: 550 }}>
                  Record links, mappings and line items
                </Box>
                <RecordDetails row={row} state={state} />
              </Box>
            )}
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', mt: 3 }}
            >
              <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
                Invoice {index + 1} of {rows.length}
              </Typography>
              <Stack direction="row">
                <IconButton
                  aria-label="Previous invoice"
                  size="small"
                  disabled={index === 0}
                  onClick={() => {
                    setIndex(index - 1);
                    setPdf(false);
                  }}
                >
                  <ArrowBackRounded fontSize="small" />
                </IconButton>
                <IconButton
                  aria-label="Next invoice"
                  size="small"
                  disabled={index === rows.length - 1}
                  onClick={() => {
                    setIndex(index + 1);
                    setPdf(false);
                  }}
                >
                  <ArrowForwardRounded fontSize="small" />
                </IconButton>
              </Stack>
            </Stack>
          </section>
        </div>
      </DialogContent>
      <DialogActions sx={{ px: 3.5, py: 2.5, justifyContent: 'space-between' }}>
        <Typography
          sx={{ fontSize: 11, color: invalid.length ? 'warning.main' : 'text.secondary' }}
        >
          {invalid.length
            ? `${invalid.length} invoice${invalid.length === 1 ? ' has' : 's have'} invalid or missing fields`
            : `${rows.length} invoice${rows.length === 1 ? '' : 's'} selected`}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button color="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="contained"
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : <PlayArrowRounded />}
            disabled={busy || invalid.length > 0 || state.syncing || !state.connected}
            onClick={process}
          >
            {busy ? 'Queuing…' : `Process ${rows.length} invoice${rows.length === 1 ? '' : 's'}`}
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
