import { z } from 'zod';
import { categoryInputSchema, companyInputSchema, expenseInputSchema, expenseQuerySchema, expenseUpdateSchema, propertyFieldsSchema, propertyQuerySchema, reportingGroupSchema } from './schemas';
import type { Category, Company, Expense, ExpenseDetail, ExpensePage, Property, PropertyFinancials, PropertyPage, StagedFile } from './types';

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
} as const;

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
}
