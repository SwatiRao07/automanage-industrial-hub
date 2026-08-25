import type { PurchaseOrder } from '@/types/purchaseOrder';

export interface ProjectPOs {
  projectId: string;
  projectName: string;
  purchaseOrders: PurchaseOrder[];
}

export interface PendingPOApproval {
  projectId: string;
  projectName: string;
  poId: string;
  poNumber: string;
  vendorName: string;
  amount: number;
  submittedAt: Date;
}

export interface PendingPOApprovalsSummary {
  /** Oldest-first, capped at `limit` */
  approvals: PendingPOApproval[];
  /** Total pending count across ALL projects, not capped by `limit` */
  count: number;
  /** Total pending amount across ALL projects, not capped by `limit` */
  totalAmount: number;
}

export const PENDING_PO_APPROVALS_DISPLAY_LIMIT = 10;

export function extractPendingPOApprovals(
  projects: ProjectPOs[],
  limit: number = PENDING_PO_APPROVALS_DISPLAY_LIMIT
): PendingPOApprovalsSummary {
  const all: PendingPOApproval[] = [];

  for (const project of projects) {
    for (const po of project.purchaseOrders) {
      if (po.status !== 'pending-approval') continue;
      all.push({
        projectId: project.projectId,
        projectName: project.projectName,
        poId: po.id,
        poNumber: po.poNumber,
        vendorName: po.vendorName,
        amount: po.totalAmount,
        submittedAt: po.submittedForApprovalAt || po.updatedAt,
      });
    }
  }

  all.sort((a, b) => a.submittedAt.getTime() - b.submittedAt.getTime());
  const totalAmount = all.reduce((sum, a) => sum + a.amount, 0);

  return { approvals: all.slice(0, limit), count: all.length, totalAmount };
}
