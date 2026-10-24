import { z } from 'zod';
import { MAX_CENTS } from './money';

const text = (max: number) => z.string().trim().max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date.');

export const companyInputSchema = z
  .object({
    displayName: text(120),
    legalName: text(160),
    address: text(300),
    phone: text(40),
    email: text(160),
  })
  .strict();
export type CompanyInput = z.infer<typeof companyInputSchema>;

export const PROPERTY_STATUSES = ['Held', 'Renovating', 'Listed', 'Sold'] as const;
export type PropertyStatus = (typeof PROPERTY_STATUSES)[number];

export const propertyFieldsSchema = z
  .object({
    address1: text(160),
    address2: text(80),
    city: text(80),
    state: text(2),
    zip: text(10),
    /** Required for renovations and buy-and-sell items, optional for rentals, absent for ongoing businesses. */
    purchaseDate: isoDate.nullable(),
    purchasePriceCents: z.number().int().min(0).max(MAX_CENTS).nullable(),
    status: z.enum(PROPERTY_STATUSES),
    saleDate: isoDate.nullable(),
    salePriceCents: z.number().int().min(0).max(MAX_CENTS).nullable(),
    description: text(2000),
    notes: text(5000),
    /** What kind of item this is. Chosen when it is created; omitted means a renovation. It cannot change afterwards. */
    businessTypeId: z.number().int().positive().optional(),
    /** An ID or serial number (for example a VIN), for items that are not addresses. */
    identifier: text(80).optional(),
  })
  .strict();
export type PropertyFields = z.infer<typeof propertyFieldsSchema>;

export const propertyQuerySchema = z
  .object({
    /** A company id, or 'all' for the explicit read-only aggregate view. */
    scope: z.union([z.number().int().positive(), z.literal('all')]),
    q: z.string().max(200).default(''),
    status: z.enum(PROPERTY_STATUSES).nullable().default(null),
    businessTypeId: z.number().int().positive().nullable().default(null),
    purchaseFrom: isoDate.nullable().default(null),
    purchaseTo: isoDate.nullable().default(null),
    saleFrom: isoDate.nullable().default(null),
    saleTo: isoDate.nullable().default(null),
    includeArchived: z.boolean().default(false),
    sort: z.enum(['address', 'purchaseDate', 'purchasePrice', 'status']).default('address'),
    dir: z.enum(['asc', 'desc']).default('asc'),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type PropertyQuery = z.input<typeof propertyQuerySchema>;

// ---------- Business types and income ----------
import { CUSTOM_TEMPLATES } from './businessTypes';

export const businessTypeInputSchema = z
  .object({ name: text(60), template: z.enum(CUSTOM_TEMPLATES) })
  .strict();
export type BusinessTypeInput = z.infer<typeof businessTypeInputSchema>;

export const incomeInputSchema = z
  .object({
    companyId: z.number().int().positive(),
    propertyId: z.number().int().positive(),
    incomeDate: isoDate,
    amountCents: z.number().int().min(1).max(MAX_CENTS),
    category: text(60),
    notes: text(5000),
    /** One value per form instance; saving twice with the same key can only ever create one income entry. */
    idempotencyKey: z.string().min(16).max(64).regex(/^[A-Za-z0-9-]+$/),
  })
  .strict();
export type IncomeInput = z.input<typeof incomeInputSchema>;

export const incomeUpdateSchema = incomeInputSchema.omit({ companyId: true, propertyId: true, idempotencyKey: true }).strict();
export type IncomeUpdate = z.input<typeof incomeUpdateSchema>;

export const incomeQuerySchema = z
  .object({
    scope: z.union([z.number().int().positive(), z.literal('all')]),
    propertyId: z.number().int().positive().nullable().default(null),
    from: isoDate.nullable().default(null),
    to: isoDate.nullable().default(null),
    includeVoided: z.boolean().default(false),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type IncomeQuery = z.input<typeof incomeQuerySchema>;

// ---------- Categories and expenses ----------
import { REPORTING_GROUPS } from './categories';

export const reportingGroupSchema = z.enum(REPORTING_GROUPS);

export const categoryInputSchema = z
  .object({ companyId: z.number().int().positive(), name: text(80), reportingGroup: reportingGroupSchema })
  .strict();

export const allocationInputSchema = z
  .object({ categoryId: z.number().int().positive(), amountCents: z.number().int().min(1).max(MAX_CENTS) })
  .strict();

export const expenseInputSchema = z
  .object({
    companyId: z.number().int().positive(),
    propertyId: z.number().int().positive().nullable(),
    vendorName: text(160),
    expenseDate: isoDate,
    totalCents: z.number().int().min(1).max(MAX_CENTS),
    allocations: z.array(allocationInputSchema).min(1).max(20),
    notes: text(5000),
    /** One value per form instance; saving twice with the same key can only ever create one expense. */
    idempotencyKey: z.string().min(16).max(64).regex(/^[A-Za-z0-9-]+$/),
    /** Files previously staged with expenses:stageFile. */
    stagedFileIds: z.array(z.string().regex(/^[0-9a-f]{32}$/)).max(20).default([]),
  })
  .strict();
export type ExpenseInput = z.input<typeof expenseInputSchema>;

export const expenseUpdateSchema = expenseInputSchema
  .omit({ companyId: true, idempotencyKey: true })
  .extend({ removeAttachmentIds: z.array(z.number().int().positive()).max(50).default([]) })
  .strict();
export type ExpenseUpdate = z.input<typeof expenseUpdateSchema>;

export const expenseQuerySchema = z
  .object({
    scope: z.union([z.number().int().positive(), z.literal('all')]),
    q: z.string().max(200).default(''),
    /** A property id, 'general' for company overhead, or null for any. */
    property: z.union([z.number().int().positive(), z.literal('general')]).nullable().default(null),
    categoryId: z.number().int().positive().nullable().default(null),
    from: isoDate.nullable().default(null),
    to: isoDate.nullable().default(null),
    includeVoided: z.boolean().default(false),
    sort: z.enum(['date', 'amount', 'vendor']).default('date'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(100).default(25),
  })
  .strict();
export type ExpenseQuery = z.input<typeof expenseQuerySchema>;

// ---------- Receipt drafts ----------
export const draftPatchSchema = z
  .object({
    vendor: text(160).optional(),
    expenseDate: isoDate.nullable().optional(),
    totalCents: z.number().int().min(1).max(MAX_CENTS).nullable().optional(),
    categoryId: z.number().int().positive().nullable().optional(),
    split: z.boolean().optional(),
    allocations: z.array(allocationInputSchema).max(20).optional(),
    propertyId: z.number().int().positive().nullable().optional(),
    notes: text(5000).optional(),
    rememberVendor: z.boolean().optional(),
    duplicateOverride: z.boolean().optional(),
  })
  .strict();
export type DraftPatch = z.input<typeof draftPatchSchema>;

export const draftQuerySchema = z
  .object({
    scope: z.union([z.number().int().positive(), z.literal('all')]),
    includeSaved: z.boolean().default(false),
  })
  .strict();
export type DraftQuery = z.input<typeof draftQuerySchema>;
