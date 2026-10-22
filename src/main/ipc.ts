import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { ipcContract, type IpcChannel, type IpcResult } from '../shared/ipc';
import type { AppService } from '../services/appService';

type Handlers = { [C in IpcChannel]: (input: never) => unknown };

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

export function validateAndRun<C extends IpcChannel>(
  channel: C,
  rawInput: unknown,
  run: (input: never) => unknown,
): IpcResult<unknown> {
  const parsed = ipcContract[channel].input.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: 'The request was not valid.' } };
  }
  try {
    return { ok: true, value: run(parsed.data as never) };
  } catch (err) {
    console.error(`[ipc] ${channel} failed`, err);
    return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };
  }
}

export function registerIpc(service: AppService, allowedOrigins: string[]): void {
  const handlers: Handlers = {
    'app:getInfo': () => service.getInfo(),
    'settings:get': (i: { key: Parameters<AppService['getSetting']>[0] }) => service.getSetting(i.key),
    'settings:set': (i: { key: Parameters<AppService['setSetting']>[0]; value: string }) =>
      service.setSetting(i.key, i.value),
  };
  for (const channel of Object.keys(handlers) as IpcChannel[]) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, raw: unknown) => {
      const frame = event.senderFrame;
      if (!isTrustedSender(frame?.url, allowedOrigins, frame?.parent === null)) {
        return { ok: false, error: { code: 'FORBIDDEN', message: 'Request not allowed.' } } satisfies IpcResult<never>;
      }
      return validateAndRun(channel, raw, handlers[channel]);
    });
  }
}
