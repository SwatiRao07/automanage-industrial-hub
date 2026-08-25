import { db, functions } from "@/firebase";
import {
  collection,
  addDoc,
  doc,
  getDocs,
  getDoc,
  onSnapshot,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  Timestamp,
  Unsubscribe,
  runTransaction,
  writeBatch,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  PurchaseOrder,
  POStatus,
  POItem,
  POWarning,
  TaxType,
  calculatePOTotals,
  generatePONumber,
  determineTaxType,
  numberToWords,
} from "@/types/purchaseOrder";
import {
  billingEntityToCompanySettings,
  getBillingEntity,
  incrementBillingEntityPONumber,
} from "./settingsFirestore";

// Re-export types for convenience
export type { PurchaseOrder, POStatus, POItem, POWarning, TaxType };

/**
 * Remove undefined values from an object to prevent Firestore errors
 * Recursively cleans nested objects and arrays
 */
const cleanFirestoreData = <T extends Record<string, unknown>>(data: T): Partial<T> => {
  const cleanValue = (value: unknown): unknown => {
    if (value === undefined) return null; // Convert undefined to null for Firestore
    if (value === null) return null;
    if (Array.isArray(value)) {
      return value.map(cleanValue);
    }
    if (value instanceof Date) return value;
    if (typeof value === 'object' && value !== null) {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (v !== undefined) {
          cleaned[k] = cleanValue(v);
        }
      }
      return cleaned;
    }
    return value;
  };

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      result[key] = cleanValue(value);
    }
  }
  return result as Partial<T>;
};

/**
 * Convert Firestore Timestamp to Date
 */
const toDate = (timestamp: Timestamp | Date | undefined): Date | undefined => {
  if (!timestamp) return undefined;
  if (timestamp instanceof Timestamp) {
    return timestamp.toDate();
  }
  return timestamp;
};

/**
 * Convert Date to Firestore Timestamp
 */
const toTimestamp = (date: Date | undefined): Timestamp | undefined => {
  if (!date) return undefined;
  return Timestamp.fromDate(date);
};

/**
 * Map a raw Firestore PO document into a PurchaseOrder, converting Timestamps to Dates
 */
const mapPODocument = (id: string, data: Record<string, unknown>): PurchaseOrder => {
  return {
    ...data,
    id,
    poDate: toDate(data.poDate as Timestamp | Date | undefined) || new Date(),
    createdAt: toDate(data.createdAt as Timestamp | Date | undefined) || new Date(),
    updatedAt: toDate(data.updatedAt as Timestamp | Date | undefined) || new Date(),
    expectedDeliveryDate: toDate(data.expectedDeliveryDate as Timestamp | Date | undefined),
    sentAt: toDate(data.sentAt as Timestamp | Date | undefined),
    closedAt: toDate(data.closedAt as Timestamp | Date | undefined),
    submittedForApprovalAt: toDate(data.submittedForApprovalAt as Timestamp | Date | undefined),
    changesRequestedAt: toDate(data.changesRequestedAt as Timestamp | Date | undefined),
  } as unknown as PurchaseOrder;
};

// ============================================
// PO Collection Reference
// ============================================

const getPOCollectionRef = (projectId: string) => {
  return collection(db, "projects", projectId, "purchaseOrders");
};

// ============================================
// Create Purchase Order
// ============================================

export interface CreatePOInput {
  projectId: string;
  projectReference: string;
  billingEntityId: string;

  // Vendor info
  vendorId: string;
  vendorName: string;
  vendorAddress: string;
  vendorGstin: string;
  vendorStateCode: string;
  vendorStateName: string;
  vendorEmail?: string;
  vendorPhone?: string;

  // Ship To (optional - defaults to company address if not provided)
  shipToAddress?: string;
  shipToGstin?: string;
  shipToStateCode?: string;
  shipToStateName?: string;

  // Items
  items: Omit<POItem, 'slNo'>[];

  // Terms
  paymentTerms: string;
  deliveryTerms: string;
  dispatchedThrough?: string;
  destination?: string;
  termsAndConditions?: string;
  includeAnnexure: boolean;

  // Dates
  expectedDeliveryDate?: Date;

  // Reference
  vendorQuoteReference?: string;

  // User
  createdBy: string;
}

export const createPurchaseOrder = async (input: CreatePOInput): Promise<string> => {
  // Resolve the entity issuing this PO and snapshot its legal details on the PO.
  const billingEntity = await getBillingEntity(input.billingEntityId);
  const companySettings = billingEntity
    ? billingEntityToCompanySettings(billingEntity)
    : null;

  if (!companySettings) {
    throw new Error("Billing entity not configured. Please complete it in Settings.");
  }

  // Validate company settings
  if (!companySettings.gstin || !companySettings.stateCode) {
    throw new Error("Company GSTIN and State Code must be configured in Settings.");
  }

  // Generate PO number
  const poNumber = generatePONumber(
    companySettings.poNumberPrefix,
    companySettings.poNumberFormat,
    companySettings.nextPoNumber
  );

  // Determine tax type based on states
  const taxType = determineTaxType(companySettings.stateCode, input.vendorStateCode);
  const taxPercentage = 18; // Standard GST rate

  // Add serial numbers to items
  const itemsWithSlNo: POItem[] = input.items.map((item, index) => ({
    ...item,
    slNo: index + 1,
  }));

  // Calculate totals
  const totals = calculatePOTotals(itemsWithSlNo, taxType, taxPercentage);

  // Create PO object
  const now = new Date();
  const po: Omit<PurchaseOrder, 'id'> = {
    projectId: input.projectId,
    billingEntityId: input.billingEntityId,
    poNumber,

    // Vendor
    vendorId: input.vendorId,
    vendorName: input.vendorName,
    vendorAddress: input.vendorAddress,
    vendorGstin: input.vendorGstin,
    vendorStateCode: input.vendorStateCode,
    vendorStateName: input.vendorStateName,
    vendorEmail: input.vendorEmail,
    vendorPhone: input.vendorPhone,

    // Reference
    projectReference: input.projectReference,
    vendorQuoteReference: input.vendorQuoteReference,

    // Invoice To (from company settings)
    invoiceToCompany: companySettings.companyName,
    invoiceToAddress: companySettings.companyAddress,
    invoiceToGstin: companySettings.gstin,
    invoiceToStateCode: companySettings.stateCode,
    invoiceToStateName: companySettings.stateName,

    // Ship To (use provided values or default to company address)
    shipToAddress: input.shipToAddress || companySettings.companyAddress,
    shipToGstin: input.shipToGstin || companySettings.gstin,
    shipToStateCode: input.shipToStateCode || companySettings.stateCode,
    shipToStateName: input.shipToStateName || companySettings.stateName,

    // Items
    items: itemsWithSlNo,

    // Financials
    subtotal: totals.subtotal,
    taxType,
    taxPercentage,
    igstAmount: totals.igstAmount,
    cgstAmount: totals.cgstAmount,
    sgstAmount: totals.sgstAmount,
    totalAmount: totals.totalAmount,
    amountInWords: totals.amountInWords,
    currency: 'INR',

    // Terms
    paymentTerms: input.paymentTerms,
    deliveryTerms: input.deliveryTerms,
    dispatchedThrough: input.dispatchedThrough,
    destination: input.destination,
    termsAndConditions: input.termsAndConditions,
    includeAnnexure: input.includeAnnexure,

    // Dates
    poDate: now,
    expectedDeliveryDate: input.expectedDeliveryDate,

    // Status - always starts as draft
    status: 'draft',

    // Warnings - empty for now, can be populated later
    warnings: [],

    // Tracking
    createdAt: now,
    createdBy: input.createdBy,
    updatedAt: now,
  };

  // Clean undefined values
  const cleanedPO = cleanFirestoreData(po);

  // Convert dates to Timestamps
  const firestorePO = {
    ...cleanedPO,
    poDate: Timestamp.fromDate(now),
    createdAt: Timestamp.fromDate(now),
    updatedAt: Timestamp.fromDate(now),
    expectedDeliveryDate: input.expectedDeliveryDate ? Timestamp.fromDate(input.expectedDeliveryDate) : null,
  };

  // Add to Firestore
  const collectionRef = getPOCollectionRef(input.projectId);
  const docRef = await addDoc(collectionRef, firestorePO);

  // Keep independent PO sequences for each legal entity.
  await incrementBillingEntityPONumber(
    input.billingEntityId,
    companySettings.nextPoNumber + 1,
  );

  return docRef.id;
};

// ============================================
// Get Purchase Orders
// ============================================

export const getPurchaseOrders = async (projectId: string): Promise<PurchaseOrder[]> => {
  const collectionRef = getPOCollectionRef(projectId);
  const q = query(collectionRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => mapPODocument(doc.id, doc.data()));
};

export const getPurchaseOrder = async (projectId: string, poId: string): Promise<PurchaseOrder | null> => {
  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  return mapPODocument(docSnap.id, docSnap.data());
};

// ============================================
// Subscribe to Purchase Orders
// ============================================

export const subscribeToPurchaseOrders = (
  projectId: string,
  callback: (pos: PurchaseOrder[]) => void
): Unsubscribe => {
  const collectionRef = getPOCollectionRef(projectId);
  const q = query(collectionRef, orderBy("createdAt", "desc"));

  return onSnapshot(q, (snapshot) => {
    const pos = snapshot.docs.map((doc) => mapPODocument(doc.id, doc.data()));
    callback(pos);
  });
};

// ============================================
// Update Purchase Order
// ============================================

export interface UpdatePOInput {
  // Terms (can be edited while in draft)
  paymentTerms?: string;
  deliveryTerms?: string;
  dispatchedThrough?: string;
  destination?: string;
  termsAndConditions?: string;
  includeAnnexure?: boolean;

  // Ship To address (can be edited while in draft)
  shipToAddress?: string;
  shipToGstin?: string;
  shipToStateCode?: string;
  shipToStateName?: string;

  // Dates
  expectedDeliveryDate?: Date;

  // Status
  status?: POStatus;

  // Reference
  vendorQuoteReference?: string;

  // Warnings
  warnings?: POWarning[];

  // PDF URL (set after generation)
  pdfUrl?: string;
}

export const updatePurchaseOrder = async (
  projectId: string,
  poId: string,
  updates: UpdatePOInput
): Promise<void> => {
  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);

  const cleanedUpdates = cleanFirestoreData({
    ...updates,
    updatedAt: Timestamp.fromDate(new Date()),
    expectedDeliveryDate: updates.expectedDeliveryDate
      ? Timestamp.fromDate(updates.expectedDeliveryDate)
      : undefined,
  });

  await updateDoc(docRef, cleanedUpdates);
};

// ============================================
// Submit Purchase Order for Approval
// ============================================

export const submitPOForApproval = async (
  projectId: string,
  poId: string,
  submittedBy: string
): Promise<void> => {
  const po = await getPurchaseOrder(projectId, poId);
  if (!po) {
    throw new Error("Purchase Order not found");
  }

  if (po.status !== 'draft') {
    throw new Error("Only draft POs can be submitted for approval");
  }

  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);
  const now = new Date();

  await updateDoc(docRef, {
    status: 'pending-approval',
    submittedForApprovalAt: Timestamp.fromDate(now),
    submittedBy,
    changesRequestedAt: null,
    changesRequestedBy: null,
    changesRequestedNote: null,
    updatedAt: Timestamp.fromDate(now),
  });
};

// ============================================
// Request Changes on a Purchase Order (Admin Only)
// ============================================

export const requestPOChanges = async (
  projectId: string,
  poId: string,
  requestedBy: string,
  note?: string
): Promise<void> => {
  const po = await getPurchaseOrder(projectId, poId);
  if (!po) {
    throw new Error("Purchase Order not found");
  }

  if (po.status !== 'pending-approval') {
    throw new Error("Only POs pending approval can have changes requested");
  }

  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);
  const now = new Date();

  await updateDoc(docRef, {
    status: 'draft',
    changesRequestedAt: Timestamp.fromDate(now),
    changesRequestedBy: requestedBy,
    changesRequestedNote: note || null,
    updatedAt: Timestamp.fromDate(now),
  });
};

// ============================================
// Send Purchase Order (Admin Only)
// ============================================

export interface SendPOInput {
  sentBy: string;
  sentToEmail: string;
}

export const sendPurchaseOrder = async (
  projectId: string,
  poId: string,
  input: SendPOInput,
  updateBOMItemsCallback?: (bomItemIds: string[]) => Promise<void>
): Promise<void> => {
  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);

  // Get the PO to get BOM item IDs
  const po = await getPurchaseOrder(projectId, poId);
  if (!po) {
    throw new Error("Purchase Order not found");
  }

  if (po.status !== 'pending-approval') {
    throw new Error("Only POs pending approval can be sent");
  }

  const now = new Date();

  // Update PO status to sent
  await updateDoc(docRef, {
    status: 'sent',
    sentAt: Timestamp.fromDate(now),
    sentBy: input.sentBy,
    sentToEmail: input.sentToEmail,
    updatedAt: Timestamp.fromDate(now),
  });

  // Update BOM items to "Ordered" status if callback provided
  if (updateBOMItemsCallback) {
    const bomItemIds = po.items.map(item => item.bomItemId);
    await updateBOMItemsCallback(bomItemIds);
  }
};

// ============================================
// Delete Purchase Order
// ============================================

export const deletePurchaseOrder = async (
  projectId: string,
  poId: string
): Promise<void> => {
  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);
  await deleteDoc(docRef);
};

// ============================================
// Get POs by Vendor
// ============================================

export const getPurchaseOrdersByVendor = async (
  projectId: string,
  vendorId: string
): Promise<PurchaseOrder[]> => {
  const collectionRef = getPOCollectionRef(projectId);
  const q = query(
    collectionRef,
    where("vendorId", "==", vendorId),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => mapPODocument(doc.id, doc.data()));
};

// ============================================
// Get POs by Status
// ============================================

export const getPurchaseOrdersByStatus = async (
  projectId: string,
  status: POStatus
): Promise<PurchaseOrder[]> => {
  const collectionRef = getPOCollectionRef(projectId);
  const q = query(
    collectionRef,
    where("status", "==", status),
    orderBy("createdAt", "desc")
  );
  const snapshot = await getDocs(q);

  return snapshot.docs.map((doc) => mapPODocument(doc.id, doc.data()));
};

// ============================================
// Update PO Status
// ============================================

export const updatePOStatus = async (
  projectId: string,
  poId: string,
  newStatus: POStatus
): Promise<void> => {
  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);

  const updates: Record<string, unknown> = {
    status: newStatus,
    updatedAt: Timestamp.fromDate(new Date()),
  };

  // Add closedAt for terminal statuses
  if (newStatus === 'completed' || newStatus === 'cancelled') {
    updates.closedAt = Timestamp.fromDate(new Date());
  }

  await updateDoc(docRef, updates);
};

// ============================================
// Recalculate PO Totals
// ============================================

export const recalculatePOTotals = async (
  projectId: string,
  poId: string
): Promise<void> => {
  const po = await getPurchaseOrder(projectId, poId);
  if (!po) {
    throw new Error("Purchase Order not found");
  }

  const totals = calculatePOTotals(po.items, po.taxType, po.taxPercentage);

  const docRef = doc(db, "projects", projectId, "purchaseOrders", poId);
  await updateDoc(docRef, {
    ...totals,
    updatedAt: Timestamp.fromDate(new Date()),
  });
};

// ============================================
// PDF Generation
// ============================================

export interface GeneratePOPDFInput {
  purchaseOrder: PurchaseOrder;
  companySettings: {
    companyName: string;
    companyAddress: string;
    gstin: string;
    stateCode: string;
    stateName: string;
    pan?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  companyLogo?: string;       // Base64 encoded logo (optional)
  companyLogoPath?: string;   // Firebase Storage path (preferred - avoids CORS)
}

export interface GeneratePOPDFResult {
  success: boolean;
  pdfUrl: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
}

/**
 * Serialize Date objects to ISO strings for Firebase callable functions
 * This prevents serialization errors when Date objects are null or invalid
 */
const serializeDates = (obj: any): any => {
  if (obj === null || obj === undefined) {
    return null;
  }
  
  if (obj instanceof Date) {
    // Return ISO string, or null if date is invalid
    return isNaN(obj.getTime()) ? null : obj.toISOString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(serializeDates);
  }
  
  if (typeof obj === 'object') {
    const serialized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeDates(value);
    }
    return serialized;
  }
  
  return obj;
};

/**
 * Generate a PDF for a Purchase Order
 * Calls Firebase Function to create PDF and store in Firebase Storage
 */
export const generatePOPDF = async (
  input: GeneratePOPDFInput
): Promise<GeneratePOPDFResult> => {
  const generatePOPDFFunction = httpsCallable<GeneratePOPDFInput, GeneratePOPDFResult>(
    functions,
    'generatePOPDF'
  );

  // Serialize Date objects to ISO strings to prevent serialization errors
  const serializedInput = serializeDates(input);

  const result = await generatePOPDFFunction(serializedInput);
  return result.data;
};

// ============================================
// Send PO via Email
// ============================================

export interface SendPOEmailInput {
  purchaseOrder: PurchaseOrder;
  companySettings: {
    companyName: string;
    companyAddress: string;
    gstin: string;
    stateCode: string;
    stateName: string;
    pan?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  companyLogo?: string;       // Base64 encoded logo (optional)
  companyLogoPath?: string;   // Firebase Storage path (preferred - avoids CORS)
  recipientEmail: string;
  ccEmails?: string[];
}

export interface SendPOEmailResult {
  success: boolean;
  message: string;
  pdfUrl: string;
}

/**
 * Generate PDF and send PO via email to vendor
 * Uses Firebase Function with Resend
 */
export const sendPOEmail = async (
  input: SendPOEmailInput
): Promise<SendPOEmailResult> => {
  const sendPurchaseOrderFunction = httpsCallable<SendPOEmailInput, SendPOEmailResult>(
    functions,
    'sendPurchaseOrder'
  );

  const result = await sendPurchaseOrderFunction(input);
  return result.data;
};

// ============================================
// Notify Admins / Submitter of Approval Events
// ============================================

export interface NotifyPOApprovalInput {
  mode: 'submitted' | 'changes-requested';
  projectId: string;
  projectName: string;
  poNumber: string;
  vendorName: string;
  totalAmount: number;
  // Required for mode: 'changes-requested'
  submitterUid?: string;
  note?: string;
}

/**
 * Best-effort email notification for the PO approval workflow.
 * Failures are swallowed by the caller (UI) - the status change already succeeded.
 */
export const notifyPOApproval = async (input: NotifyPOApprovalInput): Promise<void> => {
  const notifyFunction = httpsCallable(functions, 'notifyPOApproval');
  await notifyFunction(input);
};
