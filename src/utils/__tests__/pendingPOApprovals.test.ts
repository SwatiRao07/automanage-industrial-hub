import { describe, it, expect } from 'vitest';
import { extractPendingPOApprovals, PENDING_PO_APPROVALS_DISPLAY_LIMIT } from '../pendingPOApprovals';
import type { ProjectPOs } from '../pendingPOApprovals';
import type { PurchaseOrder } from '@/types/purchaseOrder';

const po = (overrides: Partial<PurchaseOrder>): PurchaseOrder => ({
  id: 'po1',
  projectId: 'p1',
  poNumber: 'PO-QT-2026-001',
  vendorId: 'v1',
  vendorName: 'Acme Supplies',
  vendorAddress: '',
  vendorGstin: '',
  vendorStateCode: '29',
  vendorStateName: 'Karnataka',
  projectReference: 'p1',
  invoiceToCompany: '',
  invoiceToAddress: '',
  invoiceToGstin: '',
  invoiceToStateCode: '29',
  invoiceToStateName: 'Karnataka',
  shipToAddress: '',
  items: [],
  subtotal: 1000,
  taxType: 'cgst_sgst',
  taxPercentage: 18,
  totalAmount: 1180,
  amountInWords: '',
  currency: 'INR',
  paymentTerms: '',
  deliveryTerms: '',
  includeAnnexure: false,
  poDate: new Date('2026-07-01'),
  status: 'pending-approval',
  submittedForApprovalAt: new Date('2026-07-01T10:00:00.000Z'),
  submittedBy: 'u1',
  warnings: [],
  createdAt: new Date('2026-07-01'),
  createdBy: 'u1',
  updatedAt: new Date('2026-07-01'),
  ...overrides,
});

const project = (overrides: Partial<ProjectPOs>): ProjectPOs => ({
  projectId: 'p1',
  projectName: 'Project 1',
  purchaseOrders: [],
  ...overrides,
});

describe('extractPendingPOApprovals', () => {
  it('returns an empty summary for no projects', () => {
    expect(extractPendingPOApprovals([])).toEqual({ approvals: [], count: 0, totalAmount: 0 });
  });

  it('filters out POs that are not pending approval', () => {
    const projects = [
      project({
        purchaseOrders: [
          po({ id: 'po-draft', status: 'draft' }),
          po({ id: 'po-sent', status: 'sent' }),
        ],
      }),
    ];
    expect(extractPendingPOApprovals(projects)).toEqual({ approvals: [], count: 0, totalAmount: 0 });
  });

  it('includes project and PO details in each approval', () => {
    const projects = [project({ purchaseOrders: [po({})] })];
    const result = extractPendingPOApprovals(projects);
    expect(result.approvals[0]).toMatchObject({
      projectId: 'p1',
      projectName: 'Project 1',
      poId: 'po1',
      poNumber: 'PO-QT-2026-001',
      vendorName: 'Acme Supplies',
      amount: 1180,
    });
  });

  it('sorts pending approvals oldest first', () => {
    const projects = [
      project({
        purchaseOrders: [
          po({ id: 'po-new', submittedForApprovalAt: new Date('2026-07-10T00:00:00.000Z') }),
          po({ id: 'po-old', submittedForApprovalAt: new Date('2026-07-01T00:00:00.000Z') }),
        ],
      }),
    ];
    const result = extractPendingPOApprovals(projects);
    expect(result.approvals.map((a) => a.poId)).toEqual(['po-old', 'po-new']);
  });

  it('counts and sums the full pending set even when the returned list is capped', () => {
    const purchaseOrders = Array.from({ length: 12 }, (_, i) =>
      po({
        id: `po${i}`,
        submittedForApprovalAt: new Date(`2026-07-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`),
        totalAmount: 100,
      })
    );
    const projects = [project({ purchaseOrders })];
    const result = extractPendingPOApprovals(projects);
    expect(result.count).toBe(12);
    expect(result.totalAmount).toBe(1200);
    expect(result.approvals).toHaveLength(PENDING_PO_APPROVALS_DISPLAY_LIMIT);
  });
});
