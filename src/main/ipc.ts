import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import { ipcContract, type IpcChannel, type IpcResult } from '../shared/ipc';
import { AppError } from '../shared/errors';
import type { AppService } from '../services/appService';
import type { CompanyService } from '../services/companyService';
import type { PropertyService } from '../services/propertyService';

type Input<C extends IpcChannel> = z.output<(typeof ipcContract)[C]['input']>;
type Handlers = { [C in IpcChannel]: (input: Input<C>) => unknown };

export interface Services {
  app: AppService;
  companies: CompanyService;
  properties: PropertyService;
}

export interface Platform {
  /** Native file picker; resolves to a chosen path or null if cancelled. */
  chooseImageFile(): Promise<string | null>;
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
