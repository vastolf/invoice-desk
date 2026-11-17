import { useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  CloseRounded,
  DragIndicatorRounded,
} from '@mui/icons-material';
import type { State } from '../shared/types.ts';
import {
  columns,
  columnValue,
  defaultPreferences,
  parsePreferences,
  moveColumn,
  operators,
  validFilter,
  type ColumnFilter,
  type ColumnId,
  type TablePreferences,
} from './table-model.ts';
export function ColumnSettings({
  preferences,
  onApply,
  onClose,
}: {
  preferences: TablePreferences;
  onApply: (p: TablePreferences) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => parsePreferences(JSON.stringify(preferences)));
  const [search, setSearch] = useState('');
  function move(id: ColumnId, to: ColumnId) {
    setDraft((p) => ({ ...p, order: moveColumn(p.order, id, to) }));
  }
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="column-settings-title">
      <DialogTitle id="column-settings-title">Table columns</DialogTitle>
      <DialogContent dividers>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <TextField
            select
            fullWidth
            label="Sort by"
            value={draft.sort}
            onChange={(e) => setDraft((p) => ({ ...p, sort: e.target.value as ColumnId }))}
          >
            {columns.map((c) => (
              <MenuItem value={c.id} key={c.id}>
                {c.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Direction"
            value={draft.ascending ? 'asc' : 'desc'}
            onChange={(e) => setDraft((p) => ({ ...p, ascending: e.target.value === 'asc' }))}
            sx={{ minWidth: 155 }}
          >
            <MenuItem value="asc">Ascending</MenuItem>
            <MenuItem value="desc">Descending</MenuItem>
          </TextField>
        </Stack>
        <TextField
          fullWidth
          label="Find a column"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ mb: 2 }}
        />
        <Typography sx={{ fontSize: 11, color: 'text.secondary', mb: 1 }}>
          Drag columns or use the arrows to change their order.
        </Typography>
        <Box role="list" aria-label="Column order">
          {draft.order.map((id, index) => {
            const c = columns.find((c) => c.id === id)!;
            if (!c.label.toLowerCase().includes(search.toLowerCase())) return null;
            return (
              <Stack
                key={id}
                role="listitem"
                data-column-id={id}
                direction="row"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const from = e.dataTransfer.getData('text/plain') as ColumnId;
                  if (columns.some((c) => c.id === from)) move(from, id);
                }}
                sx={{ alignItems: 'center', borderBottom: '1px solid #eef0ea', py: 0.3 }}
              >
                <DragIndicatorRounded
                  sx={{ fontSize: 18, color: '#9ba395', cursor: 'grab', mr: 0.5 }}
                />
                <FormControlLabel
                  sx={{ flex: 1, mr: 0 }}
                  label={<Typography sx={{ fontSize: 12 }}>{c.label}</Typography>}
                  control={
                    <Checkbox
                      size="small"
                      checked={draft.visible.includes(id)}
                      disabled={draft.visible.length === 1 && draft.visible.includes(id)}
                      onChange={(_, checked) =>
                        setDraft((p) => ({
                          ...p,
                          visible: checked ? [...p.visible, id] : p.visible.filter((v) => v !== id),
                        }))
                      }
                      slotProps={{ input: { 'aria-label': `Show ${c.label}` } }}
                    />
                  }
                />
                <IconButton
                  size="small"
                  aria-label={`Move ${c.label} up`}
                  disabled={index === 0}
                  onClick={() => move(id, draft.order[index - 1])}
                >
                  <ArrowUpwardRounded sx={{ fontSize: 16 }} />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={`Move ${c.label} down`}
                  disabled={index === draft.order.length - 1}
                  onClick={() =>
                    setDraft((p) => {
                      const next = [...p.order];
                      [next[index], next[index + 1]] = [next[index + 1], next[index]];
                      return { ...p, order: next };
                    })
                  }
                >
                  <ArrowDownwardRounded sx={{ fontSize: 16 }} />
                </IconButton>
              </Stack>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions sx={{ p: 2, justifyContent: 'space-between' }}>
        <Button onClick={() => setDraft(defaultPreferences())}>Restore defaults</Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={() => onApply(draft)}>
            Apply columns
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
export function ColumnFilters({
  filters,
  state,
  onApply,
  onClose,
}: {
  filters: ColumnFilter[];
  state: State;
  onApply: (f: ColumnFilter[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => structuredClone(filters));
  const update = (id: string, patch: Partial<ColumnFilter>) =>
    setDraft((d) => d.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth aria-labelledby="column-filters-title">
      <DialogTitle id="column-filters-title">Column filters</DialogTitle>
      <DialogContent dividers>
        <Typography sx={{ fontSize: 12, color: 'text.secondary', mb: 2 }}>
          Invoices must match all filters. Money values are in dollars.
        </Typography>
        <Stack spacing={2}>
          {draft.map((f, index) => {
            const c = columns.find((c) => c.id === f.column)!;
            const noValue = ['empty', 'notEmpty'].includes(f.operator);
            const choices =
              c.kind === 'choice'
                ? [
                    ...new Set(
                      state.rows
                        .map((r) => columnValue(c.id, r, state))
                        .filter((v): v is string => typeof v === 'string'),
                    ),
                  ].sort()
                : [];
            return (
              <Stack
                key={f.id}
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{
                  alignItems: { sm: 'flex-start' },
                  p: 1.5,
                  border: '1px solid #e3e8df',
                  borderRadius: 1,
                }}
                data-filter-id={f.id}
              >
                <TextField
                  select
                  label={`Column ${index + 1}`}
                  value={f.column}
                  sx={{ minWidth: 180, flex: 1 }}
                  onChange={(e) => {
                    const column = e.target.value as ColumnId;
                    const next = columns.find((c) => c.id === column)!;
                    update(f.id, {
                      column,
                      operator: operators(next.kind)[0].id,
                      value: next.kind === 'boolean' ? 'true' : '',
                      upper: '',
                    });
                  }}
                >
                  {columns.map((c) => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.label}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  label={`Condition ${index + 1}`}
                  value={f.operator}
                  sx={{ minWidth: 145 }}
                  onChange={(e) => update(f.id, { operator: e.target.value })}
                >
                  {operators(c.kind).map((op) => (
                    <MenuItem key={op.id} value={op.id}>
                      {op.label}
                    </MenuItem>
                  ))}
                </TextField>
                {!noValue &&
                  (c.kind === 'boolean' ? (
                    <TextField
                      select
                      label={`Value ${index + 1}`}
                      value={f.value}
                      sx={{ minWidth: 100 }}
                      onChange={(e) => update(f.id, { value: e.target.value })}
                    >
                      <MenuItem value="true">Yes</MenuItem>
                      <MenuItem value="false">No</MenuItem>
                    </TextField>
                  ) : (
                    <TextField
                      label={`Value ${index + 1}`}
                      value={f.value}
                      select={c.kind === 'choice' && ['equals', 'notEquals'].includes(f.operator)}
                      type={
                        ['date', 'datetime'].includes(c.kind)
                          ? 'date'
                          : ['money', 'number', 'links'].includes(c.kind)
                            ? 'number'
                            : 'text'
                      }
                      sx={{ minWidth: 140, flex: 1 }}
                      onChange={(e) => update(f.id, { value: e.target.value })}
                      error={!!f.value && !validFilter(f)}
                      slotProps={{
                        inputLabel: { shrink: true },
                        htmlInput: { step: c.kind === 'money' ? '0.01' : 'any' },
                      }}
                    >
                      {choices.map((v) => (
                        <MenuItem key={v} value={v}>
                          {v}
                        </MenuItem>
                      ))}
                    </TextField>
                  ))}
                {!noValue && f.operator === 'between' && (
                  <TextField
                    label={`Upper value ${index + 1}`}
                    value={f.upper}
                    type={['date', 'datetime'].includes(c.kind) ? 'date' : 'number'}
                    sx={{ minWidth: 140, flex: 1 }}
                    onChange={(e) => update(f.id, { upper: e.target.value })}
                    slotProps={{
                      inputLabel: { shrink: true },
                      htmlInput: { step: c.kind === 'money' ? '0.01' : 'any' },
                    }}
                  />
                )}
                <IconButton
                  aria-label={`Remove filter ${index + 1}`}
                  onClick={() => setDraft((d) => d.filter((v) => v.id !== f.id))}
                >
                  <CloseRounded fontSize="small" />
                </IconButton>
              </Stack>
            );
          })}
        </Stack>
        {!draft.length && <Typography sx={{ fontSize: 12, py: 2 }}>No column filters</Typography>}
        <Button
          sx={{ mt: 2 }}
          onClick={() =>
            setDraft((d) => [
              ...d,
              {
                id: crypto.randomUUID(),
                column: 'portalStatus',
                operator: 'equals',
                value: '',
                upper: '',
              },
            ])
          }
        >
          Add filter
        </Button>
      </DialogContent>
      <DialogActions sx={{ p: 2, justifyContent: 'space-between' }}>
        <Button onClick={() => setDraft([])}>Clear filters</Button>
        <Stack direction="row" spacing={1}>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="contained"
            disabled={draft.some((f) => !validFilter(f))}
            onClick={() => onApply(draft)}
          >
            Apply filters
          </Button>
        </Stack>
      </DialogActions>
    </Dialog>
  );
}
