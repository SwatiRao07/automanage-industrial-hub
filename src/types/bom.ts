export type BOMStatus = 'not-ordered' | 'ordered' | 'received' | 'approved';

export interface BOMItem {
  id: string;
  name: string;
  description: string;
  category: string;
  quantity: number;
  vendors: Array<{
    name: string;
    price: number;
    leadTime: string;
    availability: string;
  }>;
  status: BOMStatus;
  expectedDelivery?: string;
  poNumber?: string;
  finalizedVendor?: {
    name: string;
    price: number;
    leadTime: string;
    availability: string;
  };
}

export interface BOMCategory {
  name: string;
  items: BOMItem[];
  isExpanded: boolean;
} 