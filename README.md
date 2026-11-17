# Invoice Desk

A local Vite + React + Material UI workspace for moving invoices from Encompass into InvoiceApprove and completing their Encompass sales tasks.

## Run

Requires Node.js 24 or newer.

```sh
npm ci
npm run setup:browser
```

Copy the blank template, then supply your company’s Encompass URL and both accounts’ credentials:

```sh
cp .env.example .env
```

Quote password values so special characters are preserved. Every installation uses its own local `.env`; credentials are never included in the repository.

```sh
npm run dev
```

Open [Invoice Desk](http://127.0.0.1:5173). If that port is already in use, set `PORT=5174` in `.env` and open the URL printed by the server. It connects and refreshes read-only on startup. Nothing is submitted or completed until you select invoices and start a batch.

For an isolated sample workspace that never connects to either real system:

```sh
npm run dev:demo
```

The sample workspace is clearly labeled, uses fictional invoices, and keeps its database in memory. One sample invoice intentionally demonstrates an Encompass order-minimum block.

## Daily workflow

1. Refresh invoices. **To finish** shows new submissions and existing portal invoices whose Encompass task still needs completion, within the connected rep/managed-rep scope.
2. Search by invoice, client, or brand; choose a client or an inclusive invoice/delivery date range. **Clients & mappings** shows stable client/chain IDs, linked invoice counts, destinations, and delivery methods. Open a client’s invoices or an invoice’s record links, mapping evidence, and line items.
3. Select individual invoices, a page, or up to 100 matches. Click **Process selected**.
4. Review the proposed fields. Client history, customer chains, products, suppliers, and destination memos resolve the mappings. Conflicting evidence remains a specific review item. Confirm the business invoice date and compare against **Source PDF**. Existing portal invoices use completion-only processing and preserve their original fields.
5. Click **Process N invoices**. The background worker checks for duplicates, uploads the PDF, submits and verifies the portal record, then uses Encompass's existing Complete control and verifies the sales task.
6. Follow live progress. Pause takes effect between invoices; Clear waiting removes jobs that have not started. Closing the browser tab does not stop a running local worker.
7. For an exception, open the invoice details. Retrying reconciles existing portal records and resumes remaining work. A successful submission is retained if Encompass completion is blocked.

For Emerald Sky or Uncle Ernie's goods, the review shows the warehouse sticker step needed to cover printed MSRP before hub delivery. A direct-to-store route inferred from history is cleared for these invoices so the operator selects CK Distribution or RCP Northside. The final store may be specified separately in the invoice memo; the current memo's unambiguous final store takes priority over a generic historical store. A store name or brand does not by itself select a hub route, so unresolved routes and conflicting stores remain for operator review. The app does not verify physical sticker placement.

Submission creates a real portal record, uploads its attachment, and changes the Encompass task when completed. It has no automatic undo. The current portal exposes rep header/file edits for the rep’s own submitted invoices and eligible approved invoices before intake/acceptance/credit activity. Archived or paid invoices are excluded from this edit form. Invoice details show the currently observed header/file edit availability; a future save remains subject to server permissions.

Purchasing approval, payment, credit selection, and signatures remain in their existing applications. The combined action uses the sequence requested for this app: portal submission followed by sales-task completion. It never automatically invokes Force Complete, creates a missing task through a direct API, or overrides a duplicate.

## Table layout and filters

Use **Columns** to show or hide any of 50 metadata columns. Drag table headers or rows in the column dialog to reorder them; up/down buttons provide the same control without dragging. Choose the default sort in that dialog or click any visible column header. Unknown values sort last, and amounts/cases use numeric sorting.

Column order, visibility, sort direction, and page size are saved in this browser. **Restore defaults** resets the layout. Preferences contain only known column identifiers and display settings; invoice values, filter text, selections, PDFs, and credentials are not saved in browser storage.

The default columns show invoice/brand, client/final store, delivery date, gross amount, queue status, actual Encompass sales-task status, portal status, and PDF/system links. Optional columns include separately labeled source/portal delivery dates, invoice/creation dates and memos, delivery method and route, terms and holds, cases and lines, open balances/credits, portal intake/credit/payment state, mapping evidence counts, differences, and record IDs. Unavailable metadata is shown as unknown rather than zero. Balances remain distinct from gross invoice amounts.

Use **Filters** for conditions on any column, including hidden columns. Combine text, status/boolean, numeric, empty-value, and inclusive date/amount range conditions. All conditions apply together within the current tab and the existing search/client/date selection. Remove an individual filter chip or use **Reset** to clear filters without changing the saved layout. Date filters narrow the loaded catalog. Filter values remain in memory.

PDF links use the local API rather than exposing Encompass's signed PDF URL. Encompass and InvoiceApprove links open their corresponding records. Source PDFs are disabled for unavailable/out-of-scope records and while the worker or refresh is using the source integration. External record links remain read-only navigation.

## Catalog and refresh

The catalog keeps source clients, source invoices and tasks, portal invoices, product/supplier IDs, numeric line items, cross-system invoice links, and mapping evidence in normalized SQLite tables. An invoice keeps its stable source/portal relationship across refreshes and restarts. Invoice-number matching preserves prefixes and punctuation; duplicate numbers, changed linked IDs, and unavailable records are surfaced for review.

Refresh reads all visible portal history, including paid and archived records. Encompass discovery reads open, positive-case invoices for explicitly assigned/managed clients across all delivery dates, then refreshes previously known source IDs and resolves new portal invoice numbers. Historical delivered line items are read from both `InvoiceTrans` and `InvoiceTransHist`.

Known invoice numbers do not need repeated discovery. Missing source matches are retried daily; known headers/tasks and portal statuses are refreshed each time. Line items are reloaded when the source revision changes, with empty line results also cached. All mappings and queue classifications are recomputed from the refreshed records and retained links. The footer shows catalog counts and last refresh time.

Completed history, other customer chains, unclassified records, portal-only records, past portal rejections, and **On hold** records have separate views. Encompass payment-term holds remain visible but cannot be processed in a combined batch. The worker rechecks holds before upload and immediately before task completion; a hold appearing after submission preserves the portal record for completion-only recovery. A completed task without an established portal relationship is not evidence that a fresh submission is required. Historical amount/date drift stays visible without turning a completed invoice into a new submission. Completing an open task requires a unique, owned portal match with the same invoice number and amount.

Applicability is inferred from observed invoice and customer-chain relationships; it is not a company-wide billing policy. A previously unseen chain remains separate until evidence establishes its use of InvoiceApprove.

## Build and verify

```sh
npm test
npm run build
npm start
```

`npm start` serves the built frontend and local API together. `npm run start:demo` serves the production build with sample data. Stop the service with Ctrl+C. If the local session expires, use **Connections → Reconnect apps**; a paused waiting batch can then be resumed.

`npm run check:connections` performs a read-only live check of authentication, scope, history pagination, source PDF retrieval, and an existing-invoice duplicate lookup. It prints aggregate counts and controlled errors only.

Optional environment settings:

- `PORT=5173`: local HTTP port.
- `BROWSER_HEADLESS=false`: show the automation browser when troubleshooting.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`: explicitly select an existing Chromium executable; normally leave unset and use `setup:browser`.

## Data handling and GitHub

The server binds to `127.0.0.1`. Credentials and browser authentication stay server-side in memory. Client/company labels, product names, supplier labels, people’s names/emails, notes, raw API replies, PDFs, and authentication remain in memory. The ignored local `data/queue.sqlite` stores IDs and relationships, invoice numbers, amounts, dates, quantities, controlled statuses/error codes, timestamps, and hashes. Mapping evidence contains IDs of its supporting invoices. The intended upload path contains only IDs and a random UUID. Only table display preferences are saved in browser localStorage; no invoice details or filter values are stored there.

`.env`, `data/`, private reconnaissance, exports, output screenshots, dependencies, built assets, logs, and browser sessions are ignored by Git. Commit source, docs, `.env.example`, and `package-lock.json`. Each recipient supplies their own local credentials. No ZIP/package workflow is needed.

Only one live worker can hold this workspace's database lock. Interrupted work is surfaced for reconciliation after restart; the app does not automatically replay a pending write. External application error text, request bodies, and authentication headers are not logged or stored.

## Verification and current limits

- Live authentication, scoped invoice/task reads, full portal history pagination, and source re-read were verified against both apps.
- Synthetic tests exercise catalog persistence/restart, incremental discovery and negative-cache expiry, historical line items, customer-chain applicability, ambiguous mappings, changed/missing links, duplicate/archived records, completion-only legacy data, worker recovery, and restricted local storage.
- Browser checks cover batch review/processing, live updates, search, filters, and responsive layout with fictional invoices.
- An operator-selected live batch successfully submitted and verified a portal invoice and completed its Encompass sales task. This verifies that observed path, not every upstream role, hold, or exception. Synthetic tests cover the failure/recovery cases without writing test records to production.
- Discovery covers all open delivery dates within verified account assignments, plus linked historical records. It does not claim to export every delivered invoice in the Encompass tenant. Unmatched portal records remain visible in **Portal only**.
- Delivery method and final store are separate from the Encompass customer/address. Historical customer PDFs with the same customer address appear under both Direct to Store and RCP Northside; an RCP invoice can name a different final store. Address or brand alone must not silently choose the route.
- Invoice date defaults to source creation day and remains editable at batch review; historical records show that this is not a universal business-date rule. A client with multiple delivery methods and no invoice-specific evidence still needs a delivery choice. Existing invoice-specific memo/history mappings can resolve a hub’s final store without equating it to the source customer.
- The filtered Encompass report was checked read-only to locate its existing Complete control. No order-minimum, force-complete, or task-status write was activated in that check.

## Structure

- `src/`: React interface, Material UI theme, filters, review dialog, progress, and activity.
- `server/index.ts`: local HTTP API, same-origin/request-token protection, and event stream.
- `server/engine.ts`: catalog refresh and serialized batch worker.
- `server/reconciliation.ts`: deterministic invoice links, client scope, product/destination mappings, and queue classification.
- `server/live-adapter.ts`: authenticated Encompass/InvoiceApprove integration.
- `server/demo-adapter.ts`: isolated fictional upstream systems.
- `server/store.ts`: actual SQLite schema and controlled durable state.
- `tests/`: synthetic failure/recovery tests.
- Private reconnaissance notes and live invoice examples stay local and are excluded from Git.
- [Original design](docs/IMPLEMENTATION_PLAN.md) and [observed API contracts](docs/integration-contracts.json): implementation background. The running database schema is in `server/store.ts`; `docs/queue-schema.sql` is the earlier design sketch.
