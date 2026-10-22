import type { PropertyStatus } from './schemas';

export interface Company {
  id: number;
  displayName: string;
  legalName: string;
  address: string;
  phone: string;
  email: string;
  hasLogo: boolean;
  isArchived: boolean;
  isDefault: boolean;
}

export interface Property {
  id: number;
  companyId: number;
  companyName: string;
  companyArchived: boolean;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  purchaseDate: string;
  purchasePriceCents: number;
  status: PropertyStatus;
  saleDate: string | null;
  salePriceCents: number | null;
  description: string;
  notes: string;
  isArchived: boolean;
}

export interface PropertyPage {
  rows: Property[];
  total: number;
  page: number;
  pageSize: number;
}
