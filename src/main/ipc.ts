import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import { ipcContract, type IpcChannel, type IpcResult } from '../shared/ipc';
import { AppError } from '../shared/errors';
import type { AppService } from '../services/appService';
import type { CompanyService } from '../services/companyService';
import type { PropertyService } from '../services/propertyService';
import type { CategoryService } from '../services/categoryService';
import type { ExpenseService } from '../services/expenseService';
import type { FinancialService } from '../services/financialService';
import type { ReceiptService } from '../services/receiptService';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_RECEIPT_BYTES } from '../services/receiptFiles';

type Input<C extends IpcChannel> = z.output<(typeof ipcContract)[C]['input']>;
type Handlers = { [C in IpcChannel]: (input: Input<C>) => unknown };

export interface Services {
  app: AppService;
  companies: CompanyService;
  properties: PropertyService;
  categories: CategoryService;
  expenses: ExpenseService;
  financials: FinancialService;
  receipts: ReceiptService;
}

export interface Platform {
  /** Native file picker; resolves to a chosen path or null if cancelled. */
  chooseImageFile(): Promise<string | null>;
  /** Opens a stored receipt in the OS viewer. Only paths returned by the expense service are passed in. */
  openFile(path: string): Promise<string>;
  /** Native multi-select picker for receipt files; resolves to chosen paths (empty if cancelled). */
  chooseReceiptFiles(): Promise<string[]>;
}

/** Pure so it can be tested without Electron: is this frame our own UI? */
export function isTrustedSender(frameUrl: string | undefined, allowedOrigins: string[], isMainFrame: boolean): boolean {
  if (!frameUrl || !isMainFrame) return false;
  try {
    const u = new URL(frameUrl);
    if (u.protocol === 'file:') return allowedOrigins.includes('file://');
    return allowedOrigins.includes(u.origin);
  } catch {
    return false;
  }
}

/** Validates the payload against the channel's schema, runs the handler, and maps errors to safe results. */
export async function validateAndRun<C extends IpcChannel>(
  channel: C,
  rawInput: unknown,
  run: (input: never) => unknown,
): Promise<IpcResult<unknown>> {
  const parsed = ipcContract[channel].input.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'The request was not valid.' } };
  }
  try {
    return { ok: true, value: await run(parsed.data as never) };
  } catch (err) {
    if (err instanceof AppError) {
      return { ok: false, error: { code: err.code, message: err.message, ...(err.fields ? { fields: err.fields } : {}) } };
    }
    console.error(`[ipc] ${channel} failed`, err);
    return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
  }
}

export function buildHandlers(s: Services, platform: Platform): Handlers {
  return {
    'app:getInfo': () => s.app.getInfo(),
    'settings:get': (i) => s.app.getSetting(i.key),
    'settings:set': (i) => s.app.setSetting(i.key, i.value),

    'companies:list': (i) => s.companies.list(i.includeArchived),
    'companies:create': (i) => s.companies.create(i),
    'companies:update': (i) => s.companies.update(i.id, i.input),
    'companies:setDefault': (i) => s.companies.setDefault(i.id),
    'companies:archive': (i) => s.companies.archive(i.id, i.replacementDefaultId),
    'companies:restore': (i) => s.companies.restore(i.id),
    'companies:chooseLogo': async (i) => {
      const file = await platform.chooseImageFile();
      return file ? s.companies.setLogoFromFile(i.id, file) : null;
    },
    'companies:clearLogo': (i) => s.companies.clearLogo(i.id),
    'companies:getLogo': (i) => s.companies.getLogoDataUrl(i.id),

    'properties:list': (i) => s.properties.list(i),
    'properties:get': (i) => s.properties.get(i.id),
    'properties:create': (i) => s.properties.create(i.companyId, i.fields),
    'properties:update': (i) => s.properties.update(i.id, i.fields, { confirmReopenSale: i.confirmReopenSale }),
    'properties:archive': (i) => s.properties.archive(i.id),
    'properties:restore': (i) => s.properties.restore(i.id),
    'properties:financials': (i) => s.financials.propertyFinancials(i.id),

    'categories:list': (i) => s.categories.list(i.companyId, i.includeArchived),
    'categories:create': (i) => s.categories.create(i.companyId, i.name, i.reportingGroup),
    'categories:rename': (i) => s.categories.rename(i.id, i.name),
    'categories:setGroup': (i) => s.categories.setReportingGroup(i.id, i.reportingGroup, i.confirmed),
    'categories:archive': (i) => s.categories.archive(i.id),
    'categories:restore': (i) => s.categories.restore(i.id),

    'expenses:stageFile': (i) => s.expenses.stageFile(i.name, i.bytes),
    'expenses:create': (i) => s.expenses.create(i),
    'expenses:update': (i) => s.expenses.update(i.id, i.input),
    'expenses:void': (i) => s.expenses.void(i.id),
    'expenses:unvoid': (i) => s.expenses.unvoid(i.id),
    'expenses:list': (i) => s.expenses.list(i),
    'expenses:get': (i) => s.expenses.get(i.id),
    'expenses:vendorSuggestions': (i) => s.expenses.suggestVendors(i.companyId, i.prefix),
    'receipts:pickFiles': async () => {
      // The renderer never sees paths: the main process reads each chosen file and stages a validated copy.
      const staged: { stagedId: string; name: string; sizeBytes: number }[] = [];
      const rejected: { name: string; reason: string }[] = [];
      for (const p of await platform.chooseReceiptFiles()) {
        const name = path.basename(p);
        try {
          if (fs.statSync(p).size > MAX_RECEIPT_BYTES) { rejected.push({ name, reason: 'This file is larger than 25 MB.' }); continue; }
          staged.push(s.expenses.stageFile(name, fs.readFileSync(p)));
        } catch (e) {
          rejected.push({ name, reason: e instanceof AppError ? e.message.replace(`${name}: `, '') : 'This file could not be read.' });
        }
      }
      return { staged, rejected };
    },
    'receipts:import': (i) => s.receipts.importGroups(i.companyId, i.propertyId, i.groups),
    'receipts:list': (i) => s.receipts.list(i),
    'receipts:get': (i) => s.receipts.get(i.id),
    'receipts:update': (i) => s.receipts.update(i.id, i.patch),
    'receipts:markReviewed': (i) => s.receipts.markReviewed(i.id, i.reviewed),
    'receipts:post': (i) => s.receipts.post(i.id),
    'receipts:postReviewed': (i) => s.receipts.postReviewed(i.scope),
    'receipts:skip': (i) => s.receipts.skip(i.id),
    'receipts:unskip': (i) => s.receipts.unskip(i.id),
    'receipts:remove': (i) => { s.receipts.remove(i.id); return null; },
    'receipts:retry': (i) => s.receipts.retry(i.id, i.overwriteEdited),
    'receipts:cancel': (i) => { s.receipts.cancel(i.id); return null; },
    'receipts:preview': (i) => s.receipts.preview(i.id, i.page),
    'vendorRules:list': (i) => s.receipts.rules(i.companyId),
    'vendorRules:create': (i) => s.receipts.createRule(i.companyId, i.vendorName, i.categoryId),
    'vendorRules:delete': (i) => { s.receipts.deleteRule(i.id); return null; },
    'expenses:openAttachment': async (i) => {
      const f = s.expenses.attachmentFile(i.id);
      const err = await platform.openFile(f.path);
      if (err) throw new AppError('NOT_FOUND', 'That receipt file could not be opened. It may have been moved or deleted.');
      return null;
    },
  };
}

export function registerIpc(services: Services, platform: Platform, allowedOrigins: string[]): void {
  const handlers = buildHandlers(services, platform);
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, raw: unknown) => {
      const frame = event.senderFrame;
      if (!isTrustedSender(frame?.url, allowedOrigins, frame?.parent === null)) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Request not allowed.' } } satisfies IpcResult<never>;
      }
      return validateAndRun(channel, raw, handlers[channel] as (input: never) => unknown);
    });
  }
}
