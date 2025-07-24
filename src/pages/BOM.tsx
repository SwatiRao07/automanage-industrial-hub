
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, Plus, Download, Filter, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import BOMHeader from '@/components/BOM/BOMHeader';
import BOMCategoryCard from '@/components/BOM/BOMCategoryCard';
import BOMPartDetails from '@/components/BOM/BOMPartDetails';
import Sidebar from '@/components/Sidebar';
import { saveAs } from 'file-saver';
import { 
  getBOMData, 
  subscribeToBOM, 
  updateBOMData, 
  updateBOMItem, 
  deleteBOMItem,
} from '@/utils/projectFirestore';
import { BOMItem, BOMCategory, BOMStatus } from '@/types/bom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogAction
} from '@/components/ui/alert-dialog';

const BOM = () => {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPart, setSelectedPart] = useState<BOMItem | null>(null);
  const [categories, setCategories] = useState<BOMCategory[]>([]);
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project');
  const [projectDetails, setProjectDetails] = useState<{ projectName: string; projectId: string; clientName: string } | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [newPart, setNewPart] = useState({ 
    name: '', 
    partId: '', 
    quantity: 1, 
    descriptionKV: [{ key: '', value: '' }] 
  });
  const [categoryForPart, setCategoryForPart] = useState<string | null>(null);
  const [addingNewCategory, setAddingNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [addPartError, setAddPartError] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);

  // Load BOM data when project ID changes
  useEffect(() => {
    if (!projectId) return;

    // Initial load
    const loadBOMData = async () => {
      const data = await getBOMData(projectId);
      setCategories(data);
    };
    loadBOMData();

    // Subscribe to real-time updates
    const unsubscribe = subscribeToBOM(projectId, (updatedCategories) => {
      setCategories(updatedCategories);
    });

    return () => unsubscribe();
  }, [projectId]);

  // Load project details
  useEffect(() => {
    const loadProjectDetails = async () => {
      if (!projectId) return;
      
      try {
        const projectRef = doc(db, 'projects', projectId);
        const projectSnap = await getDoc(projectRef);
        
        if (projectSnap.exists()) {
          const projectData = projectSnap.data() as { projectName: string; projectId: string; clientName: string };
          setProjectDetails({
            projectName: projectData.projectName,
            projectId: projectData.projectId,
            clientName: projectData.clientName,
          });
        } else {
          console.error('Project not found');
        }
      } catch (error) {
        console.error('Error loading project details:', error);
      }
    };

    loadProjectDetails();
  }, [projectId]);

  const toggleCategory = async (categoryName: string) => {
    if (!projectId) return;
    
    const updatedCategories = categories.map(cat => 
      cat.name === categoryName 
        ? { ...cat, isExpanded: !cat.isExpanded }
        : cat
    );
    await updateBOMData(projectId, updatedCategories);
  };

  const handleQuantityChange = async (partId: string, newQuantity: number) => {
    if (!projectId) return;
    await updateBOMItem(projectId, categories, partId, { quantity: newQuantity });
  };

  const handlePartClick = (part: BOMItem) => {
    setSelectedPart(part);
  };

  const handleAddPart = async () => {
    if (!projectId) return;

    // Check for duplicate Part ID
    const allPartIds = categories.flatMap(cat => cat.items.map(item => item.partId.toLowerCase()));
    if (allPartIds.includes(newPart.partId.trim().toLowerCase())) {
      setAddPartError('Part ID must be unique. This Part ID already exists.');
      return;
    }

    setAddPartError(null);
    if (!categoryForPart && !addingNewCategory) return;

    let finalCategory = categoryForPart;
    let updatedCategories = categories;

    if (addingNewCategory && newCategoryName.trim()) {
      finalCategory = newCategoryName.trim();
      if (!categories.some(cat => cat.name === finalCategory)) {
        updatedCategories = [...categories, { name: finalCategory, isExpanded: true, items: [] }];
      }
    }

    const newCategories = updatedCategories.map(cat =>
      cat.name === finalCategory
        ? {
            ...cat,
            items: [...cat.items, {
              id: Date.now().toString(),
              name: newPart.name,
              partId: newPart.partId,
              description: newPart.descriptionKV.map(kv => `${kv.key}: ${kv.value}`).join('\n'),
              category: finalCategory || '',
              quantity: newPart.quantity,
              vendors: [],
              status: 'not-ordered' as BOMStatus,
            } as BOMItem]
          }
        : cat
    );

    await updateBOMData(projectId, newCategories);
    
    // Reset form
    setNewPart({ name: '', partId: '', quantity: 1, descriptionKV: [{ key: '', value: '' }] });
    setAddPartOpen(false);
    setCategoryForPart(null);
    setAddingNewCategory(false);
    setNewCategoryName('');
  };

  const handleEditCategory = async (oldName: string, newName: string) => {
    if (!projectId) return;

    const updatedCategories = categories.map(cat => {
      if (cat.name === oldName) {
        return {
          ...cat,
          name: newName,
          items: cat.items.map(item => ({ ...item, category: newName }))
        };
      }
      return cat;
    });

    await updateBOMData(projectId, updatedCategories);
  };

  const handleDeletePart = async (partId: string) => {
    if (!projectId) return;
    await deleteBOMItem(projectId, categories, partId);
    if (selectedPart?.id === partId) {
      setSelectedPart(null);
    }
  };

  const handleUpdatePart = async (updatedPart: BOMItem) => {
    if (!projectId) return;
    await updateBOMItem(projectId, categories, updatedPart.id, updatedPart);
  };

  const handleCreatePurchaseOrder = async () => {
    setEmailStatus(null);
    try {
      const response = await fetch('http://localhost:5001/send-purchase-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'swathi.rao@btech.christuniversity.in' }), // Updated recipient
      });
      const data = await response.json();
      if (data.success) {
        setEmailStatus('Email sent successfully!');
      } else {
        setEmailStatus('Failed to send email: ' + data.error);
      }
    } catch (err: any) {
      setEmailStatus('Error: ' + err.message);
    }
  };

  // Filtered categories based on search and filter selections
  const filteredCategories = categories
    .map(category => ({
      ...category,
      items: category.items.filter(item => {
        const matchesSearch =
          item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.partId.toLowerCase().includes(searchTerm.toLowerCase()) ||
          item.description.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus =
          selectedStatuses.length === 0 || selectedStatuses.includes(item.status as string);
        const matchesCategory =
          selectedCategories.length === 0 || selectedCategories.includes(category.name);
        return matchesSearch && matchesStatus && matchesCategory;
      })
    }))
    .filter(category => category.items.length > 0);

  // CSV Export Handler
  const handleExportCSV = () => {
    const headers = [
      'Project ID',
      'Project Name',
      'Client Name',
      'Part ID',
      'Part Name',
      'Category',
      'Quantity',
      'Status',
      'Expected Delivery',
      'Selected Vendor',
      'Vendor Price (₹)'
    ];

    const rows = categories.flatMap(category =>
      category.items.map(item => [
        projectDetails?.projectId || '',
        projectDetails?.projectName || '',
        projectDetails?.clientName || '',
        item.partId,
        item.name,
        category.name,
        item.quantity,
        item.status === 'not-ordered' ? 'Pending' : item.status.charAt(0).toUpperCase() + item.status.slice(1),
        item.expectedDelivery || '',
        item.finalizedVendor?.name || '',
        item.finalizedVendor?.price !== undefined ? item.finalizedVendor.price : ''
      ])
    );

    const csvContent = [headers, ...rows]
      .map(row => row.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, 'bom_export.csv');
  };

  // Calculate BOM statistics
  const calculateBOMStats = () => {
    const allParts = categories.flatMap(cat => cat.items);
    const totalParts = allParts.length;
    const receivedParts = allParts.filter(part => part.status === 'received').length;
    const orderedParts = allParts.filter(part => part.status === 'ordered').length;
    const approvedParts = allParts.filter(part => part.status === 'approved').length;
    const notOrderedParts = allParts.filter(part => part.status === 'not-ordered').length;

    return {
      totalParts,
      receivedParts,
      orderedParts,
      notOrderedParts,
      approvedParts
    };
  };

  return (
    <div className="min-h-screen bg-background flex">
      <Sidebar 
        collapsed={sidebarCollapsed} 
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} 
      />
      
      <div className={`flex-1 ${sidebarCollapsed ? 'ml-16' : 'ml-64'}`}>
        <main className="p-6">
          <div className="max-w-7xl mx-auto">
            {/* BOM Header */}
            <BOMHeader
              projectName={projectDetails?.projectName || ''}
              projectId={projectDetails?.projectId || ''}
              clientName={projectDetails?.clientName || ''}
              stats={calculateBOMStats()}
            />

            {/* Search and Actions Bar */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1 flex items-center gap-2">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" size={20} />
                  <Input
                    type="text"
                    placeholder="Search parts by name, ID, or description..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Button variant="outline" onClick={() => setAddPartOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Part
                </Button>
              </div>
              
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setFilterOpen(true)}>
                  <Filter className="mr-2 h-4 w-4" />
                  Filter
                </Button>
                <Button variant="outline" onClick={handleExportCSV}>
                  <Download className="mr-2 h-4 w-4" />
                  Export
                </Button>
                <Button variant="outline" onClick={handleCreatePurchaseOrder}>
                  Create Purchase Order
                </Button>
              </div>
            </div>
            {emailStatus && <div className="mt-2 text-sm">{emailStatus}</div>}

            {/* BOM Content */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Categories List */}
              <div className="lg:col-span-2 space-y-4">
                {filteredCategories.map((category) => (
                  <BOMCategoryCard
                    key={category.name}
                    category={category}
                    onToggle={() => toggleCategory(category.name)}
                    onPartClick={handlePartClick}
                    onQuantityChange={handleQuantityChange}
                    onDeletePart={handleDeletePart}
                    onEditCategory={handleEditCategory}
                    onStatusChange={(partId, newStatus) => {
                      if (projectId) {
                        updateBOMItem(projectId, categories, partId, { status: newStatus as BOMStatus });
                      }
                    }}
                  />
                ))}
                
                {filteredCategories.length === 0 && (
                  <Card>
                    <CardContent className="p-8 text-center">
                      <p className="text-muted-foreground">No parts found matching your search criteria.</p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Part Details */}
              <div className="lg:col-span-1">
                <BOMPartDetails
                  part={selectedPart}
                  onClose={() => setSelectedPart(null)}
                  onUpdatePart={handleUpdatePart}
                  onDeletePart={handleDeletePart}
                />
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Filter Dialog */}
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent className="max-w-[350px]">
          <DialogHeader>
            <DialogTitle>Filter Parts</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <div className="font-semibold text-sm mb-2">Status</div>
              {['ordered', 'received', 'not-ordered', 'approved'].map(status => (
                <label key={status} className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={selectedStatuses.includes(status)}
                    onChange={e => {
                      setSelectedStatuses(prev =>
                        e.target.checked
                          ? [...prev, status]
                          : prev.filter(s => s !== status)
                      );
                    }}
                  />
                  {status === 'not-ordered' ? 'Not Ordered' : status.charAt(0).toUpperCase() + status.slice(1)}
                </label>
              ))}
            </div>
            <div>
              <div className="font-semibold text-sm mb-2">Category</div>
              {categories.map(cat => (
                <label key={cat.name} className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={selectedCategories.includes(cat.name)}
                    onChange={e => {
                      setSelectedCategories(prev =>
                        e.target.checked
                          ? [...prev, cat.name]
                          : prev.filter(c => c !== cat.name)
                      );
                    }}
                  />
                  {cat.name}
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setFilterOpen(false)}>Apply</Button>
              <Button variant="outline" onClick={() => { setSelectedStatuses([]); setSelectedCategories([]); setFilterOpen(false); }}>
                Clear
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Part Dialog */}
      <Dialog open={addPartOpen} onOpenChange={setAddPartOpen}>
        <DialogContent className="max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Add Part</DialogTitle>
          </DialogHeader>
          {addPartError && (
            <Alert variant="destructive">
              <AlertDescription>{addPartError}</AlertDescription>
            </Alert>
          )}
          <div className="space-y-4">
            <div>
              <Label>Category</Label>
              <select 
                className="w-full border rounded p-2"
                value={addingNewCategory ? '+new' : (categoryForPart ?? '')}
                onChange={e => {
                  if (e.target.value === '+new') {
                    setAddingNewCategory(true);
                    setCategoryForPart(null);
                  } else {
                    setAddingNewCategory(false);
                    setCategoryForPart(e.target.value);
                  }
                }}
              >
                <option value="">Select Category</option>
                {categories.map(cat => (
                  <option key={cat.name} value={cat.name}>{cat.name}</option>
                ))}
                <option value="+new">+ Add New Category</option>
              </select>
            </div>

            {addingNewCategory && (
              <div>
                <Label>New Category Name</Label>
                <Input
                  value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)}
                  placeholder="Enter new category name"
                />
              </div>
            )}

            <div>
              <Label htmlFor="partName">Part Name</Label>
              <Input
                id="partName"
                value={newPart.name}
                onChange={e => setNewPart({ ...newPart, name: e.target.value })}
                placeholder="Enter part name"
              />
            </div>

            <div>
              <Label htmlFor="partId">Part ID</Label>
              <Input
                id="partId"
                value={newPart.partId}
                onChange={e => setNewPart({ ...newPart, partId: e.target.value })}
                placeholder="Enter part ID"
              />
            </div>

            <div>
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                min={1}
                value={newPart.quantity}
                onChange={e => setNewPart({ ...newPart, quantity: Number(e.target.value) })}
              />
            </div>

            <div>
              <Label htmlFor="description">Description (Key: Value)</Label>
              <div className="space-y-2">
                {newPart.descriptionKV.map((kv, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      type="text"
                      placeholder="Key"
                      value={kv.key}
                      onChange={e => {
                        const newDescriptionKV = [...newPart.descriptionKV];
                        newDescriptionKV[index] = { ...kv, key: e.target.value };
                        setNewPart({ ...newPart, descriptionKV: newDescriptionKV });
                      }}
                    />
                    <Input
                      type="text"
                      placeholder="Value"
                      value={kv.value}
                      onChange={e => {
                        const newDescriptionKV = [...newPart.descriptionKV];
                        newDescriptionKV[index] = { ...kv, value: e.target.value };
                        setNewPart({ ...newPart, descriptionKV: newDescriptionKV });
                      }}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const newDescriptionKV = [...newPart.descriptionKV];
                        newDescriptionKV.splice(index, 1);
                        setNewPart({ ...newPart, descriptionKV: newDescriptionKV });
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setNewPart(prev => ({ ...prev, descriptionKV: [...prev.descriptionKV, { key: '', value: '' }] }))}
                >
                  Add Row
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button onClick={handleAddPart} disabled={!newPart.name.trim() || !newPart.partId.trim()}>
                Add
              </Button>
              <Button variant="outline" onClick={() => setAddPartOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={emailStatus === 'Email sent successfully!'} onOpenChange={(open) => { if (!open) setEmailStatus(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Email sent successfully!</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setEmailStatus(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// Update the status mapping function to be more specific
function mapStatusToFirestore(status: string): BOMStatus {
  switch (status.toLowerCase()) {
    case 'ordered':
      return 'ordered';
    case 'received':
      return 'received';
    case 'approved':
      return 'approved';
    default:
      return 'not-ordered';
  }
}

export default BOM;
