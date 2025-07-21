import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface Vendor {
  name: string;
  price: number;
  leadTime: string;
  availability: string;
}

const Vendors = () => {
  const [vendors, setVendors] = useState<Vendor[]>([
    { name: 'Vision Systems Inc', price: 1250, leadTime: '2 weeks', availability: 'In Stock' },
    { name: 'Industrial Components Ltd', price: 1180, leadTime: '3 weeks', availability: 'Limited' },
    { name: 'Optics Direct', price: 320, leadTime: '1 week', availability: 'In Stock' },
  ]);
  const [form, setForm] = useState<Vendor>({ name: '', price: 0, leadTime: '', availability: '' });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: name === 'price' ? Number(value) : value }));
  };

  const handleAddVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.leadTime || !form.availability) return;
    setVendors(prev => [...prev, form]);
    setForm({ name: '', price: 0, leadTime: '', availability: '' });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Vendors List</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {vendors.map((vendor, idx) => (
                <li key={idx} className="border rounded p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-medium">{vendor.name}</span>
                  <span className="text-sm text-gray-600">${vendor.price} • {vendor.leadTime} • {vendor.availability}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Add Vendor</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleAddVendor}>
              <Input name="name" placeholder="Vendor Name" value={form.name} onChange={handleChange} required />
              <Input name="price" type="number" placeholder="Price" value={form.price} onChange={handleChange} required />
              <Input name="leadTime" placeholder="Lead Time" value={form.leadTime} onChange={handleChange} required />
              <Input name="availability" placeholder="Availability" value={form.availability} onChange={handleChange} required />
              <Button type="submit" className="w-full">Add Vendor</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Vendors; 