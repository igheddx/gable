import { schemaVersion, type Db } from '../db/connection';
import { SettingsRepository } from '../db/settingsRepository';
import type { AppInfo, SettingKey } from '../shared/ipc';

export interface AppServiceDeps {
  db: Db;
  name: string;
  version: string;
  platform: string;
}

/** Service layer: what IPC handlers call. UI code can reach nothing below this. */
export class AppService {
  private readonly settings: SettingsRepository;

  constructor(private readonly deps: AppServiceDeps) {
    this.settings = new SettingsRepository(deps.db);
  }

  getInfo(): AppInfo {
    return {
      name: this.deps.name,
      version: this.deps.version,
      platform: this.deps.platform,
      schemaVersion: schemaVersion(this.deps.db),
      isDemoData: this.settings.get('app.demoData') === '1',
    };
  }

  getSetting(key: SettingKey): string | null {
    return this.settings.get(key);
  }

  setSetting(key: SettingKey, value: string): null {
    this.settings.set(key, value);
    return null;
  }
}
