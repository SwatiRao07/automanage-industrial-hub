
import { X, FileText, Calendar, Building2, DollarSign, Clock, Package, Pencil, Plus, Check, Trash2, Upload as UploadIcon } from 'lucide-react';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { useToast } from '@/components/ui/use-toast';

interface DocumentInfo {
  name: string;
  url: string;
}

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
  descriptionKV?: Array<{ key: string; value: string }>;
  documents?: DocumentInfo[];
}

interface BOMPartDetailsProps {
  part: BOMItem | null;
  onClose: () => void;
  onUpdatePart?: (updated: BOMItem) => void;
  onDeletePart?: (id: string) => void;
}

const BOMPartDetails = ({ part, onClose, onUpdatePart, onDeletePart }: BOMPartDetailsProps) => {
  if (!part) {
    return (
      <Card className="h-fit">
        <CardContent className="p-8 text-center">
          <Package className="mx-auto text-gray-300 mb-4" size={48} />
          <p className="text-gray-500">Select a part to view details</p>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'received': return 'bg-green-100 text-green-800 border-green-200';
      case 'ordered': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'not-ordered': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Extract camera specs from description (simple regex for demo)
  let resMatch = part.description.match(/Resolution: ([^\n]*)/);
  let typeMatch = part.description.match(/Type: ([^\n]*)/);
  let modelMatch = part.description.match(/Model Number: ([^\n]*)/);
  let makeMatch = part.description.match(/Make: ([^\n]*)/);
  let colorMatch = part.description.match(/(Monochrome|RGB)/i);

  const [editOpen, setEditOpen] = useState(false);
  const [resolution, setResolution] = useState(resMatch ? resMatch[1].trim() : '');
  const [type, setType] = useState(typeMatch ? typeMatch[1].trim() : 'Area scan');
  const [model, setModel] = useState(modelMatch ? modelMatch[1].trim() : '');
  const [make, setMake] = useState(makeMatch ? makeMatch[1].trim() : '');
  const [color, setColor] = useState(colorMatch ? colorMatch[0].toLowerCase().includes('rgb') ? 'RGB' : 'Monochrome' : '');
  const [qty, setQty] = useState(part.quantity);
  const [partName, setPartName] = useState(part.name);
  const [addVendorOpen, setAddVendorOpen] = useState(false);
  const [pan, setPan] = useState('');
  const [gst, setGst] = useState('');
  const [bank, setBank] = useState('');
  const [po, setPo] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [vendorCost, setVendorCost] = useState('');
  // Update Vendor type to include documents
  type Vendor = {
    name: string;
    price?: number;
    leadTime?: string;
    availability?: string;
    qty?: number;
    documents?: string[];
  };
  const [vendors, setVendors] = useState<Vendor[]>(part.vendors || []);
  const [partState, setPartState] = useState(part);

  useEffect(() => {
    setPartState(part);
    // Optionally reset other related state here if needed
  }, [part]);

  // Sync vendors state with selected part
  useEffect(() => {
    setVendors(part.vendors || []);
  }, [part]);

  // Update vendors and notify parent
  const updateVendors = (newVendors) => {
    setVendors(newVendors);
    if (typeof onUpdatePart === 'function' && partState) {
      onUpdatePart({ ...partState, vendors: newVendors });
    }
  };

  // Edit vendor state and handlers
  const [editVendorIdx, setEditVendorIdx] = useState<number | undefined>(undefined);
  const [editVendorName, setEditVendorName] = useState('');
  const [editPan, setEditPan] = useState('');
  const [editGst, setEditGst] = useState('');
  const [editBank, setEditBank] = useState('');
  const [editPo, setEditPo] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Expose finalized vendor to parent (BOMPartRow) if needed
  // You may want to use a callback or context to sync this state with the left tab
  const [finalizedVendorIdx, setFinalizedVendorIdx] = useState<number | null>(null);
  const [showDeletePartConfirm, setShowDeletePartConfirm] = useState(false);
  const [docDeleteMode, setDocDeleteMode] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  // Combine part-level and all vendor documents for the Documents section
  const documents: DocumentInfo[] = partState?.documents || [];
  const setDocuments = (docs: DocumentInfo[]) => {
    setPartState(prev => prev ? { ...prev, documents: docs } : prev);
    if (typeof onUpdatePart === 'function' && partState) {
      onUpdatePart({ ...partState, documents: docs });
    }
  };
  const { toast } = useToast();
  // Handle file upload for this part
  const handleUploadDocs = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      // Simulate upload and URL creation
      const newDocs: DocumentInfo[] = [
        ...documents,
        ...Array.from(e.target.files).map(f => ({
          name: f.name,
          url: URL.createObjectURL(f) // In real app, use storage URL
        }))
      ];
      setDocuments(newDocs);
      toast({ title: 'Upload Successful', description: `${e.target.files.length} document(s) uploaded.` });
    }
  };
  // Description edit dialog state
  const [editDescOpen, setEditDescOpen] = useState(false);
  const [descKVEdit, setDescKVEdit] = useState<Array<{ value: string; key: string }>>(partState?.descriptionKV ? [...partState.descriptionKV] : [{ value: '', key: '' }]);

  const handleSave = () => {
    if (!partState) return;
    const newDescription =
      `• Resolution: ${resolution}\n` +
      `• Type: ${type}\n` +
      `• Model Number: ${model}\n` +
      `• Make: ${make}`;
    const updated: BOMItem = {
      ...partState,
      name: partName,
      description: newDescription,
      quantity: qty,
    };
    setPartState(updated);
    if (typeof onUpdatePart === 'function') onUpdatePart(updated);
    setEditOpen(false);
  };

  // Add state for Add Vendor documents
  const [addVendorDocs, setAddVendorDocs] = useState<DocumentInfo[]>([]);

  const handleAddVendor = () => {
    if (!vendorName.trim()) return;
    const newVendors = [
      ...vendors,
      {
        name: vendorName,
        price: vendorCost ? Number(vendorCost) : undefined,
        qty: 1,
        documents: addVendorDocs,
      },
    ];
    updateVendors(newVendors);
    setVendorName('');
    setVendorCost('');
    setAddVendorDocs([]);
    setAddVendorOpen(false);
  };

  // In handleEditVendorOpen, also set a local state for vendor documents
  const [editVendorDocs, setEditVendorDocs] = useState<DocumentInfo[]>([]);
  const handleEditVendorOpen = (idx: number) => {
    setEditVendorIdx(idx);
    const v = vendors[idx];
    setEditVendorName(v.name || '');
    setEditPan('price' in v ? v.price : '');
    setEditVendorDocs(Array.isArray(v.documents) ? v.documents : []);
  };
  // Add state for confirming vendor doc deletion
  const [docToDelete, setDocToDelete] = useState<string | null>(null);
  const handleEditVendorSave = () => {
    if (editVendorIdx === undefined) return;
    // Find docs that were removed from this vendor
    const prevDocs = vendors[editVendorIdx]?.documents || [];
    const removedDocs = prevDocs.filter(doc => !editVendorDocs.some(d => d.name === doc.name));
    // For each removed doc, check if it exists in any other vendor or in partState.documents
    let updatedPartDocs = partState?.documents || [];
    removedDocs.forEach(doc => {
      const inOtherVendor = vendors.some((v, i) => i !== editVendorIdx && v.documents && v.documents.some(d => d.name === doc.name));
      if (!inOtherVendor && updatedPartDocs.some(d => d.name === doc.name)) {
        updatedPartDocs = updatedPartDocs.filter(d => d.name !== doc.name);
      }
    });
    // Save vendors and update part documents if changed
    updateVendors(vendors.map((v, i) => i === editVendorIdx ? { ...v, name: editVendorName, price: Number(editPan), documents: editVendorDocs.map(d => ({ name: d.name, url: d.url })) } : v));
    if (updatedPartDocs !== (partState?.documents || [])) {
      setPartState(prev => prev ? { ...prev, documents: updatedPartDocs } : prev);
      if (typeof onUpdatePart === 'function' && partState) {
        onUpdatePart({ ...partState, documents: updatedPartDocs });
      }
    }
    setEditVendorIdx(undefined);
  };

  const handleFinalizeVendor = (idx: number) => {
    setFinalizedVendorIdx(idx);
    if (partState && typeof onUpdatePart === 'function') {
      const finalizedVendor = vendors[idx];
      onUpdatePart({ ...partState, finalizedVendor, quantity: partState.quantity });
    }
  };

  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [sortType, setSortType] = useState('price-asc');
  // Add state to track which vendor's documents are open
  const [openVendorDocsIdx, setOpenVendorDocsIdx] = useState<number | null>(null);
  // Add state to track the selected vendor index
  const [selectedVendorIdx, setSelectedVendorIdx] = useState<number | null>(null);

  return (
    <Card className="h-fit">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">{partState?.name}</CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={getStatusColor(partState?.status || '')}>
                {partState?.status.replace('-', ' ').toUpperCase()}
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild>
                <button className="p-1 text-gray-500 hover:text-blue-600 align-middle" style={{verticalAlign: 'middle'}} aria-label="Edit part specs">
                  <Pencil size={18} />
                </button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Camera Specifications</DialogTitle>
                </DialogHeader>
                <form className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Part Name</label>
                    <input className="w-full border rounded p-2" value={partName} onChange={e => setPartName(e.target.value)} placeholder="e.g. Basler acA2040-90um" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Quantity</label>
                    <input type="number" min={1} className="w-full border rounded p-2" value={qty} onChange={e => setQty(Number(e.target.value))} />
                  </div>
                </form>
                <DialogFooter className="mt-4 flex gap-2">
                  <button type="button" className="px-4 py-2 bg-blue-600 text-white rounded" onClick={handleSave}>Save</button>
                  <button type="button" className="px-4 py-2 bg-gray-200 text-gray-700 rounded" onClick={() => setEditOpen(false)}>Cancel</button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <button className="p-1 text-gray-500 hover:text-red-600 align-middle" aria-label="Delete part" onClick={() => onDeletePart && partState && onDeletePart(partState.id)}>
              <Trash2 size={18} />
            </button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X size={16} />
          </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Quantity Info */}
        <div className="flex items-center justify-between mb-2 mt-1">
          <span className="text-gray-600 font-medium text-sm">Quantity:</span>
          <span className="font-medium text-base">{partState?.quantity}</span>
        </div>
        {/* Description */}
        <div>
          <div className="flex items-center mb-2">
            <h4 className="font-medium text-gray-900 mr-2">Description</h4>
            <button className="p-1 text-gray-500 hover:text-blue-600 align-middle" aria-label="Edit description" onClick={() => {
              setDescKVEdit(Array.isArray(partState?.descriptionKV) && partState.descriptionKV.length > 0 ? [...partState.descriptionKV] : [{ value: '', key: '' }]);
              setEditDescOpen(true);
            }}>
              <Pencil size={15} />
            </button>
          </div>
          {Array.isArray(partState?.descriptionKV) && partState.descriptionKV.length > 0 ? (
            <dl className="text-sm text-gray-700 space-y-1">
              {partState.descriptionKV.map((kv, idx) => (
                <div className="flex gap-2 items-center" key={idx}>
                  <dt className="w-24 font-bold text-left">{kv.key}</dt>
                  <dd className="flex-1 text-left font-normal">{kv.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="text-gray-400 italic text-sm">No description available.</div>
          )}
          {/* Edit Description Dialog */}
          <Dialog open={editDescOpen} onOpenChange={setEditDescOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Description</DialogTitle>
              </DialogHeader>
              <form className="space-y-3">
                {descKVEdit.map((kv, idx) => (
                  <div key={idx} className="flex gap-2 mb-1 items-center">
                    <input
                      className="border rounded p-2 w-1/2 font-normal"
                      placeholder="Key"
                      value={kv.key}
                      onChange={e => setDescKVEdit(descKVEdit.map((item, i) => i === idx ? { ...item, key: e.target.value } : item))}
                    />
                    <input
                      className="border rounded p-2 w-1/2 font-normal"
                      placeholder="Value"
                      value={kv.value}
                      onChange={e => setDescKVEdit(descKVEdit.map((item, i) => i === idx ? { ...item, value: e.target.value } : item))}
                    />
                    <button
                      className="text-red-500 px-2"
                      onClick={e => {
                        e.preventDefault();
                        setDescKVEdit(descKVEdit.length > 1 ? descKVEdit.filter((_, i) => i !== idx) : descKVEdit);
                      }}
                      disabled={descKVEdit.length === 1}
                    >
                      ×
                    </button>
                  </div>
                ))}
                <button
                  className="text-blue-600 text-xs mt-1"
                  onClick={e => {
                    e.preventDefault();
                    setDescKVEdit([...descKVEdit, { value: '', key: '' }]);
                  }}
                >
                  + Add Row
                </button>
              </form>
              <DialogFooter className="mt-4 flex gap-2">
                <button
                  type="button"
                  className="px-4 py-2 bg-blue-600 text-white rounded"
                  onClick={() => {
                    // Save changes to partState and notify parent
                    setPartState(prev => prev ? { ...prev, descriptionKV: descKVEdit } : prev);
                    if (typeof onUpdatePart === 'function' && partState) {
                      onUpdatePart({ ...partState, descriptionKV: descKVEdit });
                    }
                    setEditDescOpen(false);
                  }}
                >Save</button>
                <button
                  type="button"
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded"
                  onClick={() => setEditDescOpen(false)}
                >Cancel</button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        
        {/* Documents Dropdown with Delete Option */}
        <div className="relative mb-3">
          <Collapsible>
            <CollapsibleTrigger asChild>
              <div className="flex w-full items-center justify-between font-medium text-gray-900 px-0 py-2 bg-transparent border-none cursor-pointer">
                <span>Documents</span>
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer">
                    <input type="file" multiple className="hidden" onChange={handleUploadDocs} />
                    <span className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium" title="Add file">
                      Add file
                    </span>
                  </label>
                  <button
                    className={`p-1 rounded-full ${docDeleteMode ? 'bg-red-100 text-red-600' : ''}`}
                    style={{ minWidth: 32, minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    title={docDeleteMode ? 'Cancel' : 'Delete'}
                    onClick={e => {
                      e.stopPropagation();
                      setDocDeleteMode(mode => !mode);
                      setSelectedDocs([]);
                    }}
                  >
                    <Trash2 size={18} />
                  </button>
                  <span className="transition-transform duration-200" style={{ transform: 'rotate(var(--collapsible-arrow, 0deg))' }}>
                    <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </span>
                </div>
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-2">
                {documents.length === 0 && (
                  <div className="text-gray-400 text-sm italic flex items-center gap-2 p-2"><FileText size={16} />No documents uploaded yet.</div>
                )}
                {documents.map(doc => (
                  <div key={doc.url} className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1 border border-gray-200">
                    {docDeleteMode && (
                      <input
                        type="checkbox"
                        checked={selectedDocs.includes(doc.name)}
                        onChange={e => setSelectedDocs(prev =>
                          e.target.checked
                            ? [...prev, doc.name]
                            : prev.filter(d => d !== doc.name)
                        )}
                      />
                    )}
                    <FileText size={16} className="text-blue-600 mr-1" />
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 text-left text-blue-700 text-sm truncate hover:underline"
                      title={doc.name}
                    >
                      {doc.name}
                    </a>
                  </div>
                ))}
                {docDeleteMode && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="mt-2"
                    disabled={selectedDocs.length === 0}
                    onClick={() => {
                      setDocuments(documents.filter(doc => !selectedDocs.includes(doc.name)));
                      setSelectedDocs([]);
                      setDocDeleteMode(false);
                    }}
                  >
                    Delete Selected
                  </Button>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
        <Separator />
        
        {/* Vendor Section with Add Vendor Popup */}
        <div>
          <div className="flex items-center mb-3 justify-between">
            <div className="flex items-center">
              <h4 className="font-medium text-gray-900 mr-2">Vendor Comparison</h4>
            <button className="p-1 text-gray-500 hover:text-blue-600 align-middle" style={{verticalAlign: 'middle'}} aria-label="Add vendor" onClick={() => setAddVendorOpen(true)}>
              <Plus size={16} />
            </button>
            </div>
            <div className="relative">
              <button className="p-1 text-gray-500 hover:text-blue-600 align-middle" aria-label="Sort vendors" onClick={() => setShowSortDropdown(s => !s)}>
                <svg width="20" height="20" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeWidth="2" d="M3 6h18M7 12h10M11 18h6"/></svg>
              </button>
              {showSortDropdown && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded shadow z-10">
                  <button className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100" onClick={() => { setSortType('price-asc'); setShowSortDropdown(false); }}>Price: Low to High</button>
                  <button className="block w-full text-left px-4 py-2 text-sm hover:bg-gray-100" onClick={() => { setSortType('price-desc'); setShowSortDropdown(false); }}>Price: High to Low</button>
              </div>
            )}
          </div>
        </div>
          <div className="space-y-3">
            {/* Before rendering vendors, sort them based on sortType */}
            {vendors.sort((a, b) => {
              const priceA = typeof a.price === 'number' ? a.price : Number(a.price) || 0;
              const priceB = typeof b.price === 'number' ? b.price : Number(b.price) || 0;
              if (sortType === 'price-asc') return priceA - priceB;
              if (sortType === 'price-desc') return priceB - priceA;
              return 0;
            }).map((vendor, index) => {
              // Ensure correct types and defaults
              const price = 'price' in vendor ? vendor.price : '';
              const availability = 'availability' in vendor ? vendor.availability : 'In Stock';
              const qty = 'qty' in vendor ? vendor.qty : 1;
              return (
                <div
                  key={index}
                  className={`border border-gray-200 rounded-lg p-3 flex flex-col gap-2 relative cursor-pointer ${selectedVendorIdx === index ? 'bg-blue-50 border-blue-300' : ''}`}
                  onClick={() => setSelectedVendorIdx(index)}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-base">{vendor.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">{availability}</span>
                  </div>
                  <div className="flex items-center gap-6 text-gray-700 mb-2">
                    <span className="flex items-center gap-1 text-sm"><span className="text-base">₹</span>{price}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="ml-auto flex items-center gap-2">
                      <button className="text-gray-500 hover:bg-gray-100 rounded-full p-2" onClick={() => handleEditVendorOpen(index)}>
                        <Pencil size={18} />
                      </button>
                      <button className="text-red-500 hover:bg-red-100 rounded-full p-2" onClick={() => updateVendors(vendors.filter((_, i) => i !== index))}>
                        <Trash2 size={18} />
                      </button>
                      <button className="text-blue-600 hover:underline text-xs ml-2" onClick={() => setOpenVendorDocsIdx(openVendorDocsIdx === index ? null : index)}>
                        {openVendorDocsIdx === index ? 'Hide Documents' : 'View Documents'}
                      </button>
                    </div>
                  </div>
                  {/* Vendor Documents Dropdown */}
                  {openVendorDocsIdx === index && (
                    <div className="mt-2 border rounded bg-gray-50 p-2">
                      <div className="text-xs font-semibold mb-1 text-gray-700">Vendor Documents:</div>
                      {Array.isArray(vendor.documents) && vendor.documents.length > 0 ? (
                        <ul className="max-h-24 overflow-y-auto text-xs">
                          {vendor.documents.map((doc, idx) => (
                            <li key={idx} className="flex items-center gap-2 text-gray-800">
                              <FileText size={14} className="text-blue-600" />
                              <a
                                href={doc.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 hover:underline"
                              >
                                {doc.name}
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="text-xs text-gray-400 italic">No documents uploaded yet.</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {selectedVendorIdx !== null && vendors[selectedVendorIdx] && (
              <div className="flex justify-end mt-4">
                <Button
                  className="bg-blue-600 text-white px-6 py-2 rounded"
                  onClick={() => {
                    if (typeof onUpdatePart === 'function' && partState) {
                      onUpdatePart({ ...partState, finalizedVendor: vendors[selectedVendorIdx] });
                    }
                  }}
                >
                  Proceed
                </Button>
              </div>
            )}
            {/* Edit Vendor Dialog */}
            <Dialog open={editVendorIdx !== undefined} onOpenChange={v => { if (!v) setEditVendorIdx(undefined); }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Edit Vendor</DialogTitle>
                </DialogHeader>
                <form className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Company Name</label>
                    <input className="w-full border rounded p-2" value={editVendorName} onChange={e => setEditVendorName(e.target.value)} placeholder="Enter company name" required />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Price per unit</label>
                    <input className="w-full border rounded p-2" type="number" min="0" value={editPan} onChange={e => setEditPan(e.target.value)} placeholder="Enter price per unit" />
                  </div>
                </form>
                <div className="mt-3 text-left">
                  <div className="text-xs font-semibold mb-1 text-gray-700">Vendor Documents:</div>
                  {editVendorDocs.length > 0 ? (
                    <ul className="border rounded p-2 bg-gray-50 max-h-24 overflow-y-auto text-xs">
                      {editVendorDocs.map((doc, idx) => (
                        <li key={idx} className="flex items-center gap-2 text-gray-800">
                          <FileText size={14} className="text-blue-600" />{doc.name}
                          <button
                            className="ml-auto text-red-500 hover:text-red-700 text-xs px-2"
                            title="Delete document"
                            onClick={e => { e.preventDefault(); setDocToDelete(doc.name); }}
                          >×</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-gray-400 italic">No documents uploaded yet.</div>
                  )}
                  <label className="cursor-pointer mt-2 inline-block">
                    <input type="file" multiple className="hidden" onChange={e => {
                      if (e.target.files) {
                        setEditVendorDocs(prev => [
                          ...prev,
                          ...Array.from(e.target.files).map(f => ({
                            name: f.name,
                            url: URL.createObjectURL(f)
                          }))
                        ]);
                      }
                    }} />
                    <span className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">Add Documents</span>
                  </label>
                </div>
                <DialogFooter className="mt-4 flex gap-2">
                  <button type="button" className="px-4 py-2 bg-blue-600 text-white rounded" onClick={handleEditVendorSave} disabled={!editVendorName.trim()}>Save</button>
                  <button type="button" className="px-4 py-2 bg-red-600 text-white rounded" onClick={() => setShowDeleteConfirm(true)}>Delete Vendor</button>
                  <button type="button" className="px-4 py-2 bg-gray-200 text-gray-700 rounded" onClick={() => setEditVendorIdx(undefined)}>Cancel</button>
                </DialogFooter>
                {/* Delete confirmation dialog */}
                {showDeleteConfirm && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
                    <div className="bg-white rounded shadow-lg p-6 min-w-[250px] text-center">
                      <div className="mb-4 text-gray-800">Are you sure you want to delete this vendor?</div>
                      <div className="flex justify-center gap-4">
                        <button className="px-4 py-1 bg-red-600 text-white rounded" onClick={() => {
                          if (editVendorIdx !== undefined) updateVendors(vendors.filter((_, i) => i !== editVendorIdx));
                          setEditVendorIdx(undefined);
                          setShowDeleteConfirm(false);
                        }}>Yes</button>
                        <button className="px-4 py-1 bg-gray-200 text-gray-700 rounded" onClick={() => setShowDeleteConfirm(false)}>No</button>
                      </div>
                    </div>
                  </div>
                )}
                {/* Confirmation dialog for deleting vendor doc */}
                {docToDelete && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-30">
                    <div className="bg-white rounded shadow-lg p-6 min-w-[250px] text-center">
                      <div className="mb-4 text-gray-800">Are you sure you want to delete this document from this vendor?</div>
                      <div className="flex justify-center gap-4">
                        <button className="px-4 py-1 bg-red-600 text-white rounded" onClick={() => {
                          setEditVendorDocs(editVendorDocs.filter(d => d.name !== docToDelete));
                          setDocToDelete(null);
                        }}>Yes</button>
                        <button className="px-4 py-1 bg-gray-200 text-gray-700 rounded" onClick={() => setDocToDelete(null)}>No</button>
                      </div>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
          {/* Add Vendor Popup */}
          <Dialog open={addVendorOpen} onOpenChange={v => {
            setAddVendorOpen(v);
            if (!v) setAddVendorDocs([]);
          }}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Vendor</DialogTitle>
              </DialogHeader>
              <form className="space-y-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Company Name</label>
                  <input className="w-full border rounded p-2" value={vendorName} onChange={e => setVendorName(e.target.value)} placeholder="Enter company name" required />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Price per unit</label>
                  <input className="w-full border rounded p-2" type="number" min="0" value={vendorCost} onChange={e => setVendorCost(e.target.value)} placeholder="Enter price per unit" />
                </div>
              </form>
              <DialogFooter className="mt-4 flex gap-2 items-center">
                <button type="button" className="px-4 py-2 bg-blue-600 text-white rounded" onClick={handleAddVendor} disabled={!vendorName.trim()}>Save</button>
                {/* Add Documents Button */}
                <label className="cursor-pointer">
                  <input type="file" multiple className="hidden" onChange={e => {
                    if (e.target.files) {
                      setAddVendorDocs(prev => [
                        ...prev,
                        ...Array.from(e.target.files).map(f => ({
                          name: f.name,
                          url: URL.createObjectURL(f)
                        }))
                      ]);
                    }
                  }} />
                  <span className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">Add Documents</span>
                </label>
                <button type="button" className="px-4 py-2 bg-gray-200 text-gray-700 rounded" onClick={() => { setAddVendorOpen(false); setAddVendorDocs([]); }}>Cancel</button>
              </DialogFooter>
              {/* Show uploaded documents in Add Vendor dialog */}
              {addVendorDocs.length > 0 ? (
                <div className="mt-3 text-left">
                  <div className="text-xs font-semibold mb-1 text-gray-700">Uploaded Documents:</div>
                  <ul className="border rounded p-2 bg-gray-50 max-h-24 overflow-y-auto text-xs">
                    {addVendorDocs.map((doc, idx) => (
                      <li key={idx} className="flex items-center gap-2 text-gray-800"><FileText size={14} className="text-blue-600" />{doc.name}</li>
                    ))}
                  </ul>
          </div>
              ) : (
                <div className="mt-3 text-xs text-gray-400 italic text-left">No documents uploaded yet.</div>
              )}
            </DialogContent>
          </Dialog>
        </div>
        
        {/* Action Buttons */}
        {/* <div className="space-y-2 pt-4">
          <Button className="w-full">
            Create Purchase Order
          </Button>
          <Button variant="outline" className="w-full">
            Edit Part Details
          </Button>
        </div> */}
      </CardContent>
    </Card>
  );
};

export default BOMPartDetails;

