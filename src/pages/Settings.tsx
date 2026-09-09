import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  User,
  Users,
  Package,
  ShoppingCart,
  Settings as SettingsIcon,
  Plus,
  Edit,
  Trash2,
  Save,
  X,
  Check,
  Building,
  Mail,
  Phone,
  MapPin,
  Loader2,
  Upload,
  Download,
  Search,
  Filter,
  AlertCircle,
  Tag,
  Landmark
} from 'lucide-react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import {
  Client,
  ClientContact,
  Vendor,
  BOMSettings,
  BOMCategory,
  PRSettings,
  addClient,
  updateClient,
  deleteClient,
  subscribeToClients,
  addVendor,
  updateVendor,
  deleteVendor,
  subscribeToVendors,
  getBOMSettings,
  updateBOMSettings,
  subscribeToBOMSettings,
  initializeDefaultBOMSettings,
  validateClient,
  validateVendor,
  getOEMVendors,
  getPRSettings,
  updatePRSettings,
  validatePRSettings,
  validateEmail,
  createClientContact,
  getClientContacts,
  clientContactFieldsForWrite,
} from '@/utils/settingsFirestore';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { exportVendorsToCSV, parseVendorCSV, validateVendorData, CSVImportResult } from '@/utils/csvImport';
import { uploadVendorLogo, uploadClientLogo, ImageUploadResult } from '@/utils/imageUpload';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/components/ui/use-toast';
import BrandsTab from '@/components/settings/BrandsTab';
import BOMTemplatesTab from '@/components/settings/BOMTemplatesTab';
import BillingEntitiesTab from '@/components/settings/BillingEntitiesTab';
import GmailConnectionsTab from '@/components/settings/GmailConnectionsTab';
import { Brand } from '@/types/brand';
import {
  subscribeToEngineerRates,
  upsertEngineerRate,
  deleteEngineerRate,
  validateEmail as validateEngineerEmail,
  validateRate,
} from '@/utils/engineerRatesFirestore';
import type { EngineerRate } from '@/types/engineerRate';
import { verifyGSTIN, isValidGSTINFormat } from '@/utils/gstVerification';
import { INDIAN_STATE_CODES } from '@/types/purchaseOrder';
import { subscribeToBrands } from '@/utils/brandFirestore';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@/firebase';
import { fetchAllUsers, updateUserRole, approveUser, rejectUser, deleteUser, UserRole } from '@/utils/userService';
import { Shield, UserCog, Inbox } from 'lucide-react';

const Settings = () => {
  // Auth check
  const { user, loading: authLoading, isAdmin } = useAuth();

  // Google OAuth redirect (Gmail connection) lands back on this page with
  // ?code=... — make sure the Communications tab (which mounts
  // GmailConnectionsTab) is selected immediately so its redirect-handling
  // effect actually runs.
  const [searchParams] = useSearchParams();
  const [activeSettingsTab, setActiveSettingsTab] = useState(
    () => (searchParams.get('code') ? 'communications' : 'clients')
  );

  // State management
  const [clients, setClients] = useState<Client[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [oemVendors, setOemVendors] = useState<Vendor[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [bomSettings, setBomSettings] = useState<BOMSettings | null>(null);

  // User management state
  interface AppUser {
    uid: string;
    email: string;
    displayName?: string;
    role?: UserRole;
    status?: string;
    createdAt?: string;
  }
  const [appUsers, setAppUsers] = useState<AppUser[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [engineerRates, setEngineerRates] = useState<Record<string, EngineerRate>>({});
  const [editingRateEmail, setEditingRateEmail] = useState<string | null>(null);
  const [rateDraft, setRateDraft] = useState('');
  const [savingRateEmail, setSavingRateEmail] = useState<string | null>(null);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [prSettings, setPRSettings] = useState<PRSettings | null>(null);

  // Vendor filtering states
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorCategoryFilter, setVendorCategoryFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog states
  const [clientDialog, setClientDialog] = useState(false);
  const [vendorDialog, setVendorDialog] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);

  // Form states
  const [clientForm, setClientForm] = useState<Partial<Client>>({});
  const [vendorForm, setVendorForm] = useState<Partial<Vendor>>({});
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // CSV Import states
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<CSVImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import preview states
  const [showImportPreview, setShowImportPreview] = useState(false);
  const [importPreviewData, setImportPreviewData] = useState<{
    newVendors: Array<{ vendor: Partial<Vendor>; lineNumber: number }>;
    updateVendors: Array<{
      vendor: Partial<Vendor>;
      existing: Vendor;
      lineNumber: number;
      changes: string[];
    }>;
  } | null>(null);

  // Image upload states (vendor)
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // GST verification state
  const [verifyingGST, setVerifyingGST] = useState(false);

  // Image upload states (client)
  const [clientLogoFile, setClientLogoFile] = useState<File | null>(null);
  const [clientLogoPreview, setClientLogoPreview] = useState<string | null>(null);
  const [uploadingClientLogo, setUploadingClientLogo] = useState(false);

  // Purchase Request settings states
  const [prEmailInput, setPREmailInput] = useState('');
  const [prRecipients, setPRRecipients] = useState<string[]>([]);
  const [prCompanyName, setPRCompanyName] = useState('Qualitas Technologies Pvt Ltd');
  const [prFromEmail, setPRFromEmail] = useState('info@qualitastech.com');
  const [prSaving, setPRSaving] = useState(false);
  const [prError, setPRError] = useState<string | null>(null);

  // Handle CSV file import
  const handleCSVImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResults(null);

    try {
      const text = await file.text();
      const parsedData = parseVendorCSV(text);

      const errors: string[] = [];
      const newVendors: Array<{ vendor: Partial<Vendor>; lineNumber: number }> = [];
      const updateVendors: Array<{
        vendor: Partial<Vendor>;
        existing: Vendor;
        lineNumber: number;
        changes: string[];
      }> = [];

      for (const { vendor, lineNumber } of parsedData) {
        // Validate vendor data
        const validationErrors = validateVendorData(vendor, lineNumber);
        if (validationErrors.length > 0) {
          errors.push(...validationErrors);
          continue;
        }

        // Check if vendor exists (match by company name, case-insensitive)
        const existingVendor = vendors.find(
          v => v.company.toLowerCase() === vendor.company?.toLowerCase()
        );

        if (existingVendor) {
          // Vendor exists - prepare for update
          const changes = detectVendorChanges(existingVendor, vendor);
          if (changes.length > 0) {
            updateVendors.push({
              vendor,
              existing: existingVendor,
              lineNumber,
              changes
            });
          }
          // If no changes, we silently skip it
        } else {
          // New vendor
          newVendors.push({ vendor, lineNumber });
        }
      }

      // Show import results if there were only errors
      if (errors.length > 0 && newVendors.length === 0 && updateVendors.length === 0) {
        setImportResults({ success: 0, errors });
        setImporting(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

      // Show preview dialog
      setImportPreviewData({ newVendors, updateVendors });
      setShowImportPreview(true);
    } catch (err: any) {
      setError(err.message || 'Failed to parse CSV file');
    }

    setImporting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Detect changes between two vendors
  const detectVendorChanges = (existing: Vendor, incoming: Partial<Vendor>): string[] => {
    const changes: string[] = [];

    if (incoming.type && incoming.type !== existing.type) {
      changes.push(`Type: ${existing.type} → ${incoming.type}`);
    }
    if (incoming.makes && JSON.stringify(incoming.makes) !== JSON.stringify(existing.makes || [])) {
      changes.push(`Makes: ${existing.makes?.join(', ') || '(none)'} → ${incoming.makes.join(', ')}`);
    }
    if (incoming.email && incoming.email !== existing.email) {
      changes.push(`Email: ${existing.email || '(empty)'} → ${incoming.email}`);
    }
    if (incoming.phone && incoming.phone !== existing.phone) {
      changes.push(`Phone: ${existing.phone || '(empty)'} → ${incoming.phone}`);
    }
    if (incoming.website && incoming.website !== existing.website) {
      changes.push(`Website: ${existing.website || '(empty)'} → ${incoming.website}`);
    }
    if (incoming.paymentTerms && incoming.paymentTerms !== existing.paymentTerms) {
      changes.push(`Payment Terms: ${existing.paymentTerms} → ${incoming.paymentTerms}`);
    }
    if (incoming.leadTime && incoming.leadTime !== existing.leadTime) {
      changes.push(`Lead Time: ${existing.leadTime} → ${incoming.leadTime}`);
    }
    if (incoming.address && incoming.address !== existing.address) {
      changes.push(`Address: ${existing.address || '(empty)'} → ${incoming.address}`);
    }
    if (incoming.contactPerson && incoming.contactPerson !== existing.contactPerson) {
      changes.push(`Contact: ${existing.contactPerson || '(empty)'} → ${incoming.contactPerson}`);
    }
    if (incoming.categories && JSON.stringify(incoming.categories) !== JSON.stringify(existing.categories || [])) {
      changes.push(`Categories: ${existing.categories?.join(', ') || '(none)'} → ${incoming.categories.join(', ')}`);
    }

    return changes;
  };

  // Confirm and execute import
  const handleConfirmImport = async () => {
    if (!importPreviewData) return;

    setImporting(true);
    setShowImportPreview(false);

    const errors: string[] = [];
    let successCount = 0;

    try {
      // Add new vendors
      for (const { vendor, lineNumber } of importPreviewData.newVendors) {
        try {
          await addVendor({
            company: vendor.company!,
            email: vendor.email || '',
            phone: vendor.phone || '',
            address: vendor.address || '',
            contactPerson: vendor.contactPerson || '',
            website: vendor.website || '',
            gstNo: vendor.gstNo || '',
            logo: vendor.logo || '',
            logoPath: '',
            paymentTerms: vendor.paymentTerms || 'Net 30',
            leadTime: vendor.leadTime || '2 weeks',
            rating: 0,
            status: 'active',
            notes: vendor.notes || '',
            type: vendor.type || 'Dealer',
            makes: vendor.makes || [],
            categories: vendor.categories || []
          });
          successCount++;
        } catch (err: any) {
          errors.push(`Line ${lineNumber}: ${err.message || 'Failed to add vendor'}`);
        }
      }

      // Update existing vendors
      for (const { vendor, existing, lineNumber } of importPreviewData.updateVendors) {
        try {
          await updateVendor(existing.id, {
            type: vendor.type || existing.type,
            email: vendor.email || existing.email,
            phone: vendor.phone || existing.phone,
            address: vendor.address || existing.address,
            contactPerson: vendor.contactPerson || existing.contactPerson,
            website: vendor.website || existing.website,
            gstNo: vendor.gstNo || existing.gstNo,
            logo: vendor.logo || existing.logo,
            paymentTerms: vendor.paymentTerms || existing.paymentTerms,
            leadTime: vendor.leadTime || existing.leadTime,
            notes: vendor.notes || existing.notes,
            makes: vendor.makes || existing.makes,
            categories: vendor.categories || existing.categories
          });
          successCount++;
        } catch (err: any) {
          errors.push(`Line ${lineNumber}: ${err.message || 'Failed to update vendor'}`);
        }
      }

      setImportResults({ success: successCount, errors });
    } catch (err: any) {
      setError(err.message || 'Failed to import vendors');
    }

    setImporting(false);
    setImportPreviewData(null);
  };

  // Load data on component mount
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        // Initialize BOM settings if they don't exist
        await initializeDefaultBOMSettings();
        
        // Load OEM vendors for dealer form
        const oems = await getOEMVendors();
        setOemVendors(oems);
        
        // Load Purchase Request settings
        const prSettingsData = await getPRSettings();
        if (prSettingsData) {
          setPRSettings(prSettingsData);
          setPRRecipients(prSettingsData.recipients || []);
          setPRCompanyName(prSettingsData.companyName || 'Qualitas Technologies Pvt Ltd');
          setPRFromEmail(prSettingsData.fromEmail || 'info@qualitastech.com');
        }

        // Subscribe to real-time updates
        const unsubscribeClients = subscribeToClients(setClients);
        const unsubscribeVendors = subscribeToVendors((vendors) => {
          setVendors(vendors);
          // Update OEM vendors list when vendors change
          setOemVendors(vendors.filter(v => v.type === 'OEM'));
        });
        const unsubscribeBOMSettings = subscribeToBOMSettings(setBomSettings);
        const unsubscribeBrands = subscribeToBrands((brandsData) => {
          setBrands(brandsData.filter(b => b.status === 'active'));
        });

        setLoading(false);

        // Cleanup function
        return () => {
          unsubscribeClients();
          unsubscribeVendors();
          unsubscribeBOMSettings();
          unsubscribeBrands();
        };
      } catch (err: any) {
        setError(err.message || 'Failed to load settings data');
        setLoading(false);
      }
    };

    const cleanup = loadData();
    return () => {
      cleanup?.then(cleanupFn => cleanupFn && cleanupFn());
    };
  }, []);

  // Subscribe to engineer rates (admin only — Firestore rules enforce access)
  useEffect(() => {
    if (!isAdmin) return;
    const unsubscribe = subscribeToEngineerRates((rates) => {
      const byEmail: Record<string, EngineerRate> = {};
      for (const r of rates) byEmail[r.email.toLowerCase()] = r;
      setEngineerRates(byEmail);
    });
    return unsubscribe;
  }, [isAdmin]);

  // Client logo handlers
  const handleClientImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setClientLogoFile(file);
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        setClientLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearClientLogo = () => {
    setClientLogoFile(null);
    setClientLogoPreview(null);
    setClientForm({...clientForm, logo: '', logoPath: ''});
  };

  // Client management functions
  const setCRMContacts = (contacts: ClientContact[]) => {
    setClientForm((current) => ({ ...current, contacts }));
  };

  const updateCRMContact = (
    contactId: string,
    updates: Partial<ClientContact>,
  ) => {
    const contacts = getClientContacts(clientForm, true).map((contact) =>
      contact.id === contactId ? { ...contact, ...updates } : contact,
    );
    setCRMContacts(contacts);
  };

  const addCRMContact = () => {
    const contacts = getClientContacts(clientForm, true);
    setCRMContacts([
      ...contacts,
      createClientContact({ isPrimary: contacts.length === 0 }),
    ]);
  };

  const removeCRMContact = (contactId: string) => {
    const remaining = getClientContacts(clientForm, true).filter(
      (contact) => contact.id !== contactId,
    );
    if (remaining.length && !remaining.some((contact) => contact.isPrimary)) {
      remaining[0] = { ...remaining[0], isPrimary: true };
    }
    setCRMContacts(remaining);
  };

  const setPrimaryCRMContact = (contactId: string) => {
    setCRMContacts(
      getClientContacts(clientForm, true).map((contact) => ({
        ...contact,
        isPrimary: contact.id === contactId,
      })),
    );
  };

  const handleAddClient = async () => {
    if (!user) return;

    const contactFields = clientContactFieldsForWrite(clientForm);
    const clientToValidate = { ...clientForm, ...contactFields };
    const errors = validateClient(clientToValidate);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    try {
      setLoading(true);

      let logoUrl = '';
      let logoPath = '';

      // Upload logo if selected
      if (clientLogoFile) {
        setUploadingClientLogo(true);
        const uploadResult = await uploadClientLogo(clientLogoFile);
        logoUrl = uploadResult.url;
        logoPath = uploadResult.path;
        setUploadingClientLogo(false);
      }

      await addClient({
        company: clientForm.company || '',
        ...contactFields,
        address: clientForm.address || '',
        gstin: clientForm.gstin?.trim().toUpperCase() || '',
        pan: clientForm.pan?.trim().toUpperCase() || '',
        stateCode: clientForm.stateCode || '',
        stateName: clientForm.stateName || '',
        notes: clientForm.notes || '',
        logo: logoUrl,
        logoPath: logoPath,
      });

      // Reset form
      setClientForm({
        company: '',
        contacts: [createClientContact({ isPrimary: true })],
        address: '',
        gstin: '',
        pan: '',
        stateCode: '',
        stateName: '',
        notes: ''
      });
      setClientLogoFile(null);
      setClientLogoPreview(null);

      setClientDialog(false);
      toast({
        title: "Success",
        description: "Client added successfully",
      });
    } catch (error) {
      console.error('Error adding client:', error);
      setUploadingClientLogo(false);
      toast({
        title: "Error",
        description: "Failed to add client",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEditClient = (client: Client) => {
    setEditingClient(client);
    setClientForm({ ...client, contacts: getClientContacts(client, true) });
    setFormErrors([]);
    // Set logo preview if client has logo
    if (client.logo) {
      setClientLogoPreview(client.logo);
      setClientLogoFile(null); // Clear file since it's existing image
    } else {
      setClientLogoPreview(null);
      setClientLogoFile(null);
    }
    setClientDialog(true);
  };

  const handleUpdateClient = async () => {
    if (!editingClient) return;

    const errors = validateClient(clientForm);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      let updatedClientForm = {
        ...clientForm,
        ...clientContactFieldsForWrite(clientForm),
        gstin: clientForm.gstin?.trim().toUpperCase() || '',
        pan: clientForm.pan?.trim().toUpperCase() || '',
      };

      // Upload new logo if selected
      if (clientLogoFile) {
        setUploadingClientLogo(true);
        const uploadResult = await uploadClientLogo(clientLogoFile, editingClient.id);
        updatedClientForm.logo = uploadResult.url;
        updatedClientForm.logoPath = uploadResult.path;
        setUploadingClientLogo(false);
      }

      await updateClient(editingClient.id, updatedClientForm);

      setEditingClient(null);
      setClientForm({});
      setClientLogoFile(null);
      setClientLogoPreview(null);
      setClientDialog(false);
      setFormErrors([]);
    } catch (err: any) {
      setUploadingClientLogo(false);
      setError(err.message || 'Failed to update client');
    }
    setSaving(false);
  };

  const handleDeleteClient = async (clientId: string) => {
    if (!confirm('Are you sure you want to delete this client?')) return;
    
    try {
      await deleteClient(clientId);
    } catch (err: any) {
      setError(err.message || 'Failed to delete client');
    }
  };

  // Vendor management functions
  const handleAddVendor = async () => {
    const errors = validateVendor(vendorForm);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      let logoUrl = '';
      let logoPath = '';

      // Upload logo if provided
      if (logoFile) {
        setUploadingLogo(true);
        const uploadResult = await uploadVendorLogo(logoFile);
        logoUrl = uploadResult.url;
        logoPath = uploadResult.path;
        setUploadingLogo(false);
      }

      await addVendor({
        company: vendorForm.company || '',
        email: vendorForm.email || '',
        phone: vendorForm.phone || '',
        address: vendorForm.address || '',
        contactPerson: vendorForm.contactPerson || '',
        website: vendorForm.website || '',
        logo: logoUrl,
        logoPath: logoPath,
        gstNo: vendorForm.gstNo || '',
        stateCode: vendorForm.stateCode || '',
        stateName: vendorForm.stateName || '',
        paymentTerms: vendorForm.paymentTerms || 'Net 30',
        leadTime: vendorForm.leadTime || '2 weeks',
        rating: vendorForm.rating || 0,
        status: 'active',
        notes: vendorForm.notes || '',
        type: vendorForm.type || 'Dealer',
        makes: vendorForm.makes || [],
        distributedBrands: vendorForm.distributedBrands || [],
        categories: vendorForm.categories || []
      });
      
      setVendorForm({});
      setLogoFile(null);
      setLogoPreview(null);
      setVendorDialog(false);
      setFormErrors([]);
    } catch (err: any) {
      setError(err.message || 'Failed to add vendor');
      setUploadingLogo(false);
    }
    setSaving(false);
  };

  // Handle image file selection
  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setLogoFile(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => {
        setLogoPreview(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  // Clear logo
  const clearLogo = () => {
    setLogoFile(null);
    setLogoPreview(null);
    setVendorForm({...vendorForm, logo: '', logoPath: ''});
  };

  // Handle GST verification
  const handleVerifyGST = async () => {
    const gstNo = vendorForm.gstNo?.trim();
    if (!gstNo) {
      toast({
        title: 'GST Number Required',
        description: 'Please enter a GSTIN to verify.',
        variant: 'destructive',
      });
      return;
    }

    if (!isValidGSTINFormat(gstNo)) {
      toast({
        title: 'Invalid Format',
        description: 'GSTIN should be 15 characters in the correct format.',
        variant: 'destructive',
      });
      return;
    }

    setVerifyingGST(true);
    try {
      const result = await verifyGSTIN(gstNo);

      if (result.success && result.data) {
        const tradeName = result.data.tradeName?.trim() || '';
        const legalName = result.data.legalName?.trim() || '';
        const companyNameFromGST = tradeName || legalName;
        const newAddress = result.data.formattedAddress;

        // Show both GST name fields clearly so users can confirm mapping.
        const confirmMessage = `GST Verified Successfully!\n\nUpdate vendor details?\n\nTrade Name: ${tradeName || '(not provided)'}\nLegal Name: ${legalName || '(not provided)'}\nCompany (will be set): ${companyNameFromGST || '(unchanged)'}\nAddress: ${newAddress || '(not provided)'}\nState: ${result.data.stateName} (${result.data.stateCode})\nStatus: ${result.data.status}`;

        if (window.confirm(confirmMessage)) {
          // Map AppyFlow data into vendor fields:
          // - company: trade name first (business-facing), fallback to legal name
          // - contactPerson: legal name only when empty and different from company
          setVendorForm(prev => ({
            ...prev,
            company: companyNameFromGST || prev.company,
            contactPerson: !prev.contactPerson && legalName && legalName !== companyNameFromGST
              ? legalName
              : prev.contactPerson,
            address: newAddress || prev.address,
            gstNo: result.data!.gstin || prev.gstNo,
            stateCode: result.data!.stateCode,
            stateName: result.data!.stateName,
          }));

          toast({
            title: 'Vendor Details Updated',
            description: `Updated from GST: ${companyNameFromGST || 'Name unavailable'}`,
          });
        } else {
          toast({
            title: 'GSTIN Verified',
            description: `Business: ${companyNameFromGST || 'Name unavailable'} (${result.data.status}) - Details not updated`,
          });
        }
      } else {
        toast({
          title: 'Verification Failed',
          description: result.error || 'Could not verify GSTIN',
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('GST verification error:', error);
      toast({
        title: 'Error',
        description: 'Failed to verify GSTIN. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setVerifyingGST(false);
    }
  };

  const handleEditVendor = (vendor: Vendor) => {
    setEditingVendor(vendor);
    setVendorForm(vendor);
    setFormErrors([]);
    
    // Set logo preview if vendor has logo
    if (vendor.logo) {
      setLogoPreview(vendor.logo);
      setLogoFile(null); // Clear file since it's existing image
    } else {
      setLogoPreview(null);
      setLogoFile(null);
    }
    
    setVendorDialog(true);
  };

  const handleUpdateVendor = async () => {
    if (!editingVendor) return;
    
    const errors = validateVendor(vendorForm);
    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }

    setSaving(true);
    try {
      let updatedVendorForm = { ...vendorForm };

      // Upload new logo if provided
      if (logoFile) {
        setUploadingLogo(true);
        const uploadResult = await uploadVendorLogo(logoFile, editingVendor.id);
        updatedVendorForm.logo = uploadResult.url;
        updatedVendorForm.logoPath = uploadResult.path;
        setUploadingLogo(false);
      }

      await updateVendor(editingVendor.id, updatedVendorForm);
      
      setEditingVendor(null);
      setVendorForm({});
      setLogoFile(null);
      setLogoPreview(null);
      setVendorDialog(false);
      setFormErrors([]);
    } catch (err: any) {
      setError(err.message || 'Failed to update vendor');
      setUploadingLogo(false);
    }
    setSaving(false);
  };

  const handleDeleteVendor = async (vendorId: string) => {
    if (!confirm('Are you sure you want to delete this vendor?')) return;
    
    try {
      await deleteVendor(vendorId);
    } catch (err: any) {
      setError(err.message || 'Failed to delete vendor');
    }
  };


  // BOM Settings functions
  const handleSaveBOMSettings = async () => {
    if (!bomSettings) return;
    
    setSaving(true);
    try {
      await updateBOMSettings(bomSettings);
    } catch (err: any) {
      setError(err.message || 'Failed to save BOM settings');
    }
    setSaving(false);
  };

  const addCategory = async (newCategory: string) => {
    if (!bomSettings || !newCategory.trim()) return;
    
    const currentCategories = bomSettings.categories || [];
    const newEnhancedCategory = {
      id: Date.now().toString(),
      name: newCategory.trim(),
      order: currentCategories.length + 1,
      isActive: true,
      color: '#9CA3AF'
    };
    
    const updatedCategories = [...currentCategories, newEnhancedCategory];
    const updatedSettings = {
      ...bomSettings,
      categories: updatedCategories,
      defaultCategories: updatedCategories.filter(cat => !cat.parentId).map(cat => cat.name)
    };
    
    setBomSettings(updatedSettings);
    
    try {
      await updateBOMSettings(updatedSettings);
    } catch (err: any) {
      setError(err.message || 'Failed to save category');
    }
  };

  const removeCategory = async (categoryId: string) => {
    if (!bomSettings) return;
    
    const currentCategories = bomSettings.categories || [];
    const updatedCategories = currentCategories.filter(cat => cat.id !== categoryId);
    const updatedSettings = {
      ...bomSettings,
      categories: updatedCategories,
      defaultCategories: updatedCategories.filter(cat => !cat.parentId).map(cat => cat.name)
    };
    
    setBomSettings(updatedSettings);
    
    try {
      await updateBOMSettings(updatedSettings);
    } catch (err: any) {
      setError(err.message || 'Failed to remove category');
    }
  };

  const renameCategory = async (categoryId: string, newName: string) => {
    if (!bomSettings) return;
    const trimmedName = newName.trim();
    if (!trimmedName) return;

    const currentCategories = bomSettings.categories || [];
    const duplicate = currentCategories.some(
      (cat) =>
        !cat.parentId &&
        cat.id !== categoryId &&
        cat.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      setError('Category name already exists.');
      return;
    }

    const updatedCategories = currentCategories.map((cat) =>
      cat.id === categoryId ? { ...cat, name: trimmedName } : cat
    );
    const updatedSettings = {
      ...bomSettings,
      categories: updatedCategories,
      defaultCategories: updatedCategories.filter((cat) => !cat.parentId).map((cat) => cat.name),
    };

    setBomSettings(updatedSettings);
    setEditingCategoryId(null);
    setCategoryDraft('');

    try {
      await updateBOMSettings(updatedSettings);
    } catch (err: any) {
      setError(err.message || 'Failed to rename category');
    }
  };

  // Check auth loading first
  if (authLoading) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Check admin access
  if (!user || !isAdmin) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <X className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600">You need admin privileges to access settings.</p>
            {user && user.isPending && (
              <p className="text-yellow-600 mt-2">Your account is pending approval.</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Purchase Request Settings Handlers
  const handleAddPRRecipient = () => {
    if (!prEmailInput.trim()) return;

    const email = prEmailInput.trim();

    // Validate email
    if (!validateEmail(email)) {
      setPRError('Invalid email format');
      return;
    }

    // Check for duplicates
    if (prRecipients.includes(email)) {
      setPRError('Email already added');
      return;
    }

    setPRRecipients([...prRecipients, email]);
    setPREmailInput('');
    setPRError(null);
  };

  const handleRemovePRRecipient = (email: string) => {
    setPRRecipients(prRecipients.filter(e => e !== email));
  };

  const handleSavePRSettings = async () => {
    try {
      setPRSaving(true);
      setPRError(null);

      const settings = {
        recipients: prRecipients,
        companyName: prCompanyName,
        fromEmail: prFromEmail
      };

      // Validate
      const errors = validatePRSettings(settings);
      if (errors.length > 0) {
        setPRError(errors.join(', '));
        setPRSaving(false);
        return;
      }

      // Save to Firestore
      await updatePRSettings(settings);

      toast({
        title: "Success",
        description: "Purchase request settings saved successfully",
      });
    } catch (error: any) {
      setPRError(error.message || 'Failed to save settings');
      toast({
        title: "Error",
        description: "Failed to save purchase request settings",
        variant: "destructive",
      });
    } finally {
      setPRSaving(false);
    }
  };

  // User Management Functions
  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const result = await fetchAllUsers();
      const rawUsers = (result as { users: Array<{
        uid: string;
        email: string;
        displayName?: string;
        creationTime?: string;
        customClaims?: { role?: string; status?: string };
      }> }).users || [];
      const usersData: AppUser[] = rawUsers.map((rawUser) => ({
        uid: rawUser.uid,
        email: rawUser.email,
        displayName: rawUser.displayName,
        role: (rawUser.customClaims?.role as UserRole) || undefined,
        status: rawUser.customClaims?.status,
        createdAt: rawUser.creationTime,
      }));
      setAppUsers(usersData);
      setPendingCount(usersData.filter(u => !u.status || u.status === 'pending').length);
    } catch (error) {
      console.error('Error loading users:', error);
      toast({
        title: "Error",
        description: "Failed to load users",
        variant: "destructive",
      });
    } finally {
      setUsersLoading(false);
    }
  };

  const handleToggleAdmin = async (targetUid: string, currentRole: UserRole | undefined) => {
    // Default to 'user' if role is undefined
    const effectiveCurrentRole = currentRole || 'user';
    const newRole: UserRole = effectiveCurrentRole === 'admin' ? 'user' : 'admin';

    setUpdatingUserId(targetUid);
    try {
      await updateUserRole(targetUid, newRole);
      // Reload users to get fresh data from server
      await loadUsers();
      toast({
        title: "Success",
        description: `User role updated to ${newRole}`,
      });
    } catch (error: any) {
      console.error('Error updating user role:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to update user role",
        variant: "destructive",
      });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleApproveUser = async (targetUid: string) => {
    setUpdatingUserId(targetUid);
    try {
      await approveUser(targetUid, 'user');
      await loadUsers();
      toast({
        title: "Success",
        description: "User approved successfully",
      });
    } catch (error: any) {
      console.error('Error approving user:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to approve user",
        variant: "destructive",
      });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleRejectUser = async (targetUid: string) => {
    setUpdatingUserId(targetUid);
    try {
      await rejectUser(targetUid);
      await loadUsers();
      toast({
        title: "Success",
        description: "User rejected",
      });
    } catch (error: any) {
      console.error('Error rejecting user:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to reject user",
        variant: "destructive",
      });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const handleDeleteUser = async (targetUid: string, email: string) => {
    if (!confirm(`Are you sure you want to permanently delete user ${email}? This cannot be undone.`)) {
      return;
    }

    setUpdatingUserId(targetUid);
    try {
      await deleteUser(targetUid);
      await loadUsers();
      toast({
        title: "Success",
        description: "User deleted permanently",
      });
    } catch (error: any) {
      console.error('Error deleting user:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to delete user",
        variant: "destructive",
      });
    } finally {
      setUpdatingUserId(null);
    }
  };

  const startEditRate = (email: string) => {
    const existing = engineerRates[email.toLowerCase()];
    setEditingRateEmail(email);
    setRateDraft(existing ? String(existing.hourlyRate) : '');
  };

  const cancelEditRate = () => {
    setEditingRateEmail(null);
    setRateDraft('');
  };

  const handleSaveRate = async (appUser: AppUser) => {
    if (!user?.email) return;
    if (!validateEngineerEmail(appUser.email)) {
      toast({
        title: 'Cannot set rate',
        description: 'Engineer rates require a @qualitastech.com email.',
        variant: 'destructive',
      });
      return;
    }
    const trimmed = rateDraft.trim();
    if (trimmed === '') {
      // Empty input clears the rate
      setSavingRateEmail(appUser.email);
      try {
        await deleteEngineerRate(appUser.email);
        toast({ title: 'Rate removed', description: appUser.email });
        cancelEditRate();
      } catch (err: any) {
        toast({ title: 'Failed to remove rate', description: err.message || String(err), variant: 'destructive' });
      } finally {
        setSavingRateEmail(null);
      }
      return;
    }
    const parsed = Number(trimmed);
    if (!validateRate(parsed)) {
      toast({ title: 'Invalid rate', description: 'Rate must be a number ≥ 0', variant: 'destructive' });
      return;
    }
    setSavingRateEmail(appUser.email);
    try {
      await upsertEngineerRate(
        { email: appUser.email, name: appUser.displayName || appUser.email, hourlyRate: parsed },
        user.email,
      );
      toast({ title: 'Rate saved', description: `${appUser.displayName || appUser.email} – ₹${parsed}/hr` });
      cancelEditRate();
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message || String(err), variant: 'destructive' });
    } finally {
      setSavingRateEmail(null);
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-6 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
            <p>Loading settings...</p>
          </div>
        </div>
      </div>
    );
  }

  // Filter and sort vendors based on search and category
  const filteredVendors = vendors
    .filter(vendor => {
      // Search filter
      const searchLower = vendorSearch.toLowerCase();
      const matchesSearch = !vendorSearch ||
        vendor.company.toLowerCase().includes(searchLower) ||
        vendor.email?.toLowerCase().includes(searchLower) ||
        vendor.contactPerson?.toLowerCase().includes(searchLower) ||
        vendor.makes?.some(make => make.toLowerCase().includes(searchLower));

      // Category filter
      const matchesCategory = vendorCategoryFilter === 'all' ||
        vendor.categories?.includes(vendorCategoryFilter);

      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => a.company.localeCompare(b.company));

  // Get unique categories from BOM settings for filter dropdown
  const availableCategories = bomSettings?.defaultCategories || [];

  return (
    <div className="container mx-auto py-6 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-2">Manage your system configuration and preferences</p>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertDescription>{error}</AlertDescription>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setError(null)}
              className="mt-2"
            >
              Dismiss
            </Button>
          </Alert>
        )}

        <Tabs value={activeSettingsTab} onValueChange={setActiveSettingsTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-9">
            <TabsTrigger value="billing-entities" className="flex items-center gap-2">
              <Landmark size={16} />
              Billing Entities
            </TabsTrigger>
            <TabsTrigger value="clients" className="flex items-center gap-2">
              <Users size={16} />
              Clients ({clients.length})
            </TabsTrigger>
            <TabsTrigger value="brands" className="flex items-center gap-2">
              <Tag size={16} />
              Brands
            </TabsTrigger>
            <TabsTrigger value="vendors" className="flex items-center gap-2">
              <ShoppingCart size={16} />
              Vendors ({vendors.length})
            </TabsTrigger>
            <TabsTrigger value="bom" className="flex items-center gap-2">
              <Package size={16} />
              BOM Settings
            </TabsTrigger>
            <TabsTrigger value="purchase-request" className="flex items-center gap-2">
              <Mail size={16} />
              Purchase Request
            </TabsTrigger>
            <TabsTrigger value="communications" className="flex items-center gap-2">
              <Inbox size={16} />
              Communications
            </TabsTrigger>
            <TabsTrigger value="users" className="flex items-center gap-2 relative" onClick={() => loadUsers()}>
              <UserCog size={16} />
              Users
              {pendingCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[10px] font-bold h-4 min-w-4 px-1">
                  {pendingCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="general" className="flex items-center gap-2">
              <SettingsIcon size={16} />
              General
            </TabsTrigger>
          </TabsList>

          <TabsContent value="billing-entities">
            <BillingEntitiesTab />
          </TabsContent>

          {/* Clients Tab */}
          <TabsContent value="clients">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Client Management</CardTitle>
                    <CardDescription>Manage your client contacts and information</CardDescription>
                  </div>
                  <Dialog open={clientDialog} onOpenChange={setClientDialog}>
                    <DialogTrigger asChild>
                      <Button onClick={() => {
                        setEditingClient(null);
                        setClientForm({
                          contacts: [createClientContact({ isPrimary: true })],
                        });
                        setFormErrors([]);
                      }}>
                        <Plus size={16} className="mr-2" />
                        Add Client
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="@container max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                      <DialogHeader>
                        <DialogTitle>
                          {editingClient ? 'Edit Client' : 'Add New Client'}
                        </DialogTitle>
                        <DialogDescription>
                          {editingClient ? 'Update client information' : 'Add a new client to your system'}
                        </DialogDescription>
                      </DialogHeader>

                      <div className="flex-1 overflow-y-auto pr-2 -mr-2">
                        {formErrors.length > 0 && (
                          <Alert variant="destructive" className="mb-4">
                            <AlertDescription>
                              <ul className="list-disc list-inside">
                                {formErrors.map((error, index) => (
                                  <li key={index}>{error}</li>
                                ))}
                              </ul>
                            </AlertDescription>
                          </Alert>
                        )}

                        <div className="grid grid-cols-2 gap-4 pb-4">
                          <div className="col-span-2 space-y-2">
                            <Label htmlFor="company">Company Name *</Label>
                            <Input
                              id="company"
                              value={clientForm.company || ''}
                              onChange={(e) => setClientForm({...clientForm, company: e.target.value})}
                              placeholder="Enter company name"
                            />
                          </div>
                          <div className="col-span-2 space-y-3 rounded-lg border bg-slate-50 p-4">
                            <div>
                              <Label>Commercial and GST details</Label>
                              <p className="text-xs text-muted-foreground">
                                Used on quotations and other customer-facing commercial documents.
                              </p>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-1">
                                <Label>GSTIN</Label>
                                <Input value={clientForm.gstin || ''} onChange={(e) => setClientForm({ ...clientForm, gstin: e.target.value.toUpperCase() })} placeholder="15-character GSTIN" maxLength={15} />
                              </div>
                              <div className="space-y-1">
                                <Label>PAN</Label>
                                <Input value={clientForm.pan || ''} onChange={(e) => setClientForm({ ...clientForm, pan: e.target.value.toUpperCase() })} placeholder="10-character PAN" maxLength={10} />
                              </div>
                              <div className="space-y-1">
                                <Label>State</Label>
                                <Select
                                  value={clientForm.stateCode || ''}
                                  onValueChange={(stateCode) => setClientForm({
                                    ...clientForm,
                                    stateCode,
                                    stateName: INDIAN_STATE_CODES[stateCode] || '',
                                  })}
                                >
                                  <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
                                  <SelectContent>
                                    {Object.entries(INDIAN_STATE_CODES).map(([code, name]) => (
                                      <SelectItem key={code} value={code}>{code} - {name}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1">
                                <Label>State code</Label>
                                <Input value={clientForm.stateCode || ''} readOnly placeholder="Auto-filled" />
                              </div>
                            </div>
                          </div>
                        <div className="col-span-2 space-y-3 rounded-lg border bg-slate-50 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <Label>CRM contacts</Label>
                              <p className="text-xs text-muted-foreground">
                                These contacts are shared by projects, support tickets, and customer communication.
                              </p>
                            </div>
                            <Button type="button" variant="outline" size="sm" onClick={addCRMContact}>
                              <Plus className="mr-2 h-4 w-4" />
                              Add contact
                            </Button>
                          </div>
                          {getClientContacts(clientForm, true).length === 0 ? (
                            <div className="rounded-md border border-dashed bg-white p-4 text-center text-sm text-muted-foreground">
                              No contacts yet. Add a technical, commercial, or operations contact.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {getClientContacts(clientForm, true).map((contact, index) => (
                                <div key={contact.id} className="rounded-lg border bg-white p-3">
                                  <div className="mb-3 flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium">Contact {index + 1}</span>
                                      {contact.isPrimary && <Badge>Primary</Badge>}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {!contact.isPrimary && (
                                        <Button type="button" variant="ghost" size="sm" onClick={() => setPrimaryCRMContact(contact.id)}>
                                          Make primary
                                        </Button>
                                      )}
                                      <Button type="button" variant="ghost" size="icon" onClick={() => removeCRMContact(contact.id)} aria-label={`Remove ${contact.name || `contact ${index + 1}`}`}>
                                        <Trash2 className="h-4 w-4 text-red-500" />
                                      </Button>
                                    </div>
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                      <Label>Name</Label>
                                      <Input value={contact.name} onChange={(e) => updateCRMContact(contact.id, { name: e.target.value })} placeholder="Contact name" />
                                    </div>
                                    <div className="space-y-1">
                                      <Label>Designation</Label>
                                      <Input value={contact.designation || ''} onChange={(e) => updateCRMContact(contact.id, { designation: e.target.value })} placeholder="Plant manager, maintenance engineer…" />
                                    </div>
                                    <div className="space-y-1">
                                      <Label>Email</Label>
                                      <Input type="email" value={contact.email} onChange={(e) => updateCRMContact(contact.id, { email: e.target.value })} placeholder="name@customer.com" />
                                    </div>
                                    <div className="space-y-1">
                                      <Label>Phone</Label>
                                      <Input value={contact.phone} onChange={(e) => updateCRMContact(contact.id, { phone: e.target.value })} placeholder="Phone number" />
                                    </div>
                                    <div className="space-y-1">
                                      <Label>Relationship</Label>
                                      <Select value={contact.role} onValueChange={(value) => updateCRMContact(contact.id, { role: value as ClientContact['role'] })}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="technical">Technical</SelectItem>
                                          <SelectItem value="commercial">Commercial</SelectItem>
                                          <SelectItem value="operations">Operations</SelectItem>
                                          <SelectItem value="management">Management</SelectItem>
                                          <SelectItem value="other">Other</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="flex items-end">
                                      <div className="flex items-center gap-2 pb-2">
                                        <Switch checked={contact.isActive} onCheckedChange={(checked) => updateCRMContact(contact.id, { isActive: checked })} />
                                        <Label>Active contact</Label>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                                                  <div className="col-span-2 space-y-2">
                            <Label htmlFor="address">Registered / billing address</Label>
                            <Input
                              id="address"
                              value={clientForm.address || ''}
                              onChange={(e) => setClientForm({...clientForm, address: e.target.value})}
                              placeholder="Enter address"
                            />
                          </div>
                        <div className="col-span-2 space-y-2">
                          <Label htmlFor="notes">Notes</Label>
                          <Textarea
                            id="notes"
                            value={clientForm.notes || ''}
                            onChange={(e) => setClientForm({...clientForm, notes: e.target.value})}
                            placeholder="Additional notes about the client"
                          />
                        </div>
                        <div className="col-span-2 space-y-2">
                          <Label>Company Logo</Label>
                          <div className="flex items-center gap-4">
                            {clientLogoPreview && (
                              <div className="relative">
                                <img
                                  src={clientLogoPreview}
                                  alt="Logo preview"
                                  className="w-16 h-16 object-contain border rounded"
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
                                  onClick={clearClientLogo}
                                >
                                  <X size={14} />
                                </Button>
                              </div>
                            )}
                            <div className="flex-1">
                              <Input
                                type="file"
                                accept="image/*"
                                onChange={handleClientImageSelect}
                                className="cursor-pointer"
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                Upload a company logo (max 2MB, will be resized to 200x200px)
                              </p>
                            </div>
                          </div>
                        </div>
                        </div>
                      </div>

                      <div className="flex justify-end gap-2 mt-4 pt-4 border-t bg-background">
                        <Button
                          onClick={editingClient ? handleUpdateClient : handleAddClient}
                          disabled={saving || uploadingClientLogo}
                        >
                          {(saving || uploadingClientLogo) && <Loader2 size={16} className="mr-2 animate-spin" />}
                          <Save size={16} className="mr-2" />
                          {uploadingClientLogo ? 'Uploading Logo...' : `${editingClient ? 'Update' : 'Add'} Client`}
                        </Button>
                        <Button variant="outline" onClick={() => setClientDialog(false)}>
                          Cancel
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {clients.length === 0 ? (
                  <div className="text-center py-8">
                    <Users className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                    <p className="text-gray-500">No clients added yet</p>
                    <p className="text-gray-400 text-sm">Add your first client to get started</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Client</TableHead>
                        <TableHead>Contact Info</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clients.map((client) => {
                        const crmContacts = getClientContacts(client);
                        const primaryContact =
                          crmContacts.find((contact) => contact.isPrimary) ||
                          crmContacts[0];
                        return (
                        <TableRow key={client.id}>
                          <TableCell>
                            <div className="flex items-center space-x-3">
                              {client.logo && (
                                <img
                                  src={client.logo}
                                  alt={`${client.company} logo`}
                                  className="w-8 h-8 object-contain rounded"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                              )}
                              <div className="font-medium">{client.company}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  {primaryContact?.name || 'No primary contact'}
                                </span>
                                <Badge variant="secondary">
                                  {crmContacts.length} {crmContacts.length === 1 ? 'contact' : 'contacts'}
                                </Badge>
                              </div>
                              {primaryContact?.email && (
                                <div className="flex items-center gap-1 text-sm">
                                  <Mail size={12} />
                                  {primaryContact.email}
                                </div>
                              )}
                              {primaryContact?.phone && (
                                <div className="flex items-center gap-1 text-sm">
                                  <Phone size={12} />
                                  {primaryContact.phone}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditClient(client)}
                              >
                                <Edit size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDeleteClient(client.id)}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )})}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

          </TabsContent>

          {/* Vendors Tab */}
          <TabsContent value="vendors">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle>Vendor Management</CardTitle>
                    <CardDescription>Manage your vendor database and supplier information</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => exportVendorsToCSV(vendors)}
                      disabled={vendors.length === 0}
                      className="flex items-center gap-2"
                    >
                      <Download size={16} />
                      Export Vendors
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={importing}
                      className="flex items-center gap-2"
                    >
                      {importing ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Upload size={16} />
                      )}
                      {importing ? 'Importing...' : 'Import CSV'}
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv"
                      onChange={handleCSVImport}
                      style={{ display: 'none' }}
                    />

                    {/* Import Preview Dialog */}
                    <Dialog open={showImportPreview} onOpenChange={setShowImportPreview}>
                      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
                        <DialogHeader>
                          <DialogTitle>Import Preview</DialogTitle>
                          <DialogDescription>
                            Review changes before importing vendors
                          </DialogDescription>
                        </DialogHeader>

                        <div className="flex-1 overflow-y-auto space-y-4">
                          {/* Summary */}
                          {importPreviewData && (
                            <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
                              <div>
                                <p className="text-sm text-muted-foreground">New Vendors</p>
                                <p className="text-2xl font-bold text-green-600">
                                  {importPreviewData.newVendors.length}
                                </p>
                              </div>
                              <div>
                                <p className="text-sm text-muted-foreground">Updates</p>
                                <p className="text-2xl font-bold text-blue-600">
                                  {importPreviewData.updateVendors.length}
                                </p>
                              </div>
                            </div>
                          )}

                          {/* New Vendors */}
                          {importPreviewData && importPreviewData.newVendors.length > 0 && (
                            <div>
                              <h3 className="font-semibold text-sm mb-2">
                                New Vendors ({importPreviewData.newVendors.length})
                              </h3>
                              <div className="space-y-2">
                                {importPreviewData.newVendors.map(({ vendor, lineNumber }) => (
                                  <div
                                    key={lineNumber}
                                    className="border rounded-lg p-3 bg-green-50"
                                  >
                                    <div className="flex items-center gap-2">
                                      <Badge variant="outline" className="bg-green-600 text-white">
                                        NEW
                                      </Badge>
                                      <span className="font-semibold">{vendor.company}</span>
                                      <Badge variant="secondary" className="text-xs">
                                        {vendor.type || 'Dealer'}
                                      </Badge>
                                    </div>
                                    {vendor.email && (
                                      <p className="text-sm text-muted-foreground mt-1">
                                        {vendor.email}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Updates */}
                          {importPreviewData && importPreviewData.updateVendors.length > 0 && (
                            <div>
                              <h3 className="font-semibold text-sm mb-2">
                                Updates ({importPreviewData.updateVendors.length})
                              </h3>
                              <Alert className="mb-3">
                                <AlertCircle className="h-4 w-4" />
                                <AlertDescription>
                                  The following vendors will be updated with new information
                                </AlertDescription>
                              </Alert>
                              <div className="space-y-3">
                                {importPreviewData.updateVendors.map(
                                  ({ vendor, existing, changes, lineNumber }) => (
                                    <div
                                      key={lineNumber}
                                      className="border rounded-lg p-3 bg-blue-50"
                                    >
                                      <div className="flex items-center gap-2 mb-2">
                                        <Badge variant="outline" className="bg-blue-600 text-white">
                                          UPDATE
                                        </Badge>
                                        <span className="font-semibold">{existing.company}</span>
                                      </div>
                                      <div className="text-sm space-y-1 ml-6">
                                        {changes.map((change, idx) => (
                                          <div key={idx} className="text-muted-foreground">
                                            • {change}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex justify-end gap-2 pt-4 border-t">
                          <Button
                            variant="outline"
                            onClick={() => {
                              setShowImportPreview(false);
                              setImportPreviewData(null);
                            }}
                          >
                            Cancel
                          </Button>
                          <Button onClick={handleConfirmImport} disabled={importing}>
                            {importing ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Importing...
                              </>
                            ) : (
                              'Confirm Import'
                            )}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>

                    <Dialog open={vendorDialog} onOpenChange={setVendorDialog}>
                    <DialogTrigger asChild>
                      <Button onClick={() => {
                        setEditingVendor(null);
                        setVendorForm({});
                        setFormErrors([]);
                        setLogoFile(null);
                        setLogoPreview(null);
                      }}>
                        <Plus size={16} className="mr-2" />
                        Add Vendor
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="@container max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
                      <DialogHeader>
                        <DialogTitle>
                          {editingVendor ? 'Edit Vendor' : 'Add New Vendor'}
                        </DialogTitle>
                        <DialogDescription>
                          {editingVendor ? 'Update vendor information' : 'Add a new vendor to your supplier database'}
                        </DialogDescription>
                      </DialogHeader>

                      <div className="flex-1 overflow-y-auto pr-2 -mr-2">
                        {formErrors.length > 0 && (
                          <Alert variant="destructive" className="mb-4">
                            <AlertDescription>
                              <ul className="list-disc list-inside">
                                {formErrors.map((error, index) => (
                                  <li key={index}>{error}</li>
                                ))}
                              </ul>
                            </AlertDescription>
                          </Alert>
                        )}

                        <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-4 pb-4">
                        <div className="space-y-2">
                          <Label htmlFor="vendorCompany">Company Name *</Label>
                          <Input
                            id="vendorCompany"
                            value={vendorForm.company || ''}
                            onChange={(e) => setVendorForm({...vendorForm, company: e.target.value})}
                            placeholder="Enter company name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="vendorEmail">Email</Label>
                          <Input
                            id="vendorEmail"
                            type="email"
                            value={vendorForm.email || ''}
                            onChange={(e) => setVendorForm({...vendorForm, email: e.target.value})}
                            placeholder="Enter email address"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="vendorPhone">Phone</Label>
                          <Input
                            id="vendorPhone"
                            value={vendorForm.phone || ''}
                            onChange={(e) => setVendorForm({...vendorForm, phone: e.target.value})}
                            placeholder="Enter phone number"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="vendorContact">Contact Person</Label>
                          <Input
                            id="vendorContact"
                            value={vendorForm.contactPerson || ''}
                            onChange={(e) => setVendorForm({...vendorForm, contactPerson: e.target.value})}
                            placeholder="Enter contact person name"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="website">Website</Label>
                          <Input
                            id="website"
                            value={vendorForm.website || ''}
                            onChange={(e) => setVendorForm({...vendorForm, website: e.target.value})}
                            placeholder="Enter website URL"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="gstNo">GST No</Label>
                          <div className="flex gap-2">
                            <Input
                              id="gstNo"
                              value={vendorForm.gstNo || ''}
                              onChange={(e) => {
                                const gstNo = e.target.value.toUpperCase();
                                setVendorForm({...vendorForm, gstNo});
                                // Auto-extract state code from GSTIN
                                if (gstNo.length >= 2) {
                                  const code = gstNo.substring(0, 2);
                                  if (INDIAN_STATE_CODES[code]) {
                                    setVendorForm(prev => ({
                                      ...prev,
                                      gstNo,
                                      stateCode: code,
                                      stateName: INDIAN_STATE_CODES[code]
                                    }));
                                  }
                                }
                              }}
                              placeholder="e.g., 29ABCDE1234F1Z5"
                              maxLength={15}
                              className="flex-1"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={handleVerifyGST}
                              disabled={verifyingGST || !vendorForm.gstNo}
                            >
                              {verifyingGST ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                'Verify'
                              )}
                            </Button>
                          </div>
                          {vendorForm.stateCode && (
                            <p className="text-xs text-muted-foreground">
                              State: {vendorForm.stateCode} - {vendorForm.stateName || INDIAN_STATE_CODES[vendorForm.stateCode]}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label>Company Logo</Label>
                          <div className="flex items-center gap-4">
                            {logoPreview && (
                              <div className="relative">
                                <img 
                                  src={logoPreview} 
                                  alt="Logo preview"
                                  className="w-16 h-16 object-contain border rounded"
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="destructive"
                                  className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
                                  onClick={clearLogo}
                                >
                                  <X size={14} />
                                </Button>
                              </div>
                            )}
                            <div className="flex-1">
                              <Input
                                type="file"
                                accept="image/*"
                                onChange={handleImageSelect}
                                className="cursor-pointer"
                              />
                              <p className="text-xs text-muted-foreground mt-1">
                                Upload a company logo (max 2MB, will be resized to 200x200px)
                              </p>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="paymentTerms">Payment Terms</Label>
                          <Select 
                            value={vendorForm.paymentTerms || 'Net 30'} 
                            onValueChange={(value) => setVendorForm({...vendorForm, paymentTerms: value})}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Net 15">Net 15</SelectItem>
                              <SelectItem value="Net 30">Net 30</SelectItem>
                              <SelectItem value="Net 45">Net 45</SelectItem>
                              <SelectItem value="Net 60">Net 60</SelectItem>
                              <SelectItem value="COD">Cash on Delivery</SelectItem>
                              <SelectItem value="Prepaid">Prepaid</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="leadTime">Lead Time</Label>
                          <Input
                            id="leadTime"
                            value={vendorForm.leadTime || ''}
                            onChange={(e) => setVendorForm({...vendorForm, leadTime: e.target.value})}
                            placeholder="e.g., 2 weeks"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="vendorType">Vendor Type</Label>
                          <Select 
                            value={vendorForm.type || 'Dealer'} 
                            onValueChange={(value) => {
                              // Clear makes field when switching to OEM since OEMs don't represent other makes
                              const updatedForm = {
                                ...vendorForm, 
                                type: value as 'OEM' | 'Dealer'
                              };
                              if (value === 'OEM') {
                                updatedForm.makes = [];
                              }
                              setVendorForm(updatedForm);
                            }}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="OEM">OEM</SelectItem>
                              <SelectItem value="Dealer">Dealer</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {/* Only show Makes/Brands field for Dealers */}
                        {vendorForm.type === 'Dealer' && (
                          <div className="space-y-2 col-span-2">
                            <Label>Distributed Brands</Label>
                            <div className="border rounded-md p-3 max-h-40 overflow-y-auto bg-background">
                              {brands.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No brands available. Add brands in the Brands tab first.</p>
                              ) : (
                                <div className="grid grid-cols-2 @2xl:grid-cols-3 gap-2">
                                  {[...brands].sort((a, b) => a.name.localeCompare(b.name)).map((brand) => (
                                    <div key={brand.id} className="flex items-center space-x-2">
                                      <input
                                        type="checkbox"
                                        id={`brand-${brand.id}`}
                                        checked={(vendorForm.distributedBrands || []).includes(brand.id)}
                                        onChange={(e) => {
                                          const currentBrands = vendorForm.distributedBrands || [];
                                          if (e.target.checked) {
                                            setVendorForm({
                                              ...vendorForm,
                                              distributedBrands: [...currentBrands, brand.id]
                                            });
                                          } else {
                                            setVendorForm({
                                              ...vendorForm,
                                              distributedBrands: currentBrands.filter(id => id !== brand.id)
                                            });
                                          }
                                        }}
                                        className="rounded border-gray-300"
                                      />
                                      <Label
                                        htmlFor={`brand-${brand.id}`}
                                        className="text-sm font-normal cursor-pointer"
                                      >
                                        {brand.name}
                                      </Label>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Select the brands this dealer distributes (from Brands tab)
                            </p>
                          </div>
                        )}

                        {/* BOM Categories */}
                        <div className="space-y-2 col-span-2">
                          <Label>BOM Categories</Label>
                          <div className="border rounded-md p-3 max-h-32 overflow-y-auto bg-background">
                            {availableCategories.length === 0 ? (
                              <p className="text-sm text-muted-foreground">No categories available. Configure BOM settings first.</p>
                            ) : (
                              <div className="grid grid-cols-2 @2xl:grid-cols-3 gap-2">
                                {availableCategories.map((category) => (
                                  <div key={category} className="flex items-center space-x-2">
                                    <input
                                      type="checkbox"
                                      id={`category-${category}`}
                                      checked={(vendorForm.categories || []).includes(category)}
                                      onChange={(e) => {
                                        const currentCategories = vendorForm.categories || [];
                                        if (e.target.checked) {
                                          setVendorForm({
                                            ...vendorForm,
                                            categories: [...currentCategories, category]
                                          });
                                        } else {
                                          setVendorForm({
                                            ...vendorForm,
                                            categories: currentCategories.filter(cat => cat !== category)
                                          });
                                        }
                                      }}
                                      className="rounded border-gray-300"
                                    />
                                    <Label
                                      htmlFor={`category-${category}`}
                                      className="text-sm font-normal cursor-pointer"
                                    >
                                      {category}
                                    </Label>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Select the BOM categories this vendor supplies (e.g., Vision Systems, Cameras, Motors)
                          </p>
                        </div>

                        <div className="col-span-2 space-y-2">
                          <Label htmlFor="vendorAddress">Address</Label>
                          <Input
                            id="vendorAddress"
                            value={vendorForm.address || ''}
                            onChange={(e) => setVendorForm({...vendorForm, address: e.target.value})}
                            placeholder="Enter complete address"
                          />
                        </div>
                        <div className="col-span-2 space-y-2">
                          <Label htmlFor="vendorNotes">Notes</Label>
                          <Textarea
                            id="vendorNotes"
                            value={vendorForm.notes || ''}
                            onChange={(e) => setVendorForm({...vendorForm, notes: e.target.value})}
                            placeholder="Additional notes about the vendor"
                          />
                        </div>
                        </div>
                      </div>
                      
                      <div className="flex justify-end gap-2 mt-4 pt-4 border-t bg-background">
                        <Button
                          onClick={editingVendor ? handleUpdateVendor : handleAddVendor}
                          disabled={saving || uploadingLogo}
                        >
                          {(saving || uploadingLogo) && <Loader2 size={16} className="mr-2 animate-spin" />}
                          <Save size={16} className="mr-2" />
                          {uploadingLogo ? 'Uploading Logo...' : `${editingVendor ? 'Update' : 'Add'} Vendor`}
                        </Button>
                        <Button variant="outline" onClick={() => setVendorDialog(false)}>
                          Cancel
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                  </div>
                </div>
                
                {/* Import Results */}
                {importResults && (
                  <div className="mt-4">
                    <Alert variant={importResults.errors.length > 0 ? "destructive" : "default"}>
                      <AlertDescription>
                        <div className="space-y-2">
                          <div className="font-medium">
                            Import completed: {importResults.success} vendors added successfully
                          </div>
                          {importResults.errors?.length > 0 && (
                            <div>
                              <div className="font-medium text-red-600 mb-2">
                                {importResults.errors?.length || 0} errors occurred:
                              </div>
                              <ul className="list-disc list-inside text-sm space-y-1 max-h-32 overflow-y-auto">
                                {importResults.errors?.map((error, index) => (
                                  <li key={index}>{error}</li>
                                )) || []}
                              </ul>
                            </div>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setImportResults(null)}
                          >
                            Dismiss
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                {/* Search and Filter Controls */}
                <div className="flex flex-col @md:flex-row gap-4 mb-4">
                  <div className="flex-1 relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                      placeholder="Search vendors by name, email, contact, or makes..."
                      value={vendorSearch}
                      onChange={(e) => setVendorSearch(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  <div className="@md:w-64">
                    <select
                      value={vendorCategoryFilter}
                      onChange={(e) => setVendorCategoryFilter(e.target.value)}
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                    >
                      <option value="all">All Categories</option>
                      {availableCategories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {filteredVendors.length === 0 ? (
                  <div className="text-center py-8">
                    {vendors.length === 0 ? (
                      <>
                        <ShoppingCart className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                        <p className="text-gray-500">No vendors added yet</p>
                        <p className="text-gray-400 text-sm">Add your first vendor to get started</p>
                      </>
                    ) : (
                      <>
                        <Search className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                        <p className="text-gray-500">No vendors match your search</p>
                        <p className="text-gray-400 text-sm">Try adjusting your search or filters</p>
                      </>
                    )}
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Contact Info</TableHead>
                        <TableHead>GST No</TableHead>
                        <TableHead>Categories</TableHead>
                        <TableHead>Terms</TableHead>
                        <TableHead>Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredVendors.map((vendor) => (
                        <TableRow key={vendor.id}>
                          <TableCell>
                            <div className="flex items-center space-x-3">
                              {vendor.logo && (
                                <img 
                                  src={vendor.logo} 
                                  alt={`${vendor.company} logo`}
                                  className="w-8 h-8 object-contain rounded"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                  }}
                                />
                              )}
                              <div className="font-medium">{vendor.company}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={vendor.type === 'OEM' ? 'default' : 'secondary'} className="text-xs">
                              {vendor.type || 'Dealer'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              {vendor.email && (
                                <div className="flex items-center gap-1 text-sm">
                                  <Mail size={12} />
                                  {vendor.email}
                                </div>
                              )}
                              {vendor.phone && (
                                <div className="flex items-center gap-1 text-sm">
                                  <Phone size={12} />
                                  {vendor.phone}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm font-mono">
                              {vendor.gstNo || '-'}
                            </span>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {vendor.categories && vendor.categories.length > 0 ? (
                                <>
                                  {vendor.categories.slice(0, 2).map((category, index) => (
                                    <Badge key={index} variant="outline" className="text-xs">
                                      {category}
                                    </Badge>
                                  ))}
                                  {vendor.categories.length > 2 && (
                                    <Badge variant="outline" className="text-xs">
                                      +{vendor.categories.length - 2}
                                    </Badge>
                                  )}
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1 text-sm">
                              <div>{vendor.paymentTerms}</div>
                              <div className="text-muted-foreground">{vendor.leadTime}</div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEditVendor(vendor)}
                              >
                                <Edit size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleDeleteVendor(vendor.id)}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* BOM Settings Tab */}
          <TabsContent value="bom">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Default Categories</CardTitle>
                  <CardDescription>Manage default BOM categories</CardDescription>
                </CardHeader>
                <CardContent>
                  {bomSettings && (
                    <>
                      <div className="flex flex-wrap gap-2 mb-4">
                        {(bomSettings.categories || [])
                          .filter(cat => !cat.parentId)
                          .map((category) => (
                            <div key={category.id} className="flex items-center gap-1 bg-secondary text-secondary-foreground px-3 py-1 rounded-full">
                              {editingCategoryId === category.id ? (
                                <>
                                  <Input
                                    autoFocus
                                    value={categoryDraft}
                                    onChange={(e) => setCategoryDraft(e.target.value)}
                                    className="h-8 w-32 text-sm"
                                  />
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => renameCategory(category.id, categoryDraft)}
                                  >
                                    <Check size={14} />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => {
                                      setEditingCategoryId(null);
                                      setCategoryDraft('');
                                    }}
                                  >
                                    <X size={14} />
                                  </Button>
                                </>
                              ) : (
                                <>
                                  <span className="text-sm font-medium">{category.name}</span>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => {
                                      setEditingCategoryId(category.id);
                                      setCategoryDraft(category.name);
                                      setError(null);
                                    }}
                                  >
                                    <Edit size={14} />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-red-600 hover:text-red-700"
                                    onClick={() => removeCategory(category.id)}
                                  >
                                    <Trash2 size={14} />
                                  </Button>
                                </>
                              )}
                            </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Input 
                          placeholder="Add new category" 
                          id="newCategory"
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') {
                              const input = e.target as HTMLInputElement;
                              if (input.value.trim()) {
                                addCategory(input.value.trim());
                                input.value = '';
                              }
                            }
                          }}
                        />
                        <Button onClick={() => {
                          const input = document.getElementById('newCategory') as HTMLInputElement;
                          if (input.value.trim()) {
                            addCategory(input.value.trim());
                            input.value = '';
                          }
                        }}>
                          <Plus size={16} />
                        </Button>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>BOM Workflow Settings</CardTitle>
                  <CardDescription>Configure BOM approval and quotation settings</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {bomSettings && (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label>Auto-approval for orders</Label>
                          <p className="text-sm text-muted-foreground">Automatically approve orders from trusted vendors</p>
                        </div>
                        <Switch
                          checked={bomSettings.autoApprovalEnabled}
                          onCheckedChange={(checked) => 
                            setBomSettings({...bomSettings, autoApprovalEnabled: checked})
                          }
                        />
                      </div>
                      <Separator />
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <Label>Require vendor quotes</Label>
                          <p className="text-sm text-muted-foreground">Require quotes before placing orders</p>
                        </div>
                        <Switch
                          checked={bomSettings.requireVendorQuotes}
                          onCheckedChange={(checked) => 
                            setBomSettings({...bomSettings, requireVendorQuotes: checked})
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Minimum vendor quotes required</Label>
                        <Select 
                          value={bomSettings.minimumVendorQuotes.toString()} 
                          onValueChange={(value) => 
                            setBomSettings({...bomSettings, minimumVendorQuotes: parseInt(value)})
                          }
                        >
                          <SelectTrigger className="w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1</SelectItem>
                            <SelectItem value="2">2</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="4">4</SelectItem>
                            <SelectItem value="5">5</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Cost calculation method</Label>
                        <Select 
                          value={bomSettings.costCalculationMethod} 
                          onValueChange={(value: 'average' | 'lowest' | 'selected') => 
                            setBomSettings({...bomSettings, costCalculationMethod: value})
                          }
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="average">Average of quotes</SelectItem>
                            <SelectItem value="lowest">Lowest quote</SelectItem>
                            <SelectItem value="selected">Selected vendor only</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button 
                        className="flex items-center gap-2"
                        onClick={handleSaveBOMSettings}
                        disabled={saving}
                      >
                        {saving && <Loader2 size={16} className="animate-spin" />}
                        <Save size={16} />
                        Save BOM Settings
                      </Button>
                    </>
                  )}
                </CardContent>
              </Card>

              {/* BOM Templates Section */}
              <BOMTemplatesTab bomSettings={bomSettings} />
            </div>
          </TabsContent>

          {/* Purchase Request Settings Tab */}
          <TabsContent value="purchase-request">
            <Card>
              <CardHeader>
                <CardTitle>Purchase Request Email Settings</CardTitle>
                <CardDescription>
                  Configure email recipients and company information for purchase requests
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Company Name */}
                <div className="space-y-2">
                  <Label htmlFor="prCompanyName">Company Name *</Label>
                  <Input
                    id="prCompanyName"
                    value={prCompanyName}
                    onChange={(e) => setPRCompanyName(e.target.value)}
                    placeholder="Enter company name"
                  />
                  <p className="text-xs text-muted-foreground">
                    This will appear in the email header
                  </p>
                </div>

                {/* Sender Email */}
                <div className="space-y-2">
                  <Label htmlFor="prFromEmail">Sender Email Address *</Label>
                  <Input
                    id="prFromEmail"
                    type="email"
                    value={prFromEmail}
                    onChange={(e) => setPRFromEmail(e.target.value)}
                    placeholder="info@qualitastech.com"
                  />
                  <p className="text-xs text-muted-foreground">
                    Must be verified in SendGrid. Emails will be sent from this address.
                  </p>
                </div>

                <Separator />

                {/* Email Recipients */}
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="prRecipients">Email Recipients *</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      Internal emails for supply chain and accounts team to receive purchase requests
                    </p>
                  </div>

                  {/* Add Email Input */}
                  <div className="flex gap-2">
                    <Input
                      id="prRecipients"
                      type="email"
                      value={prEmailInput}
                      onChange={(e) => setPREmailInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddPRRecipient();
                        }
                      }}
                      placeholder="Enter email address"
                    />
                    <Button
                      type="button"
                      onClick={handleAddPRRecipient}
                      variant="outline"
                    >
                      <Plus size={16} className="mr-2" />
                      Add
                    </Button>
                  </div>

                  {/* Error Display */}
                  {prError && (
                    <Alert variant="destructive">
                      <AlertDescription>{prError}</AlertDescription>
                    </Alert>
                  )}

                  {/* Recipients List */}
                  {prRecipients.length > 0 && (
                    <div className="space-y-2">
                      <Label>Added Recipients ({prRecipients.length})</Label>
                      <div className="space-y-2">
                        {prRecipients.map((email, index) => (
                          <div
                            key={index}
                            className="flex items-center justify-between p-3 border rounded-lg bg-muted/50"
                          >
                            <div className="flex items-center gap-2">
                              <Mail size={16} className="text-muted-foreground" />
                              <span>{email}</span>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemovePRRecipient(email)}
                            >
                              <X size={16} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {prRecipients.length === 0 && (
                    <Alert>
                      <Mail className="h-4 w-4" />
                      <AlertDescription>
                        No recipients added yet. Add at least one email address to receive purchase requests.
                      </AlertDescription>
                    </Alert>
                  )}
                </div>

                <Separator />

                {/* Save Button */}
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={handleSavePRSettings}
                    disabled={prSaving || prRecipients.length === 0 || !prCompanyName.trim()}
                  >
                    {prSaving ? (
                      <>
                        <Loader2 size={16} className="mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save size={16} className="mr-2" />
                        Save Settings
                      </>
                    )}
                  </Button>
                </div>

                {/* Help Text */}
                <Alert>
                  <Mail className="h-4 w-4" />
                  <AlertDescription>
                    <strong>How it works:</strong> When users create a purchase request from the BOM page,
                    an email will be sent to all recipients listed above with the grouped BOM items by vendor.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Communications Tab */}
          <TabsContent value="communications">
            <GmailConnectionsTab />
          </TabsContent>

          {/* Brands Tab */}
          <TabsContent value="brands">
            <BrandsTab />
          </TabsContent>

          {/* Users Tab */}
          <TabsContent value="users">
            <Card>
              <CardHeader>
                <div className="flex justify-between items-center">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Shield size={20} />
                      User Administration
                    </CardTitle>
                    <CardDescription>Manage user roles and permissions</CardDescription>
                  </div>
                  <Button variant="outline" onClick={loadUsers} disabled={usersLoading}>
                    {usersLoading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      'Refresh'
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {usersLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                ) : appUsers.length === 0 ? (
                  <div className="text-center py-8">
                    <UserCog className="mx-auto h-12 w-12 text-gray-400 mb-4" />
                    <p className="text-gray-500">No users found</p>
                    <p className="text-gray-400 text-sm">Click Refresh to load users</p>
                  </div>
                ) : (() => {
                  const internalUsers = appUsers.filter(u => validateEngineerEmail(u.email));
                  const externalPartners = appUsers.filter(u => !validateEngineerEmail(u.email));

                  const renderStatusBadge = (appUser: AppUser) => (
                    <Badge
                      variant={appUser.status === 'approved' ? 'default' : 'secondary'}
                      className={
                        appUser.status === 'approved'
                          ? 'bg-green-100 text-green-800'
                          : appUser.status === 'rejected'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }
                    >
                      {appUser.status || 'pending'}
                    </Badge>
                  );

                  const renderActions = (appUser: AppUser) => (
                    <div className="flex items-center gap-2">
                      {(appUser.status === 'pending' || !appUser.status) && appUser.uid !== user?.uid && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-green-600 border-green-600 hover:bg-green-50"
                            onClick={() => handleApproveUser(appUser.uid)}
                            disabled={updatingUserId === appUser.uid}
                          >
                            <Check size={14} className="mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-red-600 border-red-600 hover:bg-red-50"
                            onClick={() => handleRejectUser(appUser.uid)}
                            disabled={updatingUserId === appUser.uid}
                          >
                            <X size={14} className="mr-1" />
                            Reject
                          </Button>
                        </>
                      )}
                      {(appUser.status === 'approved' || appUser.status === 'rejected') && appUser.uid !== user?.uid && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-red-600 hover:bg-red-50"
                          onClick={() => handleDeleteUser(appUser.uid, appUser.email)}
                          disabled={updatingUserId === appUser.uid}
                        >
                          <Trash2 size={14} className="mr-1" />
                          Delete
                        </Button>
                      )}
                      {appUser.uid === user?.uid && (
                        <span className="text-xs text-gray-400">You</span>
                      )}
                    </div>
                  );

                  return (
                    <div className="space-y-8">
                      {/* Internal Team */}
                      {internalUsers.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Building size={15} className="text-gray-500" />
                            <span className="text-sm font-semibold text-gray-700">Internal Team</span>
                            <Badge variant="outline" className="text-xs">{internalUsers.length}</Badge>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>User</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Admin</TableHead>
                                <TableHead className="text-right">Rate (₹/hr)</TableHead>
                                <TableHead>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {internalUsers.map((appUser) => (
                                <TableRow key={appUser.uid}>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <User size={16} className="text-gray-400" />
                                      <span className="font-medium">{appUser.displayName || 'No name'}</span>
                                      {appUser.uid === user?.uid && <Badge variant="outline" className="text-xs">You</Badge>}
                                    </div>
                                  </TableCell>
                                  <TableCell><span className="text-sm text-gray-600">{appUser.email}</span></TableCell>
                                  <TableCell>{renderStatusBadge(appUser)}</TableCell>
                                  <TableCell>
                                    <Badge variant={appUser.role === 'admin' ? 'default' : 'outline'} className={appUser.role === 'admin' ? 'bg-blue-600' : ''}>
                                      {appUser.role === 'admin' ? 'admin' : 'internal'}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <Switch
                                        checked={appUser.role === 'admin'}
                                        onCheckedChange={() => handleToggleAdmin(appUser.uid, appUser.role)}
                                        disabled={updatingUserId === appUser.uid || appUser.uid === user?.uid}
                                      />
                                      {updatingUserId === appUser.uid && <Loader2 size={14} className="animate-spin" />}
                                      {appUser.uid === user?.uid && <span className="text-xs text-gray-400">Can't modify self</span>}
                                    </div>
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {(() => {
                                      const rate = engineerRates[appUser.email.toLowerCase()];
                                      const isEditing = editingRateEmail === appUser.email;
                                      const isSaving = savingRateEmail === appUser.email;
                                      if (isEditing) {
                                        return (
                                          <div className="flex items-center gap-1 justify-end">
                                            <Input
                                              type="number"
                                              min="0"
                                              autoFocus
                                              className="h-7 w-24 text-right"
                                              value={rateDraft}
                                              onChange={(e) => setRateDraft(e.target.value)}
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleSaveRate(appUser);
                                                if (e.key === 'Escape') cancelEditRate();
                                              }}
                                              disabled={isSaving}
                                            />
                                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => handleSaveRate(appUser)} disabled={isSaving}>
                                              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                                            </Button>
                                            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={cancelEditRate} disabled={isSaving}>
                                              <X size={14} />
                                            </Button>
                                          </div>
                                        );
                                      }
                                      return (
                                        <button type="button" className="text-sm hover:underline" onClick={() => startEditRate(appUser.email)} title="Click to edit rate">
                                          {rate ? `₹${rate.hourlyRate.toLocaleString('en-IN')}` : <span className="text-gray-400">— set</span>}
                                        </button>
                                      );
                                    })()}
                                  </TableCell>
                                  <TableCell>{renderActions(appUser)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}

                      {/* External Partners */}
                      {externalPartners.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-3">
                            <Users size={15} className="text-purple-500" />
                            <span className="text-sm font-semibold text-purple-700">External Partners</span>
                            <Badge variant="outline" className="text-xs border-purple-300 text-purple-700">{externalPartners.length}</Badge>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Partner</TableHead>
                                <TableHead>Email</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Role</TableHead>
                                <TableHead>Actions</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {externalPartners.map((appUser) => (
                                <TableRow key={appUser.uid}>
                                  <TableCell>
                                    <div className="flex items-center gap-2">
                                      <User size={16} className="text-purple-400" />
                                      <span className="font-medium">{appUser.displayName || 'No name'}</span>
                                      {appUser.uid === user?.uid && <Badge variant="outline" className="text-xs">You</Badge>}
                                    </div>
                                  </TableCell>
                                  <TableCell><span className="text-sm text-gray-600">{appUser.email}</span></TableCell>
                                  <TableCell>{renderStatusBadge(appUser)}</TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="border-purple-300 text-purple-700">partner</Badge>
                                  </TableCell>
                                  <TableCell>{renderActions(appUser)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <Alert className="mt-4">
                  <Shield className="h-4 w-4" />
                  <AlertDescription>
                    <strong>Admin privileges:</strong> Admins can access Settings, manage users, vendors, clients, and BOM settings.
                    Regular users can only view and work with projects assigned to them.
                  </AlertDescription>
                </Alert>
              </CardContent>
            </Card>
          </TabsContent>

          {/* General Settings Tab */}
          <TabsContent value="general">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Application Preferences</CardTitle>
                  <CardDescription>General application settings and preferences</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Default Currency</Label>
                    <Select defaultValue="USD">
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD ($)</SelectItem>
                        <SelectItem value="EUR">EUR (€)</SelectItem>
                        <SelectItem value="GBP">GBP (£)</SelectItem>
                        <SelectItem value="INR">INR (₹)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Date Format</Label>
                    <Select defaultValue="MM/DD/YYYY">
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                        <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Time Zone</Label>
                    <Select defaultValue="UTC">
                      <SelectTrigger className="w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="UTC">UTC</SelectItem>
                        <SelectItem value="EST">Eastern Time</SelectItem>
                        <SelectItem value="PST">Pacific Time</SelectItem>
                        <SelectItem value="IST">India Standard Time</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button className="flex items-center gap-2">
                    <Save size={16} />
                    Save General Settings
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>n8n Webhook Configuration</CardTitle>
                  <CardDescription>Configure webhooks for automation workflows</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="raise-pr-webhook">Raise PR Webhook URL</Label>
                    <Input
                      id="raise-pr-webhook"
                      placeholder="https://your-n8n-instance.com/webhook/raise-pr"
                    />
                    <p className="text-xs text-muted-foreground">Triggered when user wants to raise a Purchase Order</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="add-bom-webhook">Add BOM Item Webhook URL</Label>
                    <Input
                      id="add-bom-webhook"
                      placeholder="https://your-n8n-instance.com/webhook/bom-item-added"
                    />
                    <p className="text-xs text-muted-foreground">Triggered when a new BOM item is added</p>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="add-vendor-webhook">Add Vendor Webhook URL</Label>
                    <Input
                      id="add-vendor-webhook"
                      placeholder="https://your-n8n-instance.com/webhook/vendor-added"
                    />
                    <p className="text-xs text-muted-foreground">Triggered when a new vendor is added</p>
                  </div>
                  
                  <Button className="flex items-center gap-2">
                    <Save size={16} />
                    Save Webhook Settings
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Data Management</CardTitle>
                  <CardDescription>Backup and export options</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-4">
                    <Button variant="outline">
                      Export All Data
                    </Button>
                    <Button variant="outline">
                      Create Backup
                    </Button>
                    <Button variant="outline">
                      Import Data
                    </Button>
                  </div>
                  <div className="p-4 border rounded-lg border-red-200 bg-red-50">
                    <h4 className="font-medium mb-2 text-red-900">Danger Zone</h4>
                    <p className="text-sm text-red-700 mb-4">
                      Permanently delete all data. This action cannot be undone.
                    </p>
                    <Button variant="destructive" size="sm">
                      Delete All Data
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;
