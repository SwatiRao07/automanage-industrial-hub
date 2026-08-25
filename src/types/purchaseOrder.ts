// Purchase Order Types

// ============================================
// PO Status and Tax Types
// ============================================

export type POStatus =
  | 'draft'              // Created but not submitted
  | 'pending-approval'   // Submitted by engineer, awaiting admin review
  | 'sent'               // Approved by admin and sent to vendor
  | 'acknowledged'       // Vendor acknowledged receipt
  | 'partially-received' // Some items received
  | 'completed'          // All items received
  | 'cancelled';         // PO cancelled

export type TaxType = 'igst' | 'cgst_sgst';

// ============================================
// PO Item Interface
// ============================================

export interface POItem {
  bomItemId: string;           // Reference to BOM item
  slNo: number;                // Serial number in PO
  description: string;         // Full description with specs
  itemCode?: string;           // SKU/Part number
  make?: string;               // Brand/Manufacturer
  uom: string;                 // Unit of measure: "nos", "Days", "Mtrs"
  quantity: number;
  rate: number;                // Unit price
  discountPercent?: number;    // Discount percentage
  amount: number;              // quantity * rate * (1 - discount/100)
  dueDate?: Date;              // Expected delivery for this item
  hsn?: string;                // HSN code for tax purposes
}

// ============================================
// PO Warning Interface
// ============================================

export interface POWarning {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

// ============================================
// Main Purchase Order Interface
// ============================================

export interface PurchaseOrder {
  id: string;
  projectId: string;
  billingEntityId?: string;
  poNumber: string;              // "PO-QT-2025-001"

  // Vendor (single vendor per PO)
  vendorId: string;
  vendorName: string;
  vendorAddress: string;
  vendorGstin: string;
  vendorStateCode: string;       // For IGST vs CGST/SGST determination
  vendorStateName: string;
  vendorEmail?: string;
  vendorPhone?: string;

  // Reference
  projectReference: string;      // Project ID/Name for "Reference No." field
  vendorQuoteReference?: string;  // Vendor's quote number/reference

  // Addresses (from Company Settings)
  invoiceToCompany: string;
  invoiceToAddress: string;
  invoiceToGstin: string;
  invoiceToStateCode: string;
  invoiceToStateName: string;

  // Ship To (can be different from Invoice To)
  shipToAddress: string;
  shipToGstin?: string;
  shipToStateCode?: string;
  shipToStateName?: string;

  // Items
  items: POItem[];

  // Financials
  subtotal: number;
  taxType: TaxType;
  taxPercentage: number;         // 18
  igstAmount?: number;           // For IGST (full 18%)
  cgstAmount?: number;           // For CGST (9%)
  sgstAmount?: number;           // For SGST (9%)
  totalAmount: number;
  amountInWords: string;
  currency: 'INR';

  // Terms (entered during PO creation)
  paymentTerms: string;          // "100% payment within 30 days..."
  deliveryTerms: string;         // "2-4 Weeks from PO date"
  dispatchedThrough?: string;    // Transporter name
  destination?: string;          // Delivery destination

  // Terms & Conditions (editable text for Annexure)
  termsAndConditions?: string;   // Full T&C text for annexure
  includeAnnexure: boolean;      // Whether to include T&C annexure

  // Dates
  poDate: Date;
  expectedDeliveryDate?: Date;

  // Status flow: draft → pending-approval → sent → acknowledged → completed
  status: POStatus;

  // Approval workflow tracking
  submittedForApprovalAt?: Date;
  submittedBy?: string;          // User ID who submitted for approval
  changesRequestedAt?: Date;
  changesRequestedBy?: string;   // Admin user ID who requested changes
  changesRequestedNote?: string; // Optional note explaining what to fix

  // Admin send tracking
  sentAt?: Date;
  sentBy?: string;               // Admin user ID who sent
  sentToEmail?: string;          // Email address it was sent to

  // Documents
  pdfUrl?: string;               // Generated PDF in Firebase Storage

  // Validation warnings (stored for reference)
  warnings: POWarning[];

  // Tracking
  createdAt: Date;
  createdBy: string;
  updatedAt: Date;
}

// ============================================
// Company Settings Interface (for PO generation)
// ============================================

export interface CompanySettings {
  id: string;

  // Company Details
  companyName: string;
  companyAddress: string;
  gstin: string;
  stateCode: string;             // "29" for Karnataka
  stateName: string;             // "Karnataka"
  pan: string;

  // Contact
  phone?: string;
  email?: string;
  website?: string;

  // PO Settings
  poNumberPrefix: string;        // "PO-QT" or "PO/QT"
  poNumberFormat: 'simple' | 'financial-year';  // "PO-QT-2025-001" vs "PO/QT/24-25/001"
  nextPoNumber: number;          // Auto-increment counter

  // Default Terms (can be overridden per PO)
  defaultPaymentTerms?: string;
  defaultDeliveryTerms?: string;
  defaultTermsAndConditions?: string;  // Default T&C template

  // Logo
  logo?: string;
  logoPath?: string;

  // Tracking
  updatedAt: Date;
}

// ============================================
// Indian State Codes (for GST)
// ============================================

export const INDIAN_STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra',
  '28': 'Andhra Pradesh (Old)',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
};

// Get state name from code
export const getStateName = (stateCode: string): string => {
  return INDIAN_STATE_CODES[stateCode] || 'Unknown';
};

// Extract state code from GSTIN (first 2 digits)
export const extractStateCodeFromGSTIN = (gstin: string): string | null => {
  if (!gstin || gstin.length < 2) return null;
  const code = gstin.substring(0, 2);
  return INDIAN_STATE_CODES[code] ? code : null;
};

// Determine tax type based on state codes
export const determineTaxType = (
  companyStateCode: string,
  vendorStateCode: string
): TaxType => {
  // If same state, use CGST + SGST (intrastate)
  // If different state, use IGST (interstate)
  return companyStateCode === vendorStateCode ? 'cgst_sgst' : 'igst';
};

// ============================================
// Helper Functions
// ============================================

export const PO_STATUS_LABELS: Record<POStatus, string> = {
  draft: 'Draft',
  'pending-approval': 'Pending Approval',
  sent: 'Sent',
  acknowledged: 'Acknowledged',
  'partially-received': 'Partially Received',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const PO_STATUS_COLORS: Record<POStatus, string> = {
  draft: 'bg-gray-100 text-gray-800',
  'pending-approval': 'bg-amber-100 text-amber-800',
  sent: 'bg-blue-100 text-blue-800',
  acknowledged: 'bg-purple-100 text-purple-800',
  'partially-received': 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  cancelled: 'bg-red-100 text-red-800',
};

// Convert number to words (Indian format)
export const numberToWords = (num: number): string => {
  if (num === 0) return 'Zero';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const numToWords = (n: number): string => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    if (n < 1000) return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + numToWords(n % 100) : '');
    if (n < 100000) return numToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numToWords(n % 1000) : '');
    if (n < 10000000) return numToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numToWords(n % 100000) : '');
    return numToWords(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + numToWords(n % 10000000) : '');
  };

  // Handle decimal part
  const wholePart = Math.floor(num);
  const decimalPart = Math.round((num - wholePart) * 100);

  let result = 'INR ' + numToWords(wholePart);
  if (decimalPart > 0) {
    result += ' and ' + numToWords(decimalPart) + ' Paise';
  }
  result += ' Only';

  return result;
};

// Calculate PO totals
export const calculatePOTotals = (
  items: POItem[],
  taxType: TaxType,
  taxPercentage: number = 18
): {
  subtotal: number;
  igstAmount?: number;
  cgstAmount?: number;
  sgstAmount?: number;
  totalAmount: number;
  amountInWords: string;
} => {
  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);

  let igstAmount: number | undefined;
  let cgstAmount: number | undefined;
  let sgstAmount: number | undefined;
  let totalAmount: number;

  if (taxType === 'igst') {
    igstAmount = Math.round(subtotal * (taxPercentage / 100) * 100) / 100;
    totalAmount = subtotal + igstAmount;
  } else {
    // CGST + SGST (each is half of total tax)
    cgstAmount = Math.round(subtotal * (taxPercentage / 2 / 100) * 100) / 100;
    sgstAmount = Math.round(subtotal * (taxPercentage / 2 / 100) * 100) / 100;
    totalAmount = subtotal + cgstAmount + sgstAmount;
  }

  return {
    subtotal,
    igstAmount,
    cgstAmount,
    sgstAmount,
    totalAmount: Math.round(totalAmount * 100) / 100,
    amountInWords: numberToWords(Math.round(totalAmount)),
  };
};

// Generate PO number
export const generatePONumber = (
  prefix: string,
  format: 'simple' | 'financial-year',
  nextNumber: number
): string => {
  const now = new Date();
  const year = now.getFullYear();
  const paddedNumber = String(nextNumber).padStart(3, '0');

  if (format === 'financial-year') {
    // Financial year in India: April to March
    // If current month is Jan-Mar, FY is (year-1)-(year)
    // If current month is Apr-Dec, FY is (year)-(year+1)
    const month = now.getMonth(); // 0-11
    const fyStart = month < 3 ? year - 1 : year;
    const fyEnd = fyStart + 1;
    const fyShort = `${String(fyStart).slice(-2)}-${String(fyEnd).slice(-2)}`;
    return `${prefix}/${fyShort}/${paddedNumber}`;
  }

  // Simple format: PREFIX-YYYY-NNN
  return `${prefix}-${year}-${paddedNumber}`;
};

// Validate vendor for PO creation
export const validateVendorForPO = (vendor: {
  gstNo?: string;
  stateCode?: string;
}): POWarning[] => {
  const warnings: POWarning[] = [];

  if (!vendor.gstNo) {
    warnings.push({
      field: 'vendorGstin',
      message: 'Vendor GSTIN not set. Please update in Settings → Vendors',
      severity: 'error',
    });
  }

  if (!vendor.stateCode) {
    warnings.push({
      field: 'vendorStateCode',
      message: 'Vendor State Code not set. Please update in Settings → Vendors',
      severity: 'error',
    });
  }

  return warnings;
};

// Default T&C template
export const DEFAULT_TERMS_AND_CONDITIONS = `1. SCOPE OF SUPPLY
Your scope includes supply of items as per the main purchase order. All items shall strictly conform to specifications mentioned.

2. PRICE
2.1 The price is firm and not subject to any escalation.
2.2 Price is inclusive of packing, forwarding, and transportation charges unless otherwise specified.
2.3 GST shall be payable extra as applicable.

3. TERMS OF PAYMENT
As mentioned in the main purchase order.

4. DELIVERY SCHEDULE
4.1 Material shall be delivered as per the timeline mentioned in the purchase order.
4.2 Dispatch schedule is the essence of the order.

5. PENALTY
In event of delay in supplying the components as per the schedule, you will be liable to pay penalty @ 1% of the order value per week subject to a maximum of 10% of the value of the order.

6. PACKING & TRANSPORTATION
6.1 The packing shall be of first-rate quality to avoid any loss or damage during loading, transit and unloading.
6.2 Material shall be dispatched on FREIGHT-PAID basis unless otherwise specified.

7. WARRANTY
7.1 All items shall be warranted for 12 months from the date of commissioning or 18 months from dispatch, whichever is earlier.
7.2 Defective items shall be repaired or replaced at no cost within the warranty period.

8. INSPECTION
We reserve the right to inspect all items at your premises before dispatch.

9. ACCEPTANCE OF ORDER
Please send the copy of the Purchase Order duly signed by e-mail in token of acceptance thereof, within two or three days of receipt of the order.`;
