import { z } from 'zod';

/**
 * The complete renderer-to-main contract. Every channel has an input schema and
 * a result type; the main process validates input before any service runs.
 * There is no generic invoke: the preload exposes one named method per channel.
 */

/** Settings the renderer may read or write. Anything else is rejected. */
export const SETTING_KEYS = ['ui.lastVisitedNote'] as const;
export const settingKeySchema = z.enum(SETTING_KEYS);
export type SettingKey = z.infer<typeof settingKeySchema>;

export const ipcContract = {
  'app:getInfo': {
    input: z.undefined(),
  },
  'settings:get': {
    input: z.object({ key: settingKeySchema }).strict(),
  },
  'settings:set': {
    input: z.object({ key: settingKeySchema, value: z.string().max(2000) }).strict(),
  },
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

export type IpcError = { code: 'INVALID_INPUT' | 'FORBIDDEN' | 'INTERNAL'; message: string };
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

/** What the preload exposes on window.gable. */
export interface GableApi {
  getAppInfo(): Promise<IpcResult<AppInfo>>;
  getSetting(key: SettingKey): Promise<IpcResult<string | null>>;
  setSetting(key: SettingKey, value: string): Promise<IpcResult<null>>;
}
