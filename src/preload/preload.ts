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

  listVendorRules: (companyId) => call('vendorRules:list', { companyId }),
  createVendorRule: (companyId, vendorName, categoryId) => call('vendorRules:create', { companyId, vendorName, categoryId }),
  deleteVendorRule: (id) => call('vendorRules:delete', { id }),
};

contextBridge.exposeInMainWorld('gable', api);
