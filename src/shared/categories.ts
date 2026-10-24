/**
 * Reporting groups give every category one stable home in reports. A category's group
 * is set when it is created and only changes through a deliberate, confirmed action.
 * These are management groupings, not tax categories.
 */
export const REPORTING_GROUPS = [
  'purchase_closing',
  'renovation',
  'holding',
  'selling_realtor',
  'selling_closing',
  'selling_other',
  'other',
] as const;
export type ReportingGroup = (typeof REPORTING_GROUPS)[number];

export const GROUP_LABELS: Record<ReportingGroup, string> = {
  purchase_closing: 'Purchase closing costs',
  renovation: 'Renovation and repairs',
  holding: 'Holding costs',
  selling_realtor: 'Realtor commissions',
  selling_closing: 'Seller closing costs',
  selling_other: 'Other selling costs',
  other: 'Other costs',
};

export const STARTER_CATEGORIES: ReadonlyArray<{ name: string; group: ReportingGroup }> = [
  { name: 'Materials', group: 'renovation' },
  { name: 'Labor', group: 'renovation' },
  { name: 'Plumbing', group: 'renovation' },
  { name: 'Electrical', group: 'renovation' },
  { name: 'Permits', group: 'renovation' },
  { name: 'Utilities', group: 'holding' },
  { name: 'Insurance', group: 'holding' },
  { name: 'Property Taxes', group: 'holding' },
  { name: 'Financing Interest & Fees', group: 'holding' },
  { name: 'Maintenance', group: 'renovation' },
  { name: 'Purchase Closing Costs', group: 'purchase_closing' },
  { name: 'Realtor Commissions', group: 'selling_realtor' },
  { name: 'Seller Closing Costs', group: 'selling_closing' },
  { name: 'Other Selling Costs', group: 'selling_other' },
  { name: 'Other', group: 'other' },
];

/** Added when cars and rentals were introduced. Existing companies get these through a migration. */
export const ADDED_STARTER_CATEGORIES: ReadonlyArray<{ name: string; group: ReportingGroup }> = [
  { name: 'Parts & Repairs', group: 'renovation' },
  { name: 'Detailing & Cleaning', group: 'renovation' },
  { name: 'Title & Registration', group: 'purchase_closing' },
  { name: 'Transport & Delivery', group: 'holding' },
  { name: 'Advertising & Listing Fees', group: 'selling_other' },
  { name: 'Property Management Fees', group: 'holding' },
  { name: 'Legal & Professional', group: 'other' },
];

/** Selling costs shown as one line in the bridge, with the three groups detailed beneath. */
export const SELLING_GROUPS: ReportingGroup[] = ['selling_realtor', 'selling_closing', 'selling_other'];
