import { z } from 'zod';
import { companyInputSchema, propertyFieldsSchema, propertyQuerySchema } from './schemas';
import type { Company, Property, PropertyPage } from './types';

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
}
