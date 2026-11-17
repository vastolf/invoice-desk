import 'dotenv/config';
import { LiveAdapter } from '../server/live-adapter.ts';
import { AppError } from '../server/domain.ts';

// This command never calls upload(), submit(), or complete().
const adapter = new LiveAdapter(process.env);
try {
  const snapshot = await adapter.discover();
  const source = snapshot.sources.find((s) => s.inScope);
  if (!source) throw new AppError('OUT_OF_SCOPE');
  const before = await adapter.source(source.id);
  const bytes = await adapter.pdf(source.id);
  const after = await adapter.source(source.id);
  const existing = snapshot.portals.find(
    (p) =>
      p.submittedBy === snapshot.userId &&
      snapshot.options.distributors.some((d) => d.id === p.distributorId),
  );
  const duplicateCheck = existing
    ? await adapter.duplicate(existing.invoiceNumber, existing.distributorId)
    : null;
  console.log(
    JSON.stringify(
      {
        authenticated: true,
        sourceInvoices: snapshot.sources.length,
        inScope: snapshot.sources.filter((s) => s.inScope).length,
        visiblePortalHistory: snapshot.portals.length,
        distributors: snapshot.options.distributors.length,
        assignedBrands: snapshot.options.brands.length,
        activeStores: snapshot.options.stores.length,
        sourcePdfVerified: bytes.subarray(0, 5).toString() === '%PDF-',
        sourceStableAfterPdf: before.revision === after.revision,
        knownDuplicateRecognized: duplicateCheck,
      },
      null,
      2,
    ),
  );
  if (before.revision !== after.revision || duplicateCheck === false) process.exitCode = 1;
} catch (error) {
  console.error(
    JSON.stringify({ error: error instanceof AppError ? error.code : 'CONNECTION_FAILED' }),
  );
  process.exitCode = 1;
} finally {
  await adapter.close();
}
