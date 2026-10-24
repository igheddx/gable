import type { PropertyStatus } from './schemas';

/**
 * A business type decides what an item looks like and what is tracked for it. The four templates are built in;
 * a person adds their own business types in Settings by choosing one of the last two.
 */
export const TEMPLATES = ['renovation', 'rental', 'buy_sell', 'income_expense'] as const;
export type Template = (typeof TEMPLATES)[number];

/** Templates a person can choose when adding their own business type. */
export const CUSTOM_TEMPLATES = ['buy_sell', 'income_expense'] as const satisfies readonly Template[];

export interface TemplateInfo {
  label: string;
  /** Plain-language description shown when choosing. */
  description: string;
  /** Street address and city/state/ZIP, or just a name. */
  hasAddress: boolean;
  purchase: 'required' | 'optional' | 'none';
  /** Can be marked Sold with a sale date and price. */
  tracksSale: boolean;
  /** Profit and return on cost are worked out when it is sold. */
  tracksProfit: boolean;
  /** Money coming in (rent, sales) is recorded, and net income is shown. */
  tracksIncome: boolean;
  nameLabel: string;
  identifierLabel: string | null;
}

export const TEMPLATE_INFO: Record<Template, TemplateInfo> = {
  renovation: {
    label: 'Buy, renovate and sell a property',
    description: 'A house you buy, fix up and sell. Tracks cost, profit and return.',
    hasAddress: true, purchase: 'required', tracksSale: true, tracksProfit: true, tracksIncome: false,
    nameLabel: 'Street address', identifierLabel: null,
  },
  rental: {
    label: 'Rental property',
    description: 'A property you rent out. Tracks rent and other income against expenses.',
    hasAddress: true, purchase: 'optional', tracksSale: true, tracksProfit: false, tracksIncome: true,
    nameLabel: 'Street address', identifierLabel: null,
  },
  buy_sell: {
    label: 'Buy and sell items',
    description: 'Things you buy, prepare and sell, like cars. Tracks cost, profit and return.',
    hasAddress: false, purchase: 'required', tracksSale: true, tracksProfit: true, tracksIncome: false,
    nameLabel: 'Name', identifierLabel: 'ID or serial number',
  },
  income_expense: {
    label: 'Ongoing income and expenses',
    description: 'A business with money coming in and going out, with no purchase or sale. Tracks net income.',
    hasAddress: false, purchase: 'none', tracksSale: false, tracksProfit: false, tracksIncome: true,
    nameLabel: 'Name', identifierLabel: null,
  },
};

export const RENOVATION_TYPE_ID = 1;

export interface BusinessType {
  id: number;
  name: string;
  template: Template;
  isBuiltin: boolean;
  isArchived: boolean;
}

/** Wording for the sale status differs by template. */
export function statusLabel(template: Template, status: PropertyStatus): string {
  if (template === 'rental' || template === 'income_expense') return status === 'Sold' ? 'Sold' : 'Active';
  if (template === 'buy_sell') return { Held: 'In stock', Renovating: 'Being fixed up', Listed: 'For sale', Sold: 'Sold' }[status];
  return status;
}

/** The statuses that make sense for a template, in order. */
export function statusesFor(template: Template): PropertyStatus[] {
  if (template === 'income_expense') return ['Held'];
  if (template === 'rental') return ['Held', 'Sold'];
  return ['Held', 'Renovating', 'Listed', 'Sold'];
}

export const INCOME_CATEGORIES: Partial<Record<Template, readonly string[]>> = {
  rental: ['Rent', 'Late fees', 'Parking and pet fees', 'Deposits kept', 'Other income'],
  income_expense: ['Sales', 'Service income', 'Other income'],
};
