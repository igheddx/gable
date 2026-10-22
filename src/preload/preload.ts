import { contextBridge, ipcRenderer } from 'electron';
import type { GableApi } from '../shared/ipc';

const call = (channel: string, payload?: unknown) => ipcRenderer.invoke(channel, payload);

const api: GableApi = {
  getAppInfo: () => call('app:getInfo'),
  getSetting: (key) => call('settings:get', { key }),
  setSetting: (key, value) => call('settings:set', { key, value }),

  listCompanies: (includeArchived = false) => call('companies:list', { includeArchived }),
  createCompany: (input) => call('companies:create', input),
  updateCompany: (id, input) => call('companies:update', { id, input }),
  setDefaultCompany: (id) => call('companies:setDefault', { id }),
  archiveCompany: (id, replacementDefaultId) => call('companies:archive', { id, replacementDefaultId }),
  restoreCompany: (id) => call('companies:restore', { id }),
  chooseCompanyLogo: (id) => call('companies:chooseLogo', { id }),
  clearCompanyLogo: (id) => call('companies:clearLogo', { id }),
  getCompanyLogo: (id) => call('companies:getLogo', { id }),

  listProperties: (query) => call('properties:list', query),
  getProperty: (id) => call('properties:get', { id }),
  createProperty: (companyId, fields) => call('properties:create', { companyId, fields }),
  updateProperty: (id, fields, confirmReopenSale = false) => call('properties:update', { id, fields, confirmReopenSale }),
  archiveProperty: (id) => call('properties:archive', { id }),
  restoreProperty: (id) => call('properties:restore', { id }),
};

contextBridge.exposeInMainWorld('gable', api);
