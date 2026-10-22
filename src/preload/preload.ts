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
  getPropertyFinancials: (id) => call('properties:financials', { id }),

  listCategories: (companyId, includeArchived = false) => call('categories:list', { companyId, includeArchived }),
  createCategory: (input) => call('categories:create', input),
  renameCategory: (id, name) => call('categories:rename', { id, name }),
  setCategoryGroup: (id, reportingGroup, confirmed = false) => call('categories:setGroup', { id, reportingGroup, confirmed }),
  archiveCategory: (id) => call('categories:archive', { id }),
  restoreCategory: (id) => call('categories:restore', { id }),

  stageReceiptFile: (name, bytes) => call('expenses:stageFile', { name, bytes }),
  createExpense: (input) => call('expenses:create', input),
  updateExpense: (id, input) => call('expenses:update', { id, input }),
  voidExpense: (id) => call('expenses:void', { id }),
  unvoidExpense: (id) => call('expenses:unvoid', { id }),
  listExpenses: (query) => call('expenses:list', query),
  getExpense: (id) => call('expenses:get', { id }),
  suggestVendors: (companyId, prefix) => call('expenses:vendorSuggestions', { companyId, prefix }),
  openReceipt: (id) => call('expenses:openAttachment', { id }),
};

contextBridge.exposeInMainWorld('gable', api);
