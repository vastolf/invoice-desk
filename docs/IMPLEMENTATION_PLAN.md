# Implementation plan

This document records the original design from reconnaissance. A local application is now implemented; see the root README for its actual behavior and commands. The user authorized a combined batch action that submits to the portal and then completes the Encompass sales task. One operator-selected live combined batch has since been verified. Other business cases still require their existing source checks and remote readback. Details below describe the design background and remaining considerations.

## Local application

Use one local Node.js service, a small browser interface, Playwright adapters for authenticated access, and SQLite for durable job state. Bind the service to `127.0.0.1`; it does not need public hosting or a company-data cloud database.

The UI should answer four questions: which invoices were found, what will be submitted, what succeeded, and what needs intervention. Suggested views:

| View        | Contents/actions                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Connections | Signed-in account confirmation, current connection health, reconnect action.                                                            |
| Queue       | Invoice number, source/task/portal status, dates and amount hydrated into memory, readiness, selection.                                 |
| Review      | Proposed distributor/brands/delivery/store, business invoice date, delivery date, gross total, PDF preview, and specific discrepancies. |
| Progress    | Current stage, verified portal ID, independently verified sales-task state, retry/reconcile result.                                     |
| Exceptions  | Ambiguous mappings, duplicate conflicts, changed source data, order-minimum blocks, uncertain write outcome, credit/rep holds.          |

Start with **Refresh** and **Review selected**. Enable **Submit selected** only once the fields have passed review. Submission and task completion remain separate durable stages within the user-authorized combined batch. Avoid scheduling or unattended operation in the first release.

The local API should require a per-run request token for mutations, reject unexpected origins, and keep credentials server-side. Serve sensitive responses with `Cache-Control: no-store`; do not persist invoice details in browser localStorage. The project does not need a second login/account database.

## Adapter boundary

```text
local interface
  -> job coordinator + SQLite state/leases
     -> Encompass adapter: session, reads, PDF, existing Complete UI
     -> InvoiceApprove adapter: session, lookup, upload, submit, verify
```

Suggested contracts:

```text
Encompass.readCandidates(scope) -> ephemeral source records
Encompass.readInvoice(sourceId) -> ephemeral validated detail
Encompass.getInvoicePdf(sourceId) -> bytes in memory
Encompass.readSalesTask(taskId) -> task state
Encompass.completeSalesTaskViaUi(sourceId) -> verified task state / blocked

InvoiceApprove.getAccountScope() -> user ID and permitted IDs
InvoiceApprove.findInvoice(distributorId, invoiceNumber, includeArchived=true)
InvoiceApprove.checkDuplicate(distributorId, invoiceNumber)
InvoiceApprove.uploadAttachment(intentObjectPath, bytes)
InvoiceApprove.submitInvoice(reviewedPayload)
InvoiceApprove.readInvoice(portalId) -> verified result
```

Use structured authenticated reads rather than parsing visible table text. Source `*_DBValue` values avoid HTML, but field references must still be interpreted correctly. Discover the portal backend/configuration from the current app rather than assuming the observed deployment remains fixed.

For Encompass completion, initially use its existing Complete UI so the location/customer/date order-minimum check and task-linking behavior are preserved. Stop at minimum/permission dialogs; never force completion automatically. Re-read the linked task after the action. Missing or changing task IDs should be surfaced in the first release rather than handled with speculative direct write calls.

For InvoiceApprove, revalidate and reuse the application's authenticated submission function and storage path conventions. The RPC route is a feasibility finding, not proof of a supported public integration. Keep a browser-form adapter available if the private contract changes. Do not substitute direct inserts into `invoices` for the business function.

## Processing and recovery

1. **Discover:** read source candidates with explicit account/rep/invoice scope. Do not inherit broader scope from UI filter changes. Look up portal matches across archived/paid records and all relevant submission dates. Paginate; observed clients use pages of 300 or 1,000 in different views.
2. **Rehydrate and validate:** fetch detail and PDF, propose reviewed mappings, compare amount/date/number with the attachment, confirm account and assignments, and separate gross/credits/net. Use exact decimal/minor-unit arithmetic. A small amount alone does not make a sample invalid.
3. **Review:** show all fields and warnings. Invoice date requires an explicit rule or operator choice. Store selection can legitimately be null for a warehouse delivery; never guess it for a direct delivery.
4. **Claim:** acquire a SQLite worker lease, then re-read source revisions and remote duplicate state. Reject a stale reviewed payload. Keep only IDs, hashes, and controlled state in the durable intent.
5. **Upload and submit:** persist the intended distributor/UUID object path before upload. Check the server duplicate function immediately before submission. If an existing match is found, reconcile it instead of creating another record. Never enable duplicate override automatically.
6. **Verify:** re-read the returned invoice ID and compare number, distributor, selected field IDs, dates, amount, and attachment reference with the reviewed payload. Persist the portal ID and verified stage. An HTTP success alone is insufficient.
7. **Complete at the confirmed workflow point:** run the separate Encompass action only for the selected, still-matching source invoice and task. Preserve existing checks and verify the result. Do not equate purchasing approval or payment with this stage.
8. **Monitor:** refresh purchasing/credit/receiving/payment fields read-only and surface holds to the operator. Do not approve, reject, pay, sign, or choose credits as part of basic invoice copying.

### Failure cases that need deliberate handling

| Situation                                                      | Recovery                                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Upload response lost                                           | Check the exact intended object path using authenticated access. Never generate a new random path and blindly upload again.                      |
| Submission response lost or server error after possible commit | Set `submission_unknown`; query by distributor/number including archived records and reconcile. No blind retry or immediate attachment deletion. |
| Portal submission succeeds, task completion fails              | Keep portal ID and `submitted` state; retry/review only the task step.                                                                           |
| Task completion succeeds, portal submission fails              | Keep verified task state; surface the mismatch. Do not automatically revert the source task.                                                     |
| Source data changes after review                               | Invalidate review and show a new comparison. Preserve historical portal data.                                                                    |
| Duplicate exists with different amount/store/date              | Set `needs_review`; link to both records. Do not silently update or override.                                                                    |
| Credits fail after invoice submission                          | Preserve successful invoice state and surface a separate credit exception. First release does not apply credits.                                 |
| Missing source task, task ID changes, or below-minimum order   | Stop for operator review while preserving all completed stages.                                                                                  |
| Session expires or account changes                             | Reconnect and revalidate account/scope before continuing the existing intent.                                                                    |
| Process stops during a remote write                            | Expired lease goes to reconciliation, not an automatic resubmission.                                                                             |

There is no cross-application transaction. Exactly-once outcomes require duplicate checks, serialized work, durable intent, and remote reconciliation; they cannot be guaranteed by retrying HTTP calls. The server's archived/case-normalization duplicate behavior must be verified before relying on it.

## Storage policy

Use the proposed `queue-schema.sql` as a starting point. Persist source invoice/task IDs, invoice number, distributor/portal IDs, processing state, timestamps, attachment digest, intended upload path, and redacted error codes. Invoice numbers and amounts were acceptable to the user, but amounts need not be stored in the initial queue.

Keep the following in memory and fetch again when needed: rep/customer names, emails, store/brand labels, product lines, notes, PDFs, amounts, and dates used for a preview. Durable mapping configuration can use source customer IDs and destination store/brand IDs, with labels reloaded from the systems. The in-memory preview is still company data; do not send it to third-party telemetry or a cloud model merely to perform deterministic mapping.

If a PDF has to be written for browser upload/preview, use a restricted temporary directory with mode `0700` and files `0600`, delete it after the operation, and clear abandoned files on startup. Prefer byte uploads to temporary files. Disable real-record screenshots, videos, HARs, traces, and request-body logs by default.

Browser auth state contains credentials in effect. Prefer an in-memory browser context; any opt-in saved state belongs in an ignored local directory with restricted permissions and must be excluded from sharing. Credential values never enter SQLite or frontend JavaScript.

## Build order and acceptance criteria

### 1. Read-only queue

- Both logins work on the recipient's machine, with expired-session handling.
- Source scope is explicit and destination visibility is distinguished from ownership.
- Real data is hydrated in memory; persisted rows contain only allowed IDs/state.
- Current and archived duplicates are found outside default date filters.
- Ambiguous brand/store/date/amount cases are displayed without remote writes.
- Refreshing the UI or restarting does not lose durable job identities.

### 2. Synthetic integration tests

Cover meaningful failure boundaries: timeout after remote commit, two workers claiming one invoice, source change after review, archived duplicate, null warehouse store versus required direct store, multi-brand payload, gross/net distinction, no-charge invoice, session/account change, blocked completion, missing task, and partial success between apps.

Use a fake local upstream or isolated test environment. Tests must not submit dummy invoices or mutate business records in production. Read-only production checks remain useful for selectors and response contracts.

### 3. Selected portal submission

Revalidate the current RPC/form behavior. Once production processing is requested, run one real, specifically selected invoice whose reviewed fields are unambiguous. Verify the created record and attachment before increasing batch size. Confirm duplicate behavior against paid/archived cases and ambiguous responses.

### 4. Selected sales-task completion

Confirm the operator's completion timing and partial-failure policy. Preserve the app's minimum checks, verify linked task state, and demonstrate that portal submission is not repeated when task completion alone fails.

### 5. Operator handoff

Share application code, setup instructions, example environment configuration, the dependency lockfile, and synthetic tests through GitHub. Exclude credentials, auth state, runtime records, downloaded documents, logs, and databases. The user explicitly declined ZIP packaging. Verify a clean install on the intended operating system.
