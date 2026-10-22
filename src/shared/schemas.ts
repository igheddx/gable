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
    purchaseDate: isoDate,
    purchasePriceCents: z.number().int().min(0).max(MAX_CENTS),
    status: z.enum(PROPERTY_STATUSES),
    saleDate: isoDate.nullable(),
    salePriceCents: z.number().int().min(0).max(MAX_CENTS).nullable(),
    description: text(2000),
    notes: text(5000),
  })
  .strict();
export type PropertyFields = z.infer<typeof propertyFieldsSchema>;

export const propertyQuerySchema = z
  .object({
    /** A company id, or 'all' for the explicit read-only aggregate view. */
    scope: z.union([z.number().int().positive(), z.literal('all')]),
    q: z.string().max(200).default(''),
    status: z.enum(PROPERTY_STATUSES).nullable().default(null),
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
