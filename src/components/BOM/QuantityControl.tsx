import { Minus, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface QuantityControlProps {
  initialQuantity?: number;
  minQuantity?: number;
  maxQuantity?: number;
  onQuantityChange?: (quantity: number) => void;
  onDelete?: () => void;
  className?: string;
}

const QuantityControl = ({ 
  initialQuantity = 1, 
  minQuantity = 1, 
  maxQuantity = 999,
  onQuantityChange,
  onDelete,
  className = ""
}: QuantityControlProps) => {
  const [quantity, setQuantity] = useState(initialQuantity);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleIncrement = () => {
    if (quantity < maxQuantity) {
      const newQuantity = quantity + 1;
      setQuantity(newQuantity);
      onQuantityChange?.(newQuantity);
    }
  };

  const handleDecrement = () => {
    if (quantity > minQuantity) {
      const newQuantity = quantity - 1;
      setQuantity(newQuantity);
      onQuantityChange?.(newQuantity);
    }
  };

  const handleDelete = () => {
    setShowConfirm(true);
  };

  const handleConfirmDelete = () => {
    setShowConfirm(false);
    onDelete?.();
  };

  const handleCancelDelete = () => {
    setShowConfirm(false);
  };

  return (
    <div
      className={`relative flex items-center justify-center border-2 border-yellow-400 rounded-full bg-white px-1 py-0.5 ${className}`}
      style={{ minWidth: '45px', minHeight: '18px' }}
    >
      {quantity > 1 ? (
        <button
          onClick={handleDecrement}
          disabled={quantity <= minQuantity}
          className="flex items-center justify-center p-0 m-0 bg-transparent border-none outline-none disabled:opacity-50"
          style={{ appearance: 'none', boxShadow: 'none', width: 16, height: 16 }}
          aria-label="Decrease quantity"
        >
          <Minus size={12} strokeWidth={2} />
        </button>
      ) : (
        <button
          onClick={handleDelete}
          className="flex items-center justify-center p-0 m-0 bg-transparent border-none outline-none text-red-500"
          style={{ appearance: 'none', boxShadow: 'none', width: 16, height: 16 }}
          aria-label="Delete item"
        >
          <Trash2 size={12} strokeWidth={2} />
        </button>
      )}
      <span className="mx-1 font-bold text-xs select-none" style={{minWidth: 10, textAlign: 'center'}}>{quantity}</span>
      <button
        onClick={handleIncrement}
        disabled={quantity >= maxQuantity}
        className="flex items-center justify-center p-0 m-0 bg-transparent border-none outline-none disabled:opacity-50"
        style={{ appearance: 'none', boxShadow: 'none', width: 16, height: 16 }}
        aria-label="Increase quantity"
      >
        <Plus size={12} strokeWidth={2} />
      </button>
      {showConfirm && (
        <div className="absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 bg-white border border-gray-300 rounded shadow p-2 text-xs flex flex-col items-center min-w-[120px]">
          <div className="mb-2">Do you want to delete this item?</div>
          <div className="flex gap-2">
            <button onClick={handleConfirmDelete} className="px-2 py-0.5 bg-red-500 text-white rounded text-xs">Yes</button>
            <button onClick={handleCancelDelete} className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded text-xs">No</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default QuantityControl; 