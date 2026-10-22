import { z } from 'zod';
import { categoryInputSchema, companyInputSchema, draftPatchSchema, draftQuerySchema, expenseInputSchema, expenseQuerySchema, expenseUpdateSchema, propertyFieldsSchema, propertyQuerySchema, reportingGroupSchema } from './schemas';
import type { OverviewData, ReportDoc, ReportRequest } from './reportTypes';
import type { Category, Company, Expense, ExpenseDetail, ExpensePage, ImportResult, PostAllResult, Property, PropertyFinancials, PropertyPage, ReceiptDraft, ReceiptDraftDetail, ReceiptEvent, StagedFile, VendorRule } from './types';

/**
 * The complete renderer-to-main contract. Every channel has an input schema; the main
 * process validates input (and the sender) before any service runs. There is no generic
 * invoke: the preload exposes one named method per channel.
 */

/** Settings the renderer may read or write. Anything else is rejected. */
export const SETTING_KEYS = ['ui.lastVisitedNote'] as const;
export const settingKeySchema = z.enum(SETTING_KEYS);
export type SettingKey = z.infer<typeof settingKeySchema>;

const id = z.number().int().positive();

const isoDateOrNull = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const reportRequestSchema = z
  .object({
    kind: z.enum(['property', 'sold-performance', 'expense-activity', 'portfolio-snapshot']),
    scope: z.union([z.number().int().positive(), z.literal('all')]),
    from: isoDateOrNull,
    to: isoDateOrNull,
    propertyId: z.number().int().positive().nullable(),
  })
  .strict();

export const ipcContract = {
  'app:getInfo': { input: z.undefined() },
  'settings:get': { input: z.object({ key: settingKeySchema }).strict() },
  'settings:set': { input: z.object({ key: settingKeySchema, value: z.string().max(2000) }).strict() },

  'companies:list': { input: z.object({ includeArchived: z.boolean().default(false) }).strict() },
  'companies:create': { input: companyInputSchema },
  'companies:update': { input: z.object({ id, input: companyInputSchema }).strict() },
  'companies:setDefault': { input: z.object({ id }).strict() },
  'companies:archive': { input: z.object({ id, replacementDefaultId: id.optional() }).strict() },
  'companies:restore': { input: z.object({ id }).strict() },
  'companies:chooseLogo': { input: z.object({ id }).strict() },
  'companies:clearLogo': { input: z.object({ id }).strict() },
  'companies:getLogo': { input: z.object({ id }).strict() },

  'properties:list': { input: propertyQuerySchema },
  'properties:get': { input: z.object({ id }).strict() },
  'properties:create': { input: z.object({ companyId: id, fields: propertyFieldsSchema }).strict() },
  'properties:update': { input: z.object({ id, fields: propertyFieldsSchema, confirmReopenSale: z.boolean().default(false) }).strict() },
  'properties:archive': { input: z.object({ id }).strict() },
  'properties:restore': { input: z.object({ id }).strict() },
  'properties:financials': { input: z.object({ id }).strict() },

  'categories:list': { input: z.object({ companyId: id, includeArchived: z.boolean().default(false) }).strict() },
  'categories:create': { input: categoryInputSchema },
  'categories:rename': { input: z.object({ id, name: z.string().trim().max(80) }).strict() },
  'categories:setGroup': { input: z.object({ id, reportingGroup: reportingGroupSchema, confirmed: z.boolean().default(false) }).strict() },
  'categories:archive': { input: z.object({ id }).strict() },
  'categories:restore': { input: z.object({ id }).strict() },

  'expenses:stageFile': {
    input: z.object({
      name: z.string().min(1).max(260),
      bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array, 'Expected file bytes'),
    }).strict(),
  },
  'expenses:create': { input: expenseInputSchema },
  'expenses:update': { input: z.object({ id, input: expenseUpdateSchema }).strict() },
  'expenses:void': { input: z.object({ id }).strict() },
  'expenses:unvoid': { input: z.object({ id }).strict() },
  'expenses:list': { input: expenseQuerySchema },
  'expenses:get': { input: z.object({ id }).strict() },
  'expenses:vendorSuggestions': { input: z.object({ companyId: id, prefix: z.string().max(100) }).strict() },
  'expenses:openAttachment': { input: z.object({ id }).strict() },

  'receipts:pickFiles': { input: z.undefined() },
  'receipts:import': {
    input: z.object({ companyId: id, propertyId: id.nullable(), groups: z.array(z.array(z.string().regex(/^[0-9a-f]{32}$/)).min(1).max(20)).min(1).max(50) }).strict(),
  },
  'receipts:list': { input: draftQuerySchema },
  'receipts:get': { input: z.object({ id }).strict() },
  'receipts:update': { input: z.object({ id, patch: draftPatchSchema }).strict() },
  'receipts:markReviewed': { input: z.object({ id, reviewed: z.boolean() }).strict() },
  'receipts:post': { input: z.object({ id }).strict() },
  'receipts:postReviewed': { input: z.object({ scope: z.union([id, z.literal('all')]) }).strict() },
  'receipts:skip': { input: z.object({ id }).strict() },
  'receipts:unskip': { input: z.object({ id }).strict() },
  'receipts:remove': { input: z.object({ id }).strict() },
  'receipts:retry': { input: z.object({ id, overwriteEdited: z.boolean().default(false) }).strict() },
  'receipts:cancel': { input: z.object({ id }).strict() },
  'receipts:preview': { input: z.object({ id, page: z.number().int().min(1).max(200) }).strict() },

  'reports:overview': {
    input: z.object({ scope: z.union([id, z.literal('all')]), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), periodLabel: z.string().max(60) }).strict(),
  },
  'reports:build': { input: reportRequestSchema },
  'reports:exportXlsx': { input: reportRequestSchema },
  'reports:exportPdf': { input: reportRequestSchema },

  'vendorRules:list': { input: z.object({ companyId: id }).strict() },
  'vendorRules:create': { input: z.object({ companyId: id, vendorName: z.string().trim().min(1).max(160), categoryId: id }).strict() },
  'vendorRules:delete': { input: z.object({ id }).strict() },
} as const;

/** The only channel the main process pushes to the renderer. */
export const RECEIPT_EVENT_CHANNEL = 'receipts:event';

export type IpcChannel = keyof typeof ipcContract;
export const IPC_CHANNELS = Object.keys(ipcContract) as IpcChannel[];

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  schemaVersion: number;
  isDemoData: boolean;
}

export type IpcError = {
  code: 'INVALID_INPUT' | 'FORBIDDEN' | 'INTERNAL' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'ARCHIVED';
  message: string;
  /** Field-level messages for forms, keyed by field name. */
  fields?: Record<string, string>;
};
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };
type R<T> = Promise<IpcResult<T>>;

/** What the preload exposes on window.gable. */
export interface GableApi {
  getAppInfo(): R<AppInfo>;
  getSetting(key: SettingKey): R<string | null>;
  setSetting(key: SettingKey, value: string): R<null>;

  listCompanies(includeArchived?: boolean): R<Company[]>;
  createCompany(input: z.infer<typeof companyInputSchema>): R<Company>;
  updateCompany(id: number, input: z.infer<typeof companyInputSchema>): R<Company>;
  setDefaultCompany(id: number): R<Company>;
  archiveCompany(id: number, replacementDefaultId?: number): R<Company>;
  restoreCompany(id: number): R<Company>;
  /** Opens a native file picker in the main process; resolves to the updated company, or null if cancelled. */
  chooseCompanyLogo(id: number): R<Company | null>;
  clearCompanyLogo(id: number): R<Company>;
  getCompanyLogo(id: number): R<string | null>;

  listProperties(query: z.input<typeof propertyQuerySchema>): R<PropertyPage>;
  getProperty(id: number): R<Property>;
  createProperty(companyId: number, fields: z.infer<typeof propertyFieldsSchema>): R<Property>;
  updateProperty(id: number, fields: z.infer<typeof propertyFieldsSchema>, confirmReopenSale?: boolean): R<Property>;
  archiveProperty(id: number): R<Property>;
  restoreProperty(id: number): R<Property>;
  getPropertyFinancials(id: number): R<PropertyFinancials>;

  listCategories(companyId: number, includeArchived?: boolean): R<Category[]>;
  createCategory(input: z.infer<typeof categoryInputSchema>): R<Category>;
  renameCategory(id: number, name: string): R<Category>;
  setCategoryGroup(id: number, reportingGroup: z.infer<typeof reportingGroupSchema>, confirmed?: boolean): R<Category>;
  archiveCategory(id: number): R<Category>;
  restoreCategory(id: number): R<Category>;

  /** Sends the bytes of a file the user picked or dropped; the main process validates and stores a private copy. */
  stageReceiptFile(name: string, bytes: Uint8Array): R<StagedFile>;
  createExpense(input: z.input<typeof expenseInputSchema>): R<Expense>;
  updateExpense(id: number, input: z.input<typeof expenseUpdateSchema>): R<ExpenseDetail>;
  voidExpense(id: number): R<ExpenseDetail>;
  unvoidExpense(id: number): R<ExpenseDetail>;
  listExpenses(query: z.input<typeof expenseQuerySchema>): R<ExpensePage>;
  getExpense(id: number): R<ExpenseDetail>;
  suggestVendors(companyId: number, prefix: string): R<string[]>;
  /** Opens a stored receipt in the system viewer. */
  openReceipt(attachmentId: number): R<null>;

  /** Native file picker for receipts (JPG, PNG, PDF). Files are validated and staged by the main process. */
  pickReceiptFiles(): R<{ staged: StagedFile[]; rejected: { name: string; reason: string }[] }>;
  importReceipts(companyId: number, propertyId: number | null, groups: string[][]): R<ImportResult>;
  listReceipts(query: z.input<typeof draftQuerySchema>): R<ReceiptDraft[]>;
  getReceipt(id: number): R<ReceiptDraftDetail>;
  updateReceipt(id: number, patch: z.input<typeof draftPatchSchema>): R<ReceiptDraft>;
  markReceiptReviewed(id: number, reviewed: boolean): R<ReceiptDraft>;
  postReceipt(id: number): R<Expense>;
  postReviewedReceipts(scope: number | 'all'): R<PostAllResult>;
  skipReceipt(id: number): R<ReceiptDraft>;
  unskipReceipt(id: number): R<ReceiptDraft>;
  removeReceipt(id: number): R<null>;
  retryReceipt(id: number, overwriteEdited?: boolean): R<ReceiptDraft>;
  cancelReceipt(id: number): R<null>;
  previewReceipt(id: number, page: number): R<{ dataUrl: string; pageCount: number }>;
  /** Subscribe to reading progress. Returns an unsubscribe function. */
  onReceiptEvent(cb: (e: ReceiptEvent) => void): () => void;

  getOverview(scope: number | 'all', from: string, to: string, periodLabel: string): R<OverviewData>;
  buildReport(request: ReportRequest): R<ReportDoc>;
  /** Builds the report, asks where to save it, and writes a real .xlsx file. */
  exportReportXlsx(request: ReportRequest): R<{ saved: boolean; fileName: string | null }>;
  exportReportPdf(request: ReportRequest): R<{ saved: boolean; fileName: string | null }>;

  listVendorRules(companyId: number): R<VendorRule[]>;
  createVendorRule(companyId: number, vendorName: string, categoryId: number): R<VendorRule[]>;
  deleteVendorRule(id: number): R<null>;
}
