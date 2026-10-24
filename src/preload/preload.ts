import { contextBridge, ipcRenderer } from 'electron';
import { RECEIPT_EVENT_CHANNEL, type GableApi } from '../shared/ipc';
import type { ReceiptEvent } from '../shared/types';

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
  getPropertyCashFlow: (id) => call('properties:cashFlow', { id }),

  listBusinessTypes: (includeArchived = false) => call('businessTypes:list', { includeArchived }),
  createBusinessType: (input) => call('businessTypes:create', input),
  renameBusinessType: (id, name) => call('businessTypes:rename', { id, name }),
  archiveBusinessType: (id) => call('businessTypes:archive', { id }),
  restoreBusinessType: (id) => call('businessTypes:restore', { id }),

  createIncome: (input) => call('income:create', input),
  updateIncome: (id, input) => call('income:update', { id, input }),
  voidIncome: (id) => call('income:void', { id }),
  unvoidIncome: (id) => call('income:unvoid', { id }),
  listIncome: (query) => call('income:list', query),

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

  pickReceiptFiles: () => call('receipts:pickFiles'),
  importReceipts: (companyId, propertyId, groups) => call('receipts:import', { companyId, propertyId, groups }),
  listReceipts: (query) => call('receipts:list', query),
  getReceipt: (id) => call('receipts:get', { id }),
  updateReceipt: (id, patch) => call('receipts:update', { id, patch }),
  markReceiptReviewed: (id, reviewed) => call('receipts:markReviewed', { id, reviewed }),
  postReceipt: (id) => call('receipts:post', { id }),
  postReviewedReceipts: (scope) => call('receipts:postReviewed', { scope }),
  skipReceipt: (id) => call('receipts:skip', { id }),
  unskipReceipt: (id) => call('receipts:unskip', { id }),
  removeReceipt: (id) => call('receipts:remove', { id }),
  retryReceipt: (id, overwriteEdited = false) => call('receipts:retry', { id, overwriteEdited }),
  cancelReceipt: (id) => call('receipts:cancel', { id }),
  previewReceipt: (id, page) => call('receipts:preview', { id, page }),
  onReceiptEvent: (cb) => {
    const listener = (_e: unknown, payload: ReceiptEvent) => cb(payload);
    ipcRenderer.on(RECEIPT_EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(RECEIPT_EVENT_CHANNEL, listener);
  },

  getOverview: (scope, from, to, periodLabel) => call('reports:overview', { scope, from, to, periodLabel }),
  buildReport: (request) => call('reports:build', request),
  exportReportXlsx: (request) => call('reports:exportXlsx', request),
  exportReportPdf: (request) => call('reports:exportPdf', request),

  getBackupStatus: () => call('backups:status'),
  setAutoBackup: (enabled) => call('backups:setAuto', { enabled }),
  chooseBackupFolder: () => call('backups:chooseDestination'),
  useDefaultBackupFolder: () => call('backups:useDefaultDestination'),
  runBackup: () => call('backups:run'),
  inspectBackup: (listedFile) => call('backups:inspect', { listed: listedFile }),
  restoreBackup: (token) => call('backups:restore', { token }),
  discardRestore: (token) => call('backups:discard', { token }),
  checkReceiptFiles: () => call('backups:checkFiles'),

  listVendorRules: (companyId) => call('vendorRules:list', { companyId }),
  createVendorRule: (companyId, vendorName, categoryId) => call('vendorRules:create', { companyId, vendorName, categoryId }),
  deleteVendorRule: (id) => call('vendorRules:delete', { id }),
};

contextBridge.exposeInMainWorld('gable', api);
