import {
  Alert,
  Box,
  Button,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { OpenInNewRounded } from '@mui/icons-material';
import type { InvoiceRow, MappingEvidence, State } from '../shared/types.ts';
const methods: Record<MappingEvidence['method'], string> = {
  invoice_history: 'Client invoice history',
  customer_chain: 'Customer chain',
  client_name: 'Source client name',
  memo_store: 'Destination in invoice memo',
  product_history: 'Product ID history',
  supplier_history: 'Supplier invoice history',
  product_label: 'Source product/supplier label',
  memo_history: 'Matching invoice memo history',
};
const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
export default function RecordDetails({
  row,
  state,
  showLines = true,
}: {
  row: InvoiceRow;
  state: State;
  showLines?: boolean;
}) {
  return (
    <Box sx={{ mt: 3 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1.5 }}>Record links</Typography>
      <Stack spacing={1}>
        {[
          ['Encompass invoice ID', row.sourceAvailable === false ? 'Not found' : row.id],
          ['Encompass client ID', row.clientId ?? 'Not found'],
          ['InvoiceApprove invoice ID', row.portalId ?? 'Not submitted'],
          ['Encompass customer', row.sourceAvailable === false ? 'Not found' : row.clientName],
          ['InvoiceApprove final store', row.storeName],
          ['Delivery method', row.draft.deliveryMethod || 'Unresolved'],
          ...(row.portalEditability
            ? [
                [
                  'Portal header/file editing',
                  row.portalEditability === 'available'
                    ? 'Available in InvoiceApprove'
                    : 'Locked in InvoiceApprove',
                ],
              ]
            : []),
        ].map(([label, value]) => (
          <Stack key={label} direction="row" sx={{ justifyContent: 'space-between', gap: 2 }}>
            <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{label}</Typography>
            <Typography
              sx={{
                fontSize: 11,
                wordBreak: 'break-all',
                maxWidth: 260,
                textAlign: 'right',
                fontFamily: 'monospace',
              }}
            >
              {value}
            </Typography>
          </Stack>
        ))}
      </Stack>
      {row.onHold && (
        <Alert severity="warning" sx={{ mt: 2, fontSize: 11 }}>
          Encompass payment terms place this invoice on hold.
        </Alert>
      )}
      {state.origins && (
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
          {row.sourceAvailable !== false && (
            <Button
              size="small"
              component="a"
              target="_blank"
              rel="noopener noreferrer"
              href={`${state.origins.encompass}/Home?DashboardID=100100&TableName=Invoice&Search=InvoiceID~${encodeURIComponent(row.id)}`}
              endIcon={<OpenInNewRounded sx={{ fontSize: 12 }} />}
            >
              Encompass
            </Button>
          )}
          {row.portalId && (
            <Button
              size="small"
              component="a"
              target="_blank"
              rel="noopener noreferrer"
              href={`${state.origins.invoiceApprove}/invoices/${encodeURIComponent(row.portalId)}`}
              endIcon={<OpenInNewRounded sx={{ fontSize: 12 }} />}
            >
              InvoiceApprove
            </Button>
          )}
        </Stack>
      )}
      {!!row.differences?.length && (
        <Box sx={{ mt: 2 }}>
          <Alert severity="info" sx={{ fontSize: 11 }}>
            Current records differ:{' '}
            {row.differences
              .map(
                (f) =>
                  ({
                    amount: 'gross amount',
                    invoice_date: 'portal invoice date / source creation date',
                    delivery_date: 'delivery date',
                    invoice_number: 'invoice number',
                  })[f] ?? f,
              )
              .join(', ')}
            .
          </Alert>
          {row.sourceValues && row.portalId && (
            <Table size="small" aria-label="Invoice comparison">
              <TableHead>
                <TableRow>
                  <TableCell>FIELD</TableCell>
                  <TableCell>ENCOMPASS</TableCell>
                  <TableCell>INVOICEAPPROVE</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {[
                  [
                    'Gross amount',
                    money(row.sourceValues.amountMinor),
                    money(Math.round(Number(row.draft.amount) * 100)),
                  ],
                  ['Created / invoice date', row.sourceValues.createdDate, row.draft.invoiceDate],
                  ['Delivery date', row.sourceValues.deliveryDate, row.draft.deliveryDate],
                ].map(([label, a, b]) => (
                  <TableRow key={label}>
                    <TableCell sx={{ fontSize: 10 }}>{label}</TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{a || '—'}</TableCell>
                    <TableCell sx={{ fontSize: 10 }}>{b || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Box>
      )}
      {!!row.mappingEvidence?.length && (
        <Box sx={{ mt: 3 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1.5 }}>Mapping evidence</Typography>
          <Stack spacing={1.25}>
            {row.mappingEvidence.map((e, i) => (
              <Box key={i}>
                <Typography sx={{ fontSize: 11, fontWeight: 550 }}>
                  {e.field === 'brands'
                    ? 'Brands'
                    : e.field === 'store'
                      ? 'Store'
                      : e.field === 'delivery'
                        ? 'Delivery'
                        : 'Client'}{' '}
                  · {methods[e.method]}
                </Typography>
                <Tooltip
                  title={
                    e.sourceIds.length
                      ? `Example source invoice IDs: ${e.sourceIds.join(', ')}`
                      : 'Derived from current source fields'
                  }
                >
                  <Typography sx={{ fontSize: 10, color: 'text.secondary', mt: 0.3 }}>
                    {e.count ? `${e.count} linked invoice${e.count === 1 ? '' : 's'} · ` : ''}
                    {e.targetIds
                      .map((id) =>
                        e.field === 'brands'
                          ? (state.options.brands.find((b) => b.id === id)?.name ?? id)
                          : e.field === 'store'
                            ? (state.options.stores.find((s) => s.id === id)?.name ?? id)
                            : id,
                      )
                      .join(', ') || 'Warehouse'}
                  </Typography>
                </Tooltip>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
      {showLines && !!row.lines?.length && (
        <Box sx={{ mt: 3 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 1 }}>Source line items</Typography>
          <TableContainer>
            <Table size="small" aria-label="Source line items">
              <TableHead>
                <TableRow>
                  <TableCell>PRODUCT</TableCell>
                  <TableCell align="right">QTY</TableCell>
                  <TableCell align="right">TOTAL</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {row.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell sx={{ fontSize: 10, maxWidth: 250 }}>
                      {l.name}
                      <Typography sx={{ fontSize: 9, color: 'text.secondary' }}>
                        Product ID {l.productId}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 10 }}>
                      {l.quantity}
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                      {money(l.amountMinor)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </Box>
  );
}
