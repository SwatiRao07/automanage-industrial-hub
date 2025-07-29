
import { Calendar, ChevronDown, Building2, Link as LinkIcon, MoreHorizontal, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose
} from '@/components/ui/dialog';
import { useState } from 'react';
import QuantityControl from './QuantityControl';

interface BOMItem {
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
  status: 'not-ordered' | 'ordered' | 'received' | 'approved';
  expectedDelivery?: string;
  poNumber?: string;
  finalizedVendor?: { name: string; price: number; leadTime: string; availability: string };
}

interface BOMPartRowProps {
  part: BOMItem;
  onClick: () => void;
  onQuantityChange?: (itemId: string, newQuantity: number) => void;
  allVendors?: Array<{ name: string; price: number; leadTime: string; availability: string }>;
  onDelete?: (itemId: string) => void;
  onStatusChange?: (itemId: string, newStatus: string) => void;
}

const BOMPartRow = ({ part, onClick, onQuantityChange, allVendors = [], onDelete, onStatusChange }: BOMPartRowProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [vendors, setVendors] = useState(part.vendors);
  const [form, setForm] = useState({ name: '', price: 0, leadTime: '', availability: '' });
  const [selectedVendorIdx, setSelectedVendorIdx] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showDeleteConfirmIdx, setShowDeleteConfirmIdx] = useState<number | null>(null);
  const [addPrevVendorIdx, setAddPrevVendorIdx] = useState<number | null>(null);

  // Handle selecting a current vendor for editing
  const handleSelectVendor = (idx: number) => {
    setSelectedVendorIdx(idx);
    setForm(vendors[idx]);
  };

  // Handle editing a vendor
  const handleEditVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedVendorIdx === null) return;
    const updated = vendors.map((v, i) => i === selectedVendorIdx ? form : v);
    setVendors(updated);
    setForm({ name: '', price: 0, leadTime: '', availability: '' });
    setSelectedVendorIdx(null);
  };

  // Handle adding a previous vendor
  const handleAddPrevVendor = () => {
    if (addPrevVendorIdx === null) return;
    const prevVendor = allVendors[addPrevVendorIdx];
    if (!vendors.some(v => v.name === prevVendor.name)) {
      setVendors([...vendors, prevVendor]);
    }
    setAddPrevVendorIdx(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: name === 'price' ? Number(value) : value }));
  };

  const handleAddVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.leadTime || !form.availability) return;
    setVendors(prev => [...prev, form]);
    setForm({ name: '', price: 0, leadTime: '', availability: '' });
    setDialogOpen(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved':
        return <Badge className="bg-blue-100 text-blue-800 border-blue-200">Approved</Badge>;
      case 'ordered':
        return <Badge className="bg-amber-100 text-amber-800 border-amber-200">Ordered</Badge>;
      case 'not-ordered':
        return <Badge className="bg-red-100 text-red-800 border-red-200">Not Ordered</Badge>;
      case 'received':
        return <Badge className="bg-green-100 text-green-800 border-green-200">Received</Badge>;
      default:
        return <Badge variant="outline">Unknown</Badge>;
    }
  };

  return (
    <div 
      className="border border-gray-200 rounded-lg p-9 hover:bg-gray-50 transition-colors cursor-pointer relative"
      onClick={onClick}
    >
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h4 className="font-medium text-gray-900">{part.name}</h4>
              </div>
              
              <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                {part.expectedDelivery && (
                  <div className="flex items-center gap-1">
                    <Calendar size={12} />
                    <span>Expected: {part.expectedDelivery}</span>
                  </div>
                )}
                {part.poNumber && (
                  <div className="flex items-center gap-1">
                    <LinkIcon size={12} />
                    <span>PO: {part.poNumber}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-sm font-medium text-gray-900">
              {part.finalizedVendor
                ? `Vendor: ${part.finalizedVendor.name}`
                : 'No vendor selected'}
            </div>
              <div className="text-xs text-gray-500">
              Qty: {part.quantity}
              </div>
          </div>
          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <span>{getStatusBadge(part.status)}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => onStatusChange?.(part.id, 'approved')}>Approved</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStatusChange?.(part.id, 'ordered')}>Ordered</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStatusChange?.(part.id, 'not-ordered')}>Not Ordered</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStatusChange?.(part.id, 'received')}>Received</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
};

export default BOMPartRow;
