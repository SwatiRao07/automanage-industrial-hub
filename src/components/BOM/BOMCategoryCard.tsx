
import { ChevronDown, ChevronRight, Package, Trash2, Pencil } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import BOMPartRow from './BOMPartRow';
import { useState } from 'react';

interface BOMItem {
  id: string;
  name: string;
  partId: string;
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
}

interface BOMCategory {
  name: string;
  items: BOMItem[];
  isExpanded: boolean;
}

interface BOMCategoryCardProps {
  category: BOMCategory;
  onToggle: () => void;
  onPartClick: (part: BOMItem) => void;
  onQuantityChange?: (partId: string, newQuantity: number) => void;
  onDeletePart?: (partId: string) => void;
  onDeleteCategory?: (categoryName: string) => void;
  onEditCategory?: (oldName: string, newName: string) => void;
  onStatusChange?: (partId: string, newStatus: string) => void;
}

const BOMCategoryCard = ({ category, onToggle, onPartClick, onQuantityChange, onDeleteCategory, onEditCategory, onStatusChange }: BOMCategoryCardProps) => {
  const [showConfirm, setShowConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(category.name);

  const getStatusCount = (status: string) => {
    return category.items.filter(item => item.status === status).length;
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowConfirm(true);
  };

  const handleConfirmDelete = () => {
    setShowConfirm(false);
    onDeleteCategory?.(category.name);
  };

  const handleCancelDelete = () => {
    setShowConfirm(false);
  };

  return (
    <Card className="relative">
      <Collapsible open={category.isExpanded} onOpenChange={onToggle}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-gray-50 transition-colors relative">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {category.isExpanded ? (
                  <ChevronDown className="text-gray-500" size={20} />
                ) : (
                  <ChevronRight className="text-gray-500" size={20} />
                )}
                <Package className="text-blue-500" size={20} />
                <div>
                  <div className="flex items-center gap-1">
                    {editing ? (
                      <input
                        className="text-lg font-semibold text-gray-900 border-b border-blue-400 bg-transparent outline-none px-1 w-40"
                        value={editName}
                        autoFocus
                        onChange={e => setEditName(e.target.value)}
                        onBlur={() => {
                          setEditing(false);
                          if (editName.trim() && editName !== category.name && onEditCategory) {
                            onEditCategory(category.name, editName.trim());
                          } else {
                            setEditName(category.name);
                          }
                        }}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            setEditing(false);
                            if (editName.trim() && editName !== category.name && onEditCategory) {
                              onEditCategory(category.name, editName.trim());
                            } else {
                              setEditName(category.name);
                            }
                          } else if (e.key === 'Escape') {
                            setEditing(false);
                            setEditName(category.name);
                          }
                        }}
                      />
                    ) : (
                      <>
                        <h3 className="text-lg font-semibold text-gray-900">{category.name}</h3>
                        <button className="ml-1 p-1 text-gray-500 hover:text-blue-600 align-middle" aria-label="Edit category name" onClick={e => { e.stopPropagation(); setEditing(true); }}>
                          <Pencil size={16} />
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{category.items.length} parts</p>
                </div>
              </div>
              <div className="flex gap-2 items-center">
                <Badge variant="outline" className="text-blue-600 border-blue-200">
                  {getStatusCount('approved')} Approved
                </Badge>
                <Badge variant="outline" className="text-green-600 border-green-200">
                  {getStatusCount('received')} received
                </Badge>
                <Badge variant="outline" className="text-amber-600 border-amber-200">
                  {getStatusCount('ordered')} ordered
                </Badge>
                <Badge variant="outline" className="text-red-600 border-red-200">
                  {getStatusCount('not-ordered')} Not Ordered
                </Badge>
                {/* Trash icon button */}
                <button
                  onClick={handleDeleteClick}
                  className="ml-2 p-1 bg-transparent border-none outline-none text-red-500 hover:bg-red-50 rounded-full"
                  style={{ appearance: 'none', boxShadow: 'none' }}
                  aria-label="Delete category"
                  tabIndex={-1}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
            {/* Confirmation popup */}
            {showConfirm && (
              <div className="absolute right-2 top-10 z-50 mt-2 bg-white border border-gray-300 rounded shadow p-2 text-xs flex flex-col items-center min-w-[150px]">
                <div className="mb-2">Do you want to delete this category?</div>
                <div className="flex gap-2">
                  <button onClick={handleConfirmDelete} className="px-2 py-0.5 bg-red-500 text-white rounded text-xs">Yes</button>
                  <button onClick={handleCancelDelete} className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-xs">No</button>
                </div>
              </div>
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {category.items.map((item) => (
                <BOMPartRow
                  key={item.id}
                  part={item}
                  onClick={() => onPartClick(item)}
                  onQuantityChange={onQuantityChange}
                  onDelete={onDeleteCategory}
                  onStatusChange={onStatusChange}
                />
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export default BOMCategoryCard;
