import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Draft, Option, PortalInvoice } from '../shared/types.ts';
export class AppError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export const digest = (value: unknown) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
export function moneyMinor(value: string | number): number {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new AppError('MAPPING_REQUIRED');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new AppError('MAPPING_REQUIRED');
  return result;
}
export const sourceMoney = (value: unknown) => Math.round(Number(value || 0) * 100);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v);
export const draftSchema = z
  .object({
    distributorId: z.string().min(1),
    brandIds: z.array(z.string().min(1)).min(1),
    storeId: z.string().min(1).nullable(),
    deliveryMethod: z.enum(['RCP Northside', 'CK Distribution', 'Direct to Store']),
    invoiceDate: date,
    deliveryDate: date,
    amount: z.string().refine((v) => {
      try {
        moneyMinor(v);
        return true;
      } catch {
        return false;
      }
    }),
  })
  .refine((v) => v.deliveryMethod === 'CK Distribution' || !!v.storeId, {
    message: 'A store is required.',
  });
export const processSchema = z.object({
  items: z
    .array(
      z
        .object({
          id: z.string().min(1),
          revision: z.string().min(1),
          action: z.enum(['submit', 'complete']).optional(),
          draft: z.object({
            distributorId: z.string().min(1),
            brandIds: z.array(z.string()),
            storeId: z.string().nullable(),
            deliveryMethod: z.enum(['', 'RCP Northside', 'CK Distribution', 'Direct to Store']),
            invoiceDate: z.string(),
            deliveryDate: z.string(),
            amount: z.string(),
          }),
        })
        .superRefine((item, ctx) => {
          if (item.action !== 'complete' && !draftSchema.safeParse(item.draft).success)
            ctx.addIssue({ code: 'custom', message: 'Invalid submission fields.' });
        }),
    )
    .min(1)
    .max(100),
});
export const normalized = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
export const htmlText = (s: unknown) =>
  String(s ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
export function samePortal(record: PortalInvoice, draft: Draft, number: string): boolean {
  return (
    record.invoiceNumber.trim().toUpperCase() === number.trim().toUpperCase() &&
    record.distributorId === draft.distributorId &&
    record.storeId === draft.storeId &&
    record.deliveryMethod === draft.deliveryMethod &&
    record.invoiceDate === draft.invoiceDate &&
    record.deliveryDate === draft.deliveryDate &&
    record.amountMinor === moneyMinor(draft.amount) &&
    [...record.brandIds].sort().join(',') === [...draft.brandIds].sort().join(',')
  );
}
// Mirrors the currently served InvoiceApprove rep edit-form gate. This is
// read-only UI availability; it is not a guarantee that a future save will pass.
export function repEditAvailable(
  record: {
    archived_at?: string | null;
    payment_date?: string | null;
    status: string;
    submitted_by: string;
    intake_status?: string | null;
    accepted_at?: string | null;
    credit_status?: string | null;
    waiting_on_rep?: boolean | null;
  },
  userId: string,
  isRep: boolean,
): boolean {
  if (!isRep || record.archived_at || record.payment_date) return false;
  if (record.status === 'submitted') return record.submitted_by === userId;
  return (
    record.status === 'approved' &&
    (!record.intake_status || record.intake_status === 'pending') &&
    !record.accepted_at &&
    !record.credit_status &&
    !record.waiting_on_rep
  );
}
export function validateAssignments(
  draft: Draft,
  options: { distributors: Option[]; brands: Option[]; stores: Option[] },
) {
  if (
    !options.distributors.some((o) => o.id === draft.distributorId) ||
    draft.brandIds.some((id) => !options.brands.some((o) => o.id === id)) ||
    (draft.storeId && !options.stores.some((o) => o.id === draft.storeId))
  )
    throw new AppError('MAPPING_REQUIRED');
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
  if (
    draft.storeId &&
    groups[draft.deliveryMethod] &&
    !groups[draft.deliveryMethod].includes(options.stores.find((s) => s.id === draft.storeId)!.name)
  )
    throw new AppError('MAPPING_REQUIRED');
}
