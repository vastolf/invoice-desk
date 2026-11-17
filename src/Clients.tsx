import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { SearchRounded } from '@mui/icons-material';
import type { ClientSummary, State } from '../shared/types.ts';
const labels = {
  established: 'Invoice history',
  same_chain: 'Established chain',
  other_chain: 'Other chain',
  unclassified: 'Unclassified',
};
export default function Clients({
  state,
  onInvoices,
}: {
  state: State;
  onInvoices: (id: string) => void;
}) {
  const [search, setSearch] = useState(''),
    [selected, setSelected] = useState<ClientSummary | null>(null);
  const clients = useMemo(
    () =>
      (state.clients ?? [])
        .filter((c) =>
          `${c.name} ${c.chainName} ${c.id}`.toLowerCase().includes(search.toLowerCase()),
        )
        .sort((a, b) => b.pendingCount - a.pendingCount || a.name.localeCompare(b.name)),
    [state.clients, search],
  );
  const detail = selected
    ? ((state.clients ?? []).find((c) => c.id === selected.id) ?? selected)
    : null;
  return (
    <>
      <Box className="table-shell">
        <Box sx={{ p: 2.5 }}>
          <TextField
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clients or chains"
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRounded fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: { 'aria-label': 'Search clients' },
            }}
          />
        </Box>
        <TableContainer>
          <Table aria-label="Client mappings" sx={{ minWidth: 800 }}>
            <TableHead>
              <TableRow>
                {[
                  'CLIENT',
                  'CHAIN',
                  'ENCOMPASS INVOICES',
                  'PORTAL LINKS',
                  'TO FINISH',
                  'MAPPING BASIS',
                  '',
                ].map((label, i) => (
                  <TableCell key={i}>{label}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {clients.map((c) => (
                <TableRow
                  key={c.id}
                  hover
                  onClick={() => setSelected(c)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Typography sx={{ fontSize: 12, fontWeight: 550 }}>{c.name}</Typography>
                    <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: 0.5 }}>
                      ID {c.id}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontSize: 11 }}>{c.chainName || '—'}</TableCell>
                  <TableCell>{c.sourceInvoiceIds.length}</TableCell>
                  <TableCell>{c.portalInvoiceIds.length}</TableCell>
                  <TableCell sx={{ fontWeight: c.pendingCount ? 600 : 400 }}>
                    {c.pendingCount}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={labels[c.classification]}
                      color={
                        c.classification === 'established' || c.classification === 'same_chain'
                          ? 'success'
                          : 'default'
                      }
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInvoices(c.id);
                      }}
                    >
                      Invoices
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {!clients.length && (
          <Typography sx={{ p: 5, textAlign: 'center', fontSize: 12, color: 'text.secondary' }}>
            No matching clients
          </Typography>
        )}
      </Box>
      <Dialog open={!!detail} onClose={() => setSelected(null)} maxWidth="sm" fullWidth>
        {detail && (
          <>
            <DialogTitle>{detail.name}</DialogTitle>
            <DialogContent>
              <Stack spacing={2}>
                {[
                  ['Encompass client ID', detail.id],
                  ['Chain', detail.chainName || '—'],
                  ['Chain ID', detail.chainId || '—'],
                  ['Mapping basis', labels[detail.classification]],
                  ['Linked invoice pairs', String(detail.evidenceCount)],
                  ['Source invoices', String(detail.sourceInvoiceIds.length)],
                  ['Portal invoice IDs', String(detail.portalInvoiceIds.length)],
                  ['Delivery methods', detail.deliveryMethods.join(', ') || 'Unresolved'],
                  ['Portal stores', detail.stores.map((s) => s.name).join(', ') || '—'],
                ].map(([label, value]) => (
                  <Stack
                    key={label}
                    direction="row"
                    sx={{ justifyContent: 'space-between', gap: 2 }}
                  >
                    <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{label}</Typography>
                    <Typography sx={{ fontSize: 12, textAlign: 'right', maxWidth: 300 }}>
                      {value}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 3 }}>
              <Button onClick={() => setSelected(null)}>Close</Button>
              <Button
                variant="contained"
                onClick={() => {
                  onInvoices(detail.id);
                  setSelected(null);
                }}
              >
                View invoices
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
