import { contextBridge, ipcRenderer } from 'electron';
import type { GableApi } from '../shared/ipc';

const api: GableApi = {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  getSetting: (key) => ipcRenderer.invoke('settings:get', { key }),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', { key, value }),
};

contextBridge.exposeInMainWorld('gable', api);
