import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FileText,
  Trash2,
  Send,
  Edit,
  Eye,
  MoreHorizontal,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  Loader2,
  Download,
  Mail,
  Users,
  ClipboardCheck,
  RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import {
  subscribeToPurchaseOrders,
  deletePurchaseOrder,
  sendPurchaseOrder,
  generatePOPDF,
  sendPOEmail,
  submitPOForApproval,
  requestPOChanges,
  notifyPOApproval,
  PurchaseOrder
} from '@/utils/poFirestore';
import { billingEntityToCompanySettings, getBillingEntity } from '@/utils/settingsFirestore';
import { getProject, getNotificationRecipients, NotificationRecipient } from '@/utils/projectFirestore';
import { auth } from '@/firebase';
import { useAuth } from '@/hooks/useAuth';
import EditPODialog from './EditPODialog';

// Helper to convert image URL to base64
const fetchImageAsBase64 = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        // Remove the data URL prefix (e.g., "data:image/png;base64,")
        const base64Data = base64.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn('Failed to fetch logo:', error);
    return null;
  }
};

interface POListSectionProps {
  projectId: string;
  onPOSent?: (poId: string, bomItemIds: string[], poNumber: string) => Promise<void>;
}

const POListSection = ({ projectId, onPOSent }: POListSectionProps) => {
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [poToDelete, setPOToDelete] = useState<PurchaseOrder | null>(null);
  const [poToSend, setPOToSend] = useState<PurchaseOrder | null>(null);
  const [sendToEmail, setSendToEmail] = useState('');
  const [sendMode, setSendMode] = useState<'email' | 'mark'>('email'); // 'email' = send email, 'mark' = just mark as sent
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState<string | null>(null);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [ccRecipients, setCcRecipients] = useState<NotificationRecipient[]>([]);
  const [loadingCcRecipients, setLoadingCcRecipients] = useState(false);
  const [selectedCCStakeholderEmails, setSelectedCCStakeholderEmails] = useState<string[]>([]);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [poToEdit, setPOToEdit] = useState<PurchaseOrder | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [poToSubmit, setPOToSubmit] = useState<PurchaseOrder | null>(null);
  const [changesDialogOpen, setChangesDialogOpen] = useState(false);
  const [poForChanges, setPOForChanges] = useState<PurchaseOrder | null>(null);
  const [changesNote, setChangesNote] = useState('');
  const [requestingChanges, setRequestingChanges] = useState(false);
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link support: a "PO Approval Required" email links to ?tab=documents&po=<id>
  // so the reader lands directly on the PO instead of a generic project page.
  useEffect(() => {
    if (loading) return;
    const focusPOId = searchParams.get('po');
    if (!focusPOId) return;

    const match = purchaseOrders.find((p) => p.id === focusPOId);
    if (match) {
      setSelectedPO(match);
      setViewDialogOpen(true);
    }

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete('po');
      return next;
    }, { replace: true });
  }, [loading, purchaseOrders, searchParams, setSearchParams]);

  const resolvePOCompanySettings = async (po: PurchaseOrder) => {
    const project = po.billingEntityId ? null : await getProject(projectId);
    const entity = await getBillingEntity(po.billingEntityId || project?.billingEntityId);
    return entity ? billingEntityToCompanySettings(entity) : null;
  };

  const handleEditClick = (po: PurchaseOrder) => {
    setPOToEdit(po);
    setEditDialogOpen(true);
  };

  const handleSubmitClick = (po: PurchaseOrder) => {
    setPOToSubmit(po);
    setSubmitConfirmOpen(true);
  };

  const handleConfirmSubmitForApproval = async () => {
    const po = poToSubmit;
    const user = auth.currentUser;
    if (!po || !user) return;

    setSubmittingId(po.id);
    try {
      await submitPOForApproval(projectId, po.id, user.uid);
      toast({
        title: 'Submitted for Approval',
        description: `PO ${po.poNumber} is now waiting on admin review.`,
      });
      setSubmitConfirmOpen(false);
      setPOToSubmit(null);

      const project = await getProject(projectId);
      notifyPOApproval({
        mode: 'submitted',
        projectId,
        projectName: project?.projectName || projectId,
        poId: po.id,
        poNumber: po.poNumber,
        vendorName: po.vendorName,
        totalAmount: po.totalAmount,
      }).catch((err) => console.warn('[POListSection] Admin notification failed:', err));
    } catch (error) {
      console.error('Error submitting PO for approval:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to submit Purchase Order for approval.',
        variant: 'destructive',
      });
    } finally {
      setSubmittingId(null);
    }
  };

  const handleRequestChangesClick = (po: PurchaseOrder) => {
    setPOForChanges(po);
    setChangesNote('');
    setChangesDialogOpen(true);
  };

  const handleConfirmRequestChanges = async () => {
    if (!poForChanges) return;
    const user = auth.currentUser;
    if (!user) return;

    setRequestingChanges(true);
    try {
      await requestPOChanges(projectId, poForChanges.id, user.uid, changesNote.trim() || undefined);
      toast({
        title: 'Changes Requested',
        description: `PO ${poForChanges.poNumber} has been sent back to draft.`,
      });
      setChangesDialogOpen(false);

      if (poForChanges.submittedBy) {
        const project = await getProject(projectId);
        notifyPOApproval({
          mode: 'changes-requested',
          projectId,
          projectName: project?.projectName || projectId,
          poId: poForChanges.id,
          poNumber: poForChanges.poNumber,
          vendorName: poForChanges.vendorName,
          totalAmount: poForChanges.totalAmount,
          submitterUid: poForChanges.submittedBy,
          note: changesNote.trim() || undefined,
        }).catch((err) => console.warn('[POListSection] Submitter notification failed:', err));
      }

      setPOForChanges(null);
      setChangesNote('');
    } catch (error) {
      console.error('Error requesting PO changes:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to request changes.',
        variant: 'destructive',
      });
    } finally {
      setRequestingChanges(false);
    }
  };

  // Subscribe to purchase orders
  useEffect(() => {
    if (!projectId) return;

    const unsubscribe = subscribeToPurchaseOrders(projectId, (pos) => {
      setPurchaseOrders(pos);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [projectId]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'draft':
        return (
          <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-300">
            <Edit size={12} className="mr-1" />
            Draft
          </Badge>
        );
      case 'pending-approval':
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300">
            <ClipboardCheck size={12} className="mr-1" />
            Pending Approval
          </Badge>
        );
      case 'sent':
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-300">
            <Send size={12} className="mr-1" />
            Sent
          </Badge>
        );
      case 'acknowledged':
        return (
          <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-300">
            <CheckCircle size={12} className="mr-1" />
            Acknowledged
          </Badge>
        );
      case 'partially-received':
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-700 border-yellow-300">
            <Clock size={12} className="mr-1" />
            Partial
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-300">
            <CheckCircle size={12} className="mr-1" />
            Completed
          </Badge>
        );
      case 'cancelled':
        return (
          <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300">
            <XCircle size={12} className="mr-1" />
            Cancelled
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const handleViewPO = (po: PurchaseOrder) => {
    setSelectedPO(po);
    setViewDialogOpen(true);
  };

  const handleDeleteClick = (po: PurchaseOrder) => {
    setPOToDelete(po);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!poToDelete) return;

    setDeleting(true);
    try {
      await deletePurchaseOrder(projectId, poToDelete.id);
      toast({
        title: 'PO Deleted',
        description: `Purchase Order ${poToDelete.poNumber} has been deleted.`,
      });
      setDeleteDialogOpen(false);
      setPOToDelete(null);
    } catch (error) {
      console.error('Error deleting PO:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete Purchase Order. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
    }
  };

  const handleSendClick = async (po: PurchaseOrder, mode: 'email' | 'mark' = 'email') => {
    setPOToSend(po);
    setSendToEmail(po.vendorEmail || '');
    setSendMode(mode);
    setSendDialogOpen(true);

    // Fetch project members + external recipients for CC list
    setLoadingCcRecipients(true);
    try {
      const project = await getProject(projectId);
      const recipients = project ? getNotificationRecipients(project) : [];
      setCcRecipients(recipients);
      // Default: select all enabled recipients for CC
      setSelectedCCStakeholderEmails(recipients.map((r) => r.email.trim()));
    } catch (error) {
      console.error('Error fetching CC recipients:', error);
      setCcRecipients([]);
      setSelectedCCStakeholderEmails([]);
    } finally {
      setLoadingCcRecipients(false);
    }
  };

  const handleConfirmSend = async () => {
    if (!poToSend) return;

    if (!sendToEmail.trim()) {
      toast({
        title: 'Email Required',
        description: 'Please enter an email address to send the PO.',
        variant: 'destructive',
      });
      return;
    }

    setSending(true);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      await sendPurchaseOrder(
        projectId,
        poToSend.id,
        {
          sentBy: user.uid,
          sentToEmail: sendToEmail.trim(),
        },
        onPOSent ? async (bomItemIds) => {
          await onPOSent(poToSend.id, bomItemIds, poToSend.poNumber);
        } : undefined
      );

      toast({
        title: 'PO Sent',
        description: `Purchase Order ${poToSend.poNumber} has been marked as sent.`,
      });
      setSendDialogOpen(false);
      setPOToSend(null);
      setSendToEmail('');
    } catch (error) {
      console.error('Error sending PO:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send Purchase Order.',
        variant: 'destructive',
      });
    } finally {
      setSending(false);
    }
  };

  // Generate PDF and download
  const handleGeneratePDF = async (po: PurchaseOrder) => {
    setGeneratingPDF(po.id);
    try {
      const companySettings = await resolvePOCompanySettings(po);
      if (!companySettings) {
        throw new Error('Billing entity not configured');
      }

      const result = await generatePOPDF({
        purchaseOrder: po,
        companySettings: {
          companyName: companySettings.companyName,
          companyAddress: companySettings.companyAddress,
          gstin: companySettings.gstin,
          stateCode: companySettings.stateCode,
          stateName: companySettings.stateName,
          pan: companySettings.pan,
          phone: companySettings.phone,
          email: companySettings.email,
          website: companySettings.website,
        },
        // Pass logo path - Cloud Function will fetch from Storage (avoids CORS)
        companyLogoPath: companySettings.logoPath,
      });

      // Open PDF in new tab
      window.open(result.pdfUrl, '_blank');

      toast({
        title: 'PDF Generated',
        description: `PO ${po.poNumber} PDF is ready for download.`,
      });
    } catch (error) {
      console.error('Error generating PDF:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to generate PDF.',
        variant: 'destructive',
      });
    } finally {
      setGeneratingPDF(null);
    }
  };

  // Send PO via email with PDF
  const handleSendPOEmail = async () => {
    if (!poToSend || !sendToEmail.trim()) return;

    setSendingEmail(true);
    try {
      const companySettings = await resolvePOCompanySettings(poToSend);
      if (!companySettings) {
        throw new Error('Billing entity not configured');
      }

      const user = auth.currentUser;
      if (!user) throw new Error('Not authenticated');

      // Build CC list: logged-in user + selected stakeholders (independent of notifications toggle)
      const ccSet = new Set<string>();
      if (user.email) {
        ccSet.add(user.email.trim().toLowerCase());
      }
      selectedCCStakeholderEmails
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
        .forEach((email) => ccSet.add(email));
      // Avoid sending duplicate recipient in CC.
      ccSet.delete(sendToEmail.trim().toLowerCase());
      const ccList = Array.from(ccSet);

      // Send email with PDF
      await sendPOEmail({
        purchaseOrder: poToSend,
        companySettings: {
          companyName: companySettings.companyName,
          companyAddress: companySettings.companyAddress,
          gstin: companySettings.gstin,
          stateCode: companySettings.stateCode,
          stateName: companySettings.stateName,
          pan: companySettings.pan,
          phone: companySettings.phone,
          email: companySettings.email,
          website: companySettings.website,
        },
        // Pass logo path - Cloud Function will fetch from Storage (avoids CORS)
        companyLogoPath: companySettings.logoPath,
        recipientEmail: sendToEmail.trim(),
        ccEmails: ccList,
      });

      // Also update local status
      if (onPOSent) {
        const bomItemIds = poToSend.items.map(item => item.bomItemId);
        await onPOSent(poToSend.id, bomItemIds, poToSend.poNumber);
      }

      toast({
        title: 'PO Sent',
        description: `Purchase Order ${poToSend.poNumber} has been emailed to ${sendToEmail}.`,
      });
      setSendDialogOpen(false);
      setPOToSend(null);
      setSendToEmail('');
    } catch (error) {
      console.error('Error sending PO email:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send PO email.',
        variant: 'destructive',
      });
    } finally {
      setSendingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="mb-8">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b">
        <div>
          <h3 className="font-semibold text-lg text-gray-900">
            Vendor POs
            <Badge variant="outline" className="ml-2">{purchaseOrders.length}</Badge>
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            Purchase orders sent to vendors. Submit a draft for approval, then admins review and send.
          </p>
        </div>
      </div>

      {/* PO List */}
      <div className="space-y-3">
        {purchaseOrders.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm italic bg-gray-50 rounded border border-dashed">
            No purchase orders created yet. Use "Create PO" button in the BOM Items tab.
          </div>
        ) : (
          purchaseOrders.map((po) => (
            <div
              key={po.id}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded border border-gray-200 hover:bg-gray-100 transition-colors"
            >
              <FileText className="text-blue-600 flex-shrink-0" size={20} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-blue-700">
                    {po.poNumber}
                  </span>
                  {getStatusBadge(po.status)}
                </div>
                <div className="text-sm text-gray-600 mt-1">
                  <span className="font-medium">{po.vendorName}</span>
                  <span className="mx-2">•</span>
                  <span className="text-green-700 font-medium">{formatCurrency(po.totalAmount)}</span>
                  <span className="mx-2">•</span>
                  <span className="text-gray-500">{formatDate(po.poDate)}</span>
                  <span className="mx-2">•</span>
                  <span className="text-gray-500">{po.items.length} item{po.items.length !== 1 ? 's' : ''}</span>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleViewPO(po)}
                  title="View details"
                >
                  <Eye size={16} />
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleViewPO(po)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View Details
                    </DropdownMenuItem>

                    <DropdownMenuItem
                      onClick={() => handleGeneratePDF(po)}
                      disabled={generatingPDF === po.id}
                    >
                      {generatingPDF === po.id ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="mr-2 h-4 w-4" />
                      )}
                      Download PDF
                    </DropdownMenuItem>

                    {po.status === 'draft' && (
                      <DropdownMenuItem onClick={() => handleEditClick(po)}>
                        <Edit className="mr-2 h-4 w-4" />
                        Edit PO
                      </DropdownMenuItem>
                    )}

                    {po.status === 'draft' && (
                      <DropdownMenuItem
                        onClick={() => handleSubmitClick(po)}
                        disabled={submittingId === po.id}
                      >
                        {submittingId === po.id ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <ClipboardCheck className="mr-2 h-4 w-4" />
                        )}
                        Submit for Approval
                      </DropdownMenuItem>
                    )}

                    {po.status === 'pending-approval' && isAdmin && (
                      <DropdownMenuItem onClick={() => handleSendClick(po, 'email')}>
                        <Mail className="mr-2 h-4 w-4" />
                        Approve &amp; Email to Vendor
                      </DropdownMenuItem>
                    )}

                    {po.status === 'pending-approval' && isAdmin && (
                      <DropdownMenuItem onClick={() => handleSendClick(po, 'mark')}>
                        <Send className="mr-2 h-4 w-4" />
                        Approve &amp; Mark as Sent
                      </DropdownMenuItem>
                    )}

                    {po.status === 'pending-approval' && isAdmin && (
                      <DropdownMenuItem onClick={() => handleRequestChangesClick(po)}>
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Request Changes
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                      onClick={() => handleDeleteClick(po)}
                      className="text-red-600 focus:text-red-600"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))
        )}
      </div>

      {/* View PO Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Purchase Order Details</DialogTitle>
            <DialogDescription>
              {selectedPO?.poNumber} - {selectedPO?.vendorName}
            </DialogDescription>
          </DialogHeader>

          {selectedPO && (
            <div className="space-y-6">
              {/* Status and Basic Info */}
              <div className="flex items-center justify-between">
                {getStatusBadge(selectedPO.status)}
                <span className="text-sm text-gray-500">
                  Created: {formatDate(selectedPO.createdAt)}
                </span>
              </div>

              {/* Changes Requested - show when admin sent it back to draft */}
              {selectedPO.status === 'draft' && selectedPO.changesRequestedAt && (
                <div className="bg-red-50 border border-red-200 rounded p-3 text-sm">
                  <div className="flex items-center gap-2 text-red-800 font-medium">
                    <RotateCcw className="h-4 w-4" />
                    Changes requested
                  </div>
                  {selectedPO.changesRequestedNote && (
                    <div className="text-red-700 mt-1">{selectedPO.changesRequestedNote}</div>
                  )}
                  <div className="text-red-600 mt-1">
                    {formatDate(selectedPO.changesRequestedAt)}
                  </div>
                </div>
              )}

              {/* Sent Info - show when PO was sent */}
              {selectedPO.status === 'sent' && selectedPO.sentAt && (
                <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                  <div className="flex items-center gap-2 text-blue-800">
                    <Mail className="h-4 w-4" />
                    <span className="font-medium">Sent to:</span>
                    <span>{selectedPO.sentToEmail || 'N/A'}</span>
                  </div>
                  <div className="text-blue-600 mt-1 ml-6">
                    {formatDate(selectedPO.sentAt)}
                  </div>
                </div>
              )}

              {/* Vendor Info */}
              <div className="bg-gray-50 rounded p-4">
                <h4 className="font-medium mb-2">Vendor Details</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">Name:</span>{' '}
                    <span className="font-medium">{selectedPO.vendorName}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">GSTIN:</span>{' '}
                    <span className="font-medium">{selectedPO.vendorGstin || 'N/A'}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">Address:</span>{' '}
                    <span>{selectedPO.vendorAddress || 'N/A'}</span>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <h4 className="font-medium mb-2">Items ({selectedPO.items.length})</h4>
                <div className="border rounded overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-100">
                      <tr>
                        <th className="text-left p-2">#</th>
                        <th className="text-left p-2">Description</th>
                        <th className="text-right p-2">Qty</th>
                        <th className="text-right p-2">Rate</th>
                        <th className="text-right p-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPO.items.map((item, idx) => (
                        <tr key={idx} className="border-t">
                          <td className="p-2">{item.slNo}</td>
                          <td className="p-2">
                            <div className="font-medium">{item.description}</div>
                            {item.hsn && (
                              <div className="text-xs text-gray-500">HSN: {item.hsn}</div>
                            )}
                          </td>
                          <td className="text-right p-2">{item.quantity} {item.uom}</td>
                          <td className="text-right p-2">{formatCurrency(item.rate)}</td>
                          <td className="text-right p-2">{formatCurrency(item.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="bg-gray-50 rounded p-4">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span>{formatCurrency(selectedPO.subtotal)}</span>
                  </div>
                  {selectedPO.taxType === 'igst' ? (
                    <div className="flex justify-between">
                      <span>IGST ({selectedPO.taxPercentage}%):</span>
                      <span>{formatCurrency(selectedPO.igstAmount || 0)}</span>
                    </div>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span>CGST ({selectedPO.taxPercentage / 2}%):</span>
                        <span>{formatCurrency(selectedPO.cgstAmount || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>SGST ({selectedPO.taxPercentage / 2}%):</span>
                        <span>{formatCurrency(selectedPO.sgstAmount || 0)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between font-bold text-base pt-2 border-t">
                    <span>Total:</span>
                    <span className="text-green-700">{formatCurrency(selectedPO.totalAmount)}</span>
                  </div>
                </div>
              </div>

              {/* Terms */}
              {(selectedPO.paymentTerms || selectedPO.deliveryTerms) && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {selectedPO.paymentTerms && (
                    <div>
                      <span className="text-gray-500 block">Payment Terms:</span>
                      <span>{selectedPO.paymentTerms}</span>
                    </div>
                  )}
                  {selectedPO.deliveryTerms && (
                    <div>
                      <span className="text-gray-500 block">Delivery Terms:</span>
                      <span>{selectedPO.deliveryTerms}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialogOpen(false)}>
              Close
            </Button>
            {selectedPO?.status === 'pending-approval' && isAdmin && (
              <Button onClick={() => {
                setViewDialogOpen(false);
                handleSendClick(selectedPO);
              }}>
                <Send className="mr-2 h-4 w-4" />
                Approve &amp; Send PO
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Submit for Approval Confirmation Dialog */}
      <AlertDialog open={submitConfirmOpen} onOpenChange={setSubmitConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit PO for Approval?</AlertDialogTitle>
            <AlertDialogDescription>
              This emails all admins asking them to review PO <strong>{poToSubmit?.poNumber}</strong>{' '}
              ({poToSubmit ? formatCurrency(poToSubmit.totalAmount) : ''}) for <strong>{poToSubmit?.vendorName}</strong>.
              You won't be able to edit it while it's pending approval.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submittingId === poToSubmit?.id}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmSubmitForApproval}
              disabled={submittingId === poToSubmit?.id}
            >
              {submittingId === poToSubmit?.id ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Submitting...
                </>
              ) : (
                'Submit for Approval'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Purchase Order?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete PO <strong>{poToDelete?.poNumber}</strong>?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Send PO Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {sendMode === 'email' ? 'Email Purchase Order' : 'Mark as Sent'}
            </DialogTitle>
            <DialogDescription>
              {sendMode === 'email'
                ? `Generate PDF and email PO ${poToSend?.poNumber} to the vendor.`
                : `Mark PO ${poToSend?.poNumber} as sent and record the vendor email.`
              }
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-800">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
              <span>
                {sendMode === 'email'
                  ? 'This will generate a PDF and email it to the vendor. The PO will be marked as "Sent" and all linked BOM items updated to "Ordered" status.'
                  : 'This will mark the PO as "Sent" and update all linked BOM items to "Ordered" status. Make sure you\'ve sent the actual PO document to the vendor.'
                }
              </span>
            </div>

            <div className="space-y-2">
              <Label htmlFor="vendorEmail">Vendor Email</Label>
              <Input
                id="vendorEmail"
                type="email"
                value={sendToEmail}
                onChange={(e) => setSendToEmail(e.target.value)}
                placeholder="vendor@example.com"
              />
              <p className="text-xs text-gray-500">
                {sendMode === 'email'
                  ? 'The PO PDF will be sent to this email address.'
                  : 'Enter the email address where the PO was sent.'
                }
              </p>
            </div>

            {/* Members CC Section - only show for email mode */}
            {sendMode === 'email' && (
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Users size={14} />
                  CC: Select Members
                </Label>
                {loadingCcRecipients ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 size={14} className="animate-spin" />
                    Loading recipients...
                  </div>
                ) : (
                  <div className="bg-gray-50 border rounded p-3">
                    {ccRecipients.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">
                        No recipients found. Add members in the Members tab.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {ccRecipients.map((r) => {
                            const email = r.email.trim();
                            const isChecked = selectedCCStakeholderEmails.includes(email);
                            return (
                              <div key={email} className="flex items-center justify-between gap-2 text-sm">
                                <div className="min-w-0">
                                  <div className="font-medium truncate">{r.name}</div>
                                  <div className="text-gray-500 truncate">{email}</div>
                                </div>
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={(checked) => {
                                    setSelectedCCStakeholderEmails((prev) =>
                                      checked
                                        ? Array.from(new Set([...prev, email]))
                                        : prev.filter((e) => e !== email)
                                    );
                                  }}
                                />
                              </div>
                            );
                          })}
                        <p className="text-xs text-gray-500 mt-2">
                          {selectedCCStakeholderEmails.length} member{selectedCCStakeholderEmails.length !== 1 ? 's' : ''} selected for CC.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)} disabled={sending || sendingEmail}>
              Cancel
            </Button>
            {sendMode === 'email' ? (
              <Button onClick={handleSendPOEmail} disabled={sendingEmail || !sendToEmail.trim()}>
                {sendingEmail ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending Email...
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    Send Email
                  </>
                )}
              </Button>
            ) : (
              <Button onClick={handleConfirmSend} disabled={sending}>
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  <>
                    <Send className="mr-2 h-4 w-4" />
                    Mark as Sent
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Changes Dialog */}
      <Dialog open={changesDialogOpen} onOpenChange={setChangesDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>
              Send PO {poForChanges?.poNumber} back to draft so it can be revised before resubmitting.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="changesNote">Note (optional)</Label>
            <Input
              id="changesNote"
              value={changesNote}
              onChange={(e) => setChangesNote(e.target.value)}
              placeholder="What needs to change?"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setChangesDialogOpen(false)} disabled={requestingChanges}>
              Cancel
            </Button>
            <Button onClick={handleConfirmRequestChanges} disabled={requestingChanges}>
              {requestingChanges ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Sending Back...
                </>
              ) : (
                <>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Request Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit PO Dialog */}
      <EditPODialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        purchaseOrder={poToEdit}
        projectId={projectId}
        onSaved={() => {
          // POs will auto-refresh via subscription
        }}
      />
    </div>
  );
};

export default POListSection;
