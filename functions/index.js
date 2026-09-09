/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const functions = require("firebase-functions");
const {onRequest, onCall} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const {defineSecret} = require("firebase-functions/params");
const admin = require("firebase-admin");
const { Resend } = require("resend");
const pdfParse = require("pdf-parse");
const PDFDocument = require("pdfkit");
const {
  drawSupportQuotationHeader,
  getBillingEntityDisplayName,
} = require("./supportQuotationPdfLayout");
const {
  buildFallbackDraft,
  collectMissingRecords,
  prepareSupportFollowUpWithGemini,
  resolveRecipients,
} = require('./supportEngineerFollowUp');
const {
  verifySvixSignature,
  normalizeFathomPayload,
  collectMatchedProjectIds,
  extractClientContactEmails,
  computeProjectStakeholderEmails,
  diffEmailSets,
} = require('./fathomMeeting');
const {
  exchangeAuthCodeForTokens,
  refreshAccessToken,
  listNewGmailMessageIds,
  getGmailMessage,
  parseGmailMessage,
  hasExternalParticipant,
  filterExternalParticipants,
  classifyDirection,
  sanitizeEmailBody,
} = require('./emailIngestion');

// Use built-in fetch in Node.js 22
const fetch = globalThis.fetch;

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

// Define secrets
const openaiApiKeySecret = defineSecret('OPENAI_API_KEY');
const geminiApiKeySecret = defineSecret('GEMINI_API_KEY');
const resendApiKey = defineSecret('RESEND_API_KEY');
const pulseApiKey = defineSecret('PULSE_API_KEY');
const fathomWebhookSecret = defineSecret('FATHOM_WEBHOOK_SECRET');
const googleOAuthClientId = defineSecret('GOOGLE_OAUTH_CLIENT_ID');
const googleOAuthClientSecret = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');
const PULSE_BASE_URL = process.env.PULSE_BASE_URL || 'https://eagle-eye.qualitastech.com/pulse';

// Helper function to get Resend API key (works in both emulator and production)
const getResendApiKey = () => {
  try {
    const secretValue = resendApiKey.value();
    if (secretValue) return secretValue;
  } catch (error) {
    // Secret not available (likely in emulator)
  }
  // Fallback to environment variable for emulator/local testing
  return process.env.RESEND_API_KEY || '';
};

// For cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
functions.setGlobalOptions({ maxInstances: 10 });

// Secure AI BOM Analysis Function
// This function acts as a proxy to OpenAI, keeping your API key secure on the server
exports.analyzeBOM = onRequest(
  { 
    secrets: [openaiApiKeySecret]
  },
  async (request, response) => {
  // Enable CORS for your frontend
  response.set('Access-Control-Allow-Origin', '*');
  response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.set('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (request.method === 'OPTIONS') {
    response.status(204).send('');
    return;
  }

  // Only allow POST requests
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed. Use POST.' });
    return;
  }

  try {
    const { text, existingCategories, existingMakes, prompt } = request.body;

    // Validate input
    if (!text || typeof text !== 'string') {
      response.status(400).json({ error: 'Text content is required' });
      return;
    }

    // Get OpenAI API key from secrets (Firebase Functions v2)
    const openaiApiKey = openaiApiKeySecret.value();
    if (!openaiApiKey) {
      logger.error('OpenAI API key not configured in secrets');
      response.status(500).json({ error: 'AI service not configured - missing OPENAI_API_KEY secret' });
      return;
    }

    // Use optimized prompt if provided, otherwise create an intelligent one
    const systemPrompt = prompt || `You are a BOM (Bill of Materials) extraction expert. Analyze the input text and extract items intelligently.

INTELLIGENCE RULES:
1. DETECT FORMAT: CSV, table, list, or structured text
2. For CSV: Parse columns correctly - identify which column contains what data
3. For your input like "1,XG-X2800,3D Controller - Inline 3D Image Processing System,KEYENCE,4,,,"85299090"
   - Column 1: Item number/sequence 
   - Column 2: Part number/SKU (XG-X2800)
   - Column 3: Description/Name (3D Controller - Inline 3D Image Processing System)  
   - Column 4: Manufacturer/Make (KEYENCE)
   - Column 5: Quantity (4)
   - Later columns: Additional info

EXTRACTION LOGIC:
- Use the LONGEST descriptive text as the item name
- Extract manufacturer/brand from dedicated columns or within text
- Match manufacturers to existing: ${existingMakes?.join(', ') || 'KEYENCE, Siemens, Omron, Allen Bradley, Schneider'}
- Categorize using: ${existingCategories?.join(', ') || 'Vision Systems, Control Systems, Motors & Drives, Sensors, Mechanical, Electrical'}
- Detect services (engineering, installation, commissioning, consulting, mandays) as itemType: "service"
- For services, use mandays/days as quantity and unit "days"
- Extract price/rate when present:
  - Components: unit price
  - Services: rate per day
- For vision/camera equipment → "Vision Systems"
- For controllers/PLCs → "Control Systems"

STRICT JSON OUTPUT:
{
  "items": [
    {
      "name": "Primary item name (longest descriptive text)",
      "itemType": "component or service",
      "make": "Exact manufacturer name or null", 
      "description": "Full description",
      "sku": "Part number/model or null",
      "quantity": number,
      "price": number or null,
      "category": "Best matching category",
      "unit": "pcs for components, days for services"
    }
  ],
  "totalItems": number
}

CRITICAL: Return ONLY valid JSON. No explanation text.`;

    const userPrompt = `Extract BOM items from this text:

${text}`;

    // Call OpenAI API
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' }
      })
    });

    if (!openaiResponse.ok) {
      const errorData = await openaiResponse.json().catch(() => ({}));
      logger.error('OpenAI API error:', errorData);
      response.status(openaiResponse.status).json({ 
        error: `AI service error: ${errorData.error?.message || 'Unknown error'}` 
      });
      return;
    }

    const data = await openaiResponse.json();
    const aiResponse = data.choices[0]?.message?.content;
    
    if (!aiResponse) {
      response.status(500).json({ error: 'No response from AI service' });
      return;
    }

    // Parse and validate the AI response
    let parsedResponse;
    try {
      parsedResponse = JSON.parse(aiResponse);
    } catch (parseError) {
      logger.error('Failed to parse AI response:', aiResponse);
      response.status(500).json({ error: 'Invalid response from AI service' });
      return;
    }

    // Validate response structure
    if (!parsedResponse.items || !Array.isArray(parsedResponse.items)) {
      response.status(500).json({ error: 'Invalid response format from AI service' });
      return;
    }

    // Transform and validate items
    const parseNumericValue = (value) => {
      if (value === null || value === undefined || value === '') return undefined;
      const normalized = String(value).replace(/[,\s]/g, '').replace(/[^\d.]/g, '');
      if (!normalized) return undefined;
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const items = parsedResponse.items.map((item, index) => {
      // Clean and validate make field to prevent concatenation issues
      let cleanMake = undefined;
      if (item.make && typeof item.make === 'string') {
        // Remove any repeated patterns and trim
        cleanMake = item.make
          .replace(/(.+?)\1+/g, '$1') // Remove repeated patterns like "KEYENCEKEYENCE" -> "KEYENCE"
          .trim()
          .substring(0, 50); // Limit length to prevent UI issues
        
        // If empty after cleaning, set to undefined
        if (!cleanMake || cleanMake.length === 0) {
          cleanMake = undefined;
        }
      }

      const itemType = item.itemType === 'service' ? 'service' : 'component';
      const parsedQuantity = parseNumericValue(item.quantity);
      const minimumQuantity = itemType === 'service' ? 0.5 : 1;
      const quantity = parsedQuantity && parsedQuantity > 0 ? parsedQuantity : minimumQuantity;
      const unit = item.unit || (itemType === 'service' ? 'days' : 'pcs');
      const price = parseNumericValue(item.price);

      return {
        name: item.name || `Item ${index + 1}`,
        itemType,
        make: cleanMake,
        description: item.description || item.name || 'No description provided',
        sku: item.sku || undefined,
        quantity,
        price,
        category: item.category || 'Uncategorized',
        unit,
        specifications: item.specifications || undefined
      };
    });

    const result = {
      items,
      totalItems: items.length,
      processingTime: 0 // Will be calculated by frontend
    };

    // Log successful analysis
    logger.info('BOM analysis completed successfully', {
      textLength: text.length,
      itemsCount: items.length,
      makesFound: items.filter(item => item.make).length
    });

    response.status(200).json(result);

  } catch (error) {
    logger.error('Error in BOM analysis:', error);
    response.status(500).json({ 
      error: 'Internal server error during AI analysis' 
    });
  }
});

// Health check endpoint
exports.health = onRequest((request, response) => {
  response.set('Access-Control-Allow-Origin', '*');
  response.json({ 
    status: 'healthy', 
    service: 'BOM AI Analysis',
    timestamp: new Date().toISOString()
  });
});

// ==================== USER MANAGEMENT FUNCTIONS ====================

// One-time function to bootstrap the first admin user
exports.bootstrapAdmin = onCall(async (request) => {
  const { data } = request;
  const { email, adminKey } = data;
  
  // Simple security check - replace with your own secret
  if (adminKey !== 'QualitasTech2025Bootstrap') {
    throw new Error('Invalid admin key');
  }
  
  try {
    // Find user by email
    const userRecord = await admin.auth().getUserByEmail(email);
    
    // Set admin claims
    await admin.auth().setCustomUserClaims(userRecord.uid, {
      role: 'admin',
      status: 'approved',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      bootstrapped: true
    });
    
    logger.info('Admin user bootstrapped', { uid: userRecord.uid, email });
    
    return { 
      success: true, 
      message: `Admin user ${email} has been approved`,
      uid: userRecord.uid
    };
    
  } catch (error) {
    logger.error('Error bootstrapping admin:', error);
    throw new Error(`Failed to bootstrap admin: ${error.message}`);
  }
});

// Setup new user after authentication (called from frontend)
exports.setupNewUser = onCall(async (request) => {
  const { auth } = request;
  
  if (!auth) {
    throw new Error('Authentication required');
  }
  
  try {
    const user = await admin.auth().getUser(auth.uid);
    
    // Check if user already has custom claims set
    if (user.customClaims && user.customClaims.role) {
      return { success: true, message: 'User already set up' };
    }
    
    // Check if user is from qualitastech.com domain for auto-approval
    const isQualitasUser = user.email && user.email.endsWith('@qualitastech.com');
    
    let userStatus = 'pending';
    let userRole = 'user';
    let message = 'User setup completed. Waiting for admin approval.';
    
    if (isQualitasUser) {
      userStatus = 'approved';
      message = 'User setup completed. Access granted automatically for Qualitas domain.';
      
      // Check if this is the first qualitastech user - make them admin
      const existingAdmins = await admin.auth().listUsers(1000);
      const hasAdmin = existingAdmins.users.some(u => 
        u.customClaims && u.customClaims.role === 'admin' && u.customClaims.status === 'approved'
      );
      
      if (!hasAdmin) {
        userRole = 'admin';
        message = 'User setup completed. First Qualitas user - granted admin access.';
      }
    }
    
    // Set custom claims based on domain
    await admin.auth().setCustomUserClaims(auth.uid, {
      role: userRole,
      status: userStatus,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      autoApproved: isQualitasUser
    });
    
    logger.info('New user created', { 
      uid: auth.uid, 
      email: user.email,
      role: userRole,
      status: userStatus,
      autoApproved: isQualitasUser
    });
    
    // Only create user request if manual approval needed
    if (!isQualitasUser) {
      await admin.firestore().collection('userRequests').doc(auth.uid).set({
        uid: auth.uid,
        email: user.email,
        displayName: user.displayName || '',
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    return { 
      success: true, 
      message: message,
      autoApproved: isQualitasUser,
      role: userRole
    };
    
  } catch (error) {
    logger.error('Error setting up new user:', error);
    throw new Error('Failed to setup user');
  }
});

// Admin function to approve/reject users
exports.manageUserStatus = onCall(async (request) => {
  const { auth, data } = request;
  
  // Check if caller is authenticated
  if (!auth) {
    throw new Error('Authentication required');
  }
  
  // Get caller's custom claims to verify admin status
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }
  
  const { targetUid, action, role = 'user' } = data;
  
  if (!targetUid || !action) {
    throw new Error('targetUid and action are required');
  }
  
  try {
    let newClaims = {};
    
    switch (action) {
      case 'approve':
        newClaims = {
          role,
          status: 'approved',
          approvedAt: admin.firestore.FieldValue.serverTimestamp(),
          approvedBy: auth.uid
        };
        break;
        
      case 'reject':
        newClaims = {
          role: 'user',
          status: 'rejected',
          rejectedAt: admin.firestore.FieldValue.serverTimestamp(),
          rejectedBy: auth.uid
        };
        break;
        
      case 'suspend':
        // Get current user claims for suspend action
        const targetRecord = await admin.auth().getUser(targetUid);
        newClaims = {
          ...targetRecord.customClaims,
          status: 'suspended',
          suspendedAt: admin.firestore.FieldValue.serverTimestamp(),
          suspendedBy: auth.uid
        };
        break;
        
      case 'updateRole':
        if (!['admin', 'user', 'viewer'].includes(role)) {
          throw new Error('Invalid role');
        }
        // Get current user claims for role update
        const targetRecordForRole = await admin.auth().getUser(targetUid);
        newClaims = {
          ...targetRecordForRole.customClaims,
          role,
          // When setting admin role, also ensure status is approved
          // (can't be admin without being approved)
          status: role === 'admin' ? 'approved' : (targetRecordForRole.customClaims?.status || 'approved'),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: auth.uid
        };
        break;
        
      default:
        throw new Error('Invalid action');
    }
    
    // Update custom claims
    await admin.auth().setCustomUserClaims(targetUid, newClaims);
    
    // Update user request status if document exists (use set with merge to avoid NOT_FOUND error)
    if (action === 'approve' || action === 'reject') {
      try {
        const docRef = admin.firestore().collection('userRequests').doc(targetUid);
        const doc = await docRef.get();
        if (doc.exists) {
          await docRef.update({
            status: action === 'approve' ? 'approved' : 'rejected',
            processedAt: admin.firestore.FieldValue.serverTimestamp(),
            processedBy: auth.uid
          });
        }
        // If document doesn't exist, that's fine - custom claims are already set
      } catch (firestoreError) {
        // Log but don't fail - the important part (custom claims) is already done
        logger.warn('Could not update userRequests document:', firestoreError.message);
      }
    }
    
    logger.info('User status updated successfully', {
      targetUid,
      action,
      role,
      adminUid: auth.uid
    });
    
    return { success: true, message: `User ${action}d successfully` };
    
  } catch (error) {
    logger.error('Error managing user status:', error);
    throw new Error(`Failed to ${action} user: ${error.message}`);
  }
});

// Get all pending user requests (admin only)
exports.getPendingUsers = onCall(async (request) => {
  const { auth } = request;
  
  if (!auth) {
    throw new Error('Authentication required');
  }
  
  // Verify admin status
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }
  
  try {
    const snapshot = await admin.firestore()
      .collection('userRequests')
      .where('status', '==', 'pending')
      .orderBy('createdAt', 'desc')
      .get();
    
    const pendingUsers = [];
    snapshot.forEach(doc => {
      pendingUsers.push({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()
      });
    });
    
    return { users: pendingUsers };

  } catch (error) {
    logger.error('Error getting pending users:', error);
    throw new Error('Failed to get pending users');
  }
});

// Delete a user (admin only)
exports.deleteUser = onCall({ cors: true }, async (request) => {
  const { auth, data } = request;

  if (!auth) {
    throw new Error('Authentication required');
  }

  // Verify admin status
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};

  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }

  const { targetUid } = data;

  if (!targetUid) {
    throw new Error('targetUid is required');
  }

  // Prevent self-deletion
  if (targetUid === auth.uid) {
    throw new Error('Cannot delete your own account');
  }

  try {
    // Delete user from Firebase Auth
    await admin.auth().deleteUser(targetUid);

    // Delete user request document if exists
    try {
      await admin.firestore().collection('userRequests').doc(targetUid).delete();
    } catch (e) {
      // Ignore if document doesn't exist
    }

    logger.info('User deleted successfully', {
      targetUid,
      deletedBy: auth.uid
    });

    return { success: true, message: 'User deleted successfully' };

  } catch (error) {
    logger.error('Error deleting user:', error);
    throw new Error(`Failed to delete user: ${error.message}`);
  }
});

// Get all users with their roles (admin only)
exports.getAllUsers = onCall(async (request) => {
  const { auth } = request;
  
  if (!auth) {
    throw new Error('Authentication required');
  }
  
  // Verify admin status
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }
  
  try {
    const listUsersResult = await admin.auth().listUsers(1000); // Max 1000 users
    
    const users = listUsersResult.users.map(userRecord => ({
      uid: userRecord.uid,
      email: userRecord.email,
      displayName: userRecord.displayName,
      photoURL: userRecord.photoURL,
      disabled: userRecord.disabled,
      lastSignInTime: userRecord.metadata.lastSignInTime,
      creationTime: userRecord.metadata.creationTime,
      customClaims: userRecord.customClaims || {}
    }));
    
    return { users };
    
  } catch (error) {
    logger.error('Error getting all users:', error);
    throw new Error('Failed to get users');
  }
});

// ==================== PURCHASE REQUEST FUNCTIONS ====================

// Helper function to group BOM items by vendor
const groupItemsByVendor = (categories, vendors) => {
  const vendorMap = new Map();

  // Create vendor lookup map
  vendors.forEach(vendor => {
    vendorMap.set(vendor.id, vendor);
  });

  // Group items by vendor
  const grouped = {};

  categories.forEach(category => {
    category.items.forEach(item => {
      // Get vendor information from finalizedVendor if available
      const vendorId = item.finalizedVendor?.id || 'unassigned';
      const vendorName = item.finalizedVendor?.name || 'Unassigned Vendor';

      if (!grouped[vendorId]) {
        const vendorInfo = vendorMap.get(vendorId) || {};
        grouped[vendorId] = {
          vendorId,
          vendorName,
          vendorEmail: vendorInfo.email || '',
          vendorPhone: vendorInfo.phone || '',
          vendorContact: vendorInfo.contactPerson || '',
          paymentTerms: vendorInfo.paymentTerms || '',
          leadTime: vendorInfo.leadTime || '',
          items: []
        };
      }

      grouped[vendorId].items.push({
        name: item.name,
        make: item.make || '',
        sku: item.sku || '',
        description: item.description || '',
        quantity: item.quantity,
        category: category.name,
        unitPrice: item.finalizedVendor?.price || null,
        linkedQuote: item.linkedQuote || null
      });
    });
  });

  return Object.values(grouped);
};

// Helper function to generate HTML email
const generatePREmailHTML = (data) => {
  const { projectDetails, groupedItems, companyName, requestedBy } = data;
  const date = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });

  let totalItems = 0;
  let totalEstimatedCost = 0;

  groupedItems.forEach(vendor => {
    totalItems += vendor.items.length;
    vendor.items.forEach(item => {
      if (item.unitPrice) {
        totalEstimatedCost += item.unitPrice * item.quantity;
      }
    });
  });

  const vendorSectionsHTML = groupedItems.map((vendor, index) => {
    const itemsHTML = vendor.items.map((item, itemIndex) => `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 12px 8px;">${itemIndex + 1}</td>
        <td style="padding: 12px 8px;"><strong>${item.name}</strong></td>
        <td style="padding: 12px 8px;">${item.make}</td>
        <td style="padding: 12px 8px;">${item.sku}</td>
        <td style="padding: 12px 8px;">${item.description}</td>
        <td style="padding: 12px 8px; text-align: center;">${item.quantity}</td>
        <td style="padding: 12px 8px;">${item.category}</td>
        ${item.unitPrice ? `<td style="padding: 12px 8px; text-align: right;">₹${item.unitPrice.toLocaleString('en-IN')}</td>` : '<td style="padding: 12px 8px; text-align: right;">-</td>'}
        <td style="padding: 12px 8px;">${item.linkedQuote ? `📄 <a href="${item.linkedQuote.url}" style="color: #0066cc; text-decoration: none;">${item.linkedQuote.name}</a>` : '-'}</td>
      </tr>
    `).join('');

    const subtotal = vendor.items.reduce((sum, item) => {
      return sum + (item.unitPrice ? item.unitPrice * item.quantity : 0);
    }, 0);

    return `
      <div style="border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin: 20px 0; background: #ffffff;">
        <h2 style="color: #0066cc; margin: 0 0 15px 0; font-size: 20px;">
          ${index + 1}. ${vendor.vendorName}
        </h2>
        <div style="background: #f8f9fa; padding: 12px; border-radius: 4px; margin-bottom: 15px;">
          ${vendor.vendorContact ? `<p style="margin: 4px 0;"><strong>Contact:</strong> ${vendor.vendorContact}</p>` : ''}
          ${vendor.vendorEmail ? `<p style="margin: 4px 0;"><strong>Email:</strong> ${vendor.vendorEmail}</p>` : ''}
          ${vendor.vendorPhone ? `<p style="margin: 4px 0;"><strong>Phone:</strong> ${vendor.vendorPhone}</p>` : ''}
          ${vendor.paymentTerms ? `<p style="margin: 4px 0;"><strong>Payment Terms:</strong> ${vendor.paymentTerms}</p>` : ''}
          ${vendor.leadTime ? `<p style="margin: 4px 0;"><strong>Lead Time:</strong> ${vendor.leadTime}</p>` : ''}
        </div>

        <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
          <thead>
            <tr style="background: #f5f5f5; border-bottom: 2px solid #ddd;">
              <th style="padding: 12px 8px; text-align: left;">#</th>
              <th style="padding: 12px 8px; text-align: left;">Item Name</th>
              <th style="padding: 12px 8px; text-align: left;">Make/Brand</th>
              <th style="padding: 12px 8px; text-align: left;">SKU/Part No.</th>
              <th style="padding: 12px 8px; text-align: left;">Description</th>
              <th style="padding: 12px 8px; text-align: center;">Quantity</th>
              <th style="padding: 12px 8px; text-align: left;">Category</th>
              <th style="padding: 12px 8px; text-align: right;">Unit Price</th>
              <th style="padding: 12px 8px; text-align: left;">Quote</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHTML}
          </tbody>
        </table>

        <div style="text-align: right; margin-top: 15px; padding: 12px; background: #f8f9fa; border-radius: 4px;">
          <p style="margin: 4px 0;"><strong>Items for this vendor:</strong> ${vendor.items.length}</p>
          ${subtotal > 0 ? `<p style="margin: 4px 0; font-size: 16px; color: #0066cc;"><strong>Subtotal:</strong> ₹${subtotal.toLocaleString('en-IN')}</p>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Purchase Request - ${projectDetails.projectName}</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
  <div style="max-width: 900px; margin: 20px auto; background: #ffffff; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0066cc 0%, #0052a3 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0 0 10px 0; font-size: 28px;">Purchase Request</h1>
      <p style="margin: 0; font-size: 16px; opacity: 0.9;">
        <strong>${companyName}</strong>
      </p>
    </div>

    <!-- Project Info -->
    <div style="padding: 25px; background: #f8f9fa; border-bottom: 2px solid #e9ecef;">
      <table style="width: 100%; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0;"><strong>Project:</strong></td>
          <td style="padding: 8px 0;">${projectDetails.projectName} (${projectDetails.projectId})</td>
          <td style="padding: 8px 0;"><strong>Client:</strong></td>
          <td style="padding: 8px 0;">${projectDetails.clientName}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Request Date:</strong></td>
          <td style="padding: 8px 0;">${date}</td>
          <td style="padding: 8px 0;"><strong>Requested By:</strong></td>
          <td style="padding: 8px 0;">${requestedBy}</td>
        </tr>
      </table>
    </div>

    <!-- Vendor Sections -->
    <div style="padding: 25px;">
      <h2 style="color: #333; margin-top: 0;">Items Grouped by Vendor</h2>
      ${vendorSectionsHTML}
    </div>

    <!-- Summary -->
    <div style="padding: 25px; background: #f8f9fa; border-top: 2px solid #e9ecef;">
      <h3 style="color: #0066cc; margin-top: 0;">Summary</h3>
      <table style="width: 100%; font-size: 14px;">
        <tr>
          <td style="padding: 8px 0;"><strong>Total Items:</strong></td>
          <td style="padding: 8px 0;">${totalItems}</td>
          <td style="padding: 8px 0;"><strong>Total Vendors:</strong></td>
          <td style="padding: 8px 0;">${groupedItems.length}</td>
        </tr>
        ${totalEstimatedCost > 0 ? `
        <tr>
          <td style="padding: 8px 0;"><strong>Total Estimated Cost:</strong></td>
          <td colspan="3" style="padding: 8px 0; font-size: 16px; color: #0066cc;"><strong>₹${totalEstimatedCost.toLocaleString('en-IN')}</strong></td>
        </tr>
        ` : ''}
      </table>
    </div>

    <!-- Footer -->
    <div style="padding: 20px; background: #343a40; color: #fff; text-align: center; font-size: 12px; border-radius: 0 0 8px 8px;">
      <p style="margin: 0 0 5px 0;">This is an automated purchase request generated by BOM Tracker System</p>
      <p style="margin: 0; opacity: 0.8;">Please review and create official purchase orders as needed</p>
    </div>
  </div>
</body>
</html>
  `;
};

// Helper function to strip HTML for plain text version
const stripHtml = (html) => {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
};

// Send Purchase Request via Resend
exports.sendPurchaseRequest = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { auth, data } = request;

    if (!auth) {
      throw new Error('Authentication required');
    }

    try {
      const {
        projectDetails,
        categories,
        vendors,
        recipients,
        companyName,
        fromEmail
      } = data;

      // Validate required data
      if (!projectDetails || !categories || !recipients || recipients.length === 0) {
        throw new Error('Missing required data for purchase request');
      }

      // Get user info
      const userRecord = await admin.auth().getUser(auth.uid);
      const requestedBy = userRecord.email || 'Unknown User';

      // Group items by vendor
      const groupedItems = groupItemsByVendor(categories, vendors || []);

      // Generate HTML email
      const htmlContent = generatePREmailHTML({
        projectDetails,
        groupedItems,
        companyName: companyName || 'Qualitas Technologies Pvt Ltd',
        requestedBy
      });

      // Initialize Resend
      const resend = new Resend(getResendApiKey());

      // Prepare email message
      const emailData = {
        from: fromEmail || 'info@qualitastech.com', // Must be verified in Resend
        to: recipients,
        subject: `Purchase Request - ${projectDetails.projectName} - ${new Date().toLocaleDateString('en-IN')}`,
        html: htmlContent,
        text: stripHtml(htmlContent)
      };

      // Send email
      const response = await resend.emails.send(emailData);

      logger.info('Purchase request sent successfully', {
        projectId: projectDetails.projectId,
        projectName: projectDetails.projectName,
        recipients: recipients,
        itemCount: groupedItems.reduce((sum, vendor) => sum + vendor.items.length, 0),
        vendorCount: groupedItems.length,
        sentBy: auth.uid,
        emailId: response.id
      });

      return {
        success: true,
        message: 'Purchase request sent successfully',
        emailId: response.id,
        recipients: recipients
      };

    } catch (error) {
      // Log full error for debugging
      logger.error('Error sending purchase request:', {
        message: error.message,
        code: error.code,
        stack: error.stack
      });

      // Provide user-friendly error messages based on error type
      let userMessage = 'Failed to send purchase request';
      let troubleshooting = '';

      if (error.message?.includes('Unauthorized') || error.message?.includes('Invalid API key')) {
        userMessage = 'Email service authentication failed';
        troubleshooting = 'The Resend API key is invalid or expired. Please contact your administrator to update the API key in Firebase secrets.';
      } else if (error.message?.includes('Forbidden') || error.message?.includes('Domain not verified')) {
        userMessage = 'Email service access denied';
        troubleshooting = 'The sender email address may not be verified in Resend, or the API key lacks required permissions.';
      } else if (error.message?.includes('Invalid') || error.code === 400) {
        userMessage = 'Invalid email request';
        troubleshooting = 'Check that all recipient email addresses are valid and the email content is properly formatted.';
      } else if (error.message?.includes('ENOTFOUND') || error.message?.includes('ETIMEDOUT')) {
        userMessage = 'Email service unreachable';
        troubleshooting = 'Network connectivity issue. Please try again in a few moments.';
      } else {
        userMessage = 'Email service error';
        troubleshooting = error.message;
      }

      throw new Error(`${userMessage}. ${troubleshooting || error.message}`);
    }
  }
);

// ==================== EXPENSE APPROVAL NOTIFICATIONS ====================

// Notify on travel expense status changes
// mode='submitted'  → email to all admins (team member submitted a claim)
// mode='approved'|'rejected' → email to claim owner
exports.notifyExpenseApproval = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { auth, data } = request;
    if (!auth) throw new Error('Authentication required');

    const { mode, projectId, projectName, visitDates, visitLocation, visitPurpose, visitTotal, ownerUid } = data;
    const resend = new Resend(getResendApiKey());
    const FROM = 'BOM Tracker <info@qualitastech.com>';

    const formatINR = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
    const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const visitRows = [
      `<tr><td style="padding:6px 0;color:#666;width:130px;vertical-align:top;">Project</td><td style="padding:6px 0;font-weight:600;">${esc(projectName)}</td></tr>`,
      `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Dates</td><td style="padding:6px 0;">${esc(visitDates)}</td></tr>`,
      visitLocation ? `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Location</td><td style="padding:6px 0;">${esc(visitLocation)}</td></tr>` : '',
      visitPurpose ? `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Purpose</td><td style="padding:6px 0;">${esc(visitPurpose)}</td></tr>` : '',
      `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Amount</td><td style="padding:6px 0;font-weight:700;font-size:17px;color:#0066cc;">${formatINR(visitTotal)}</td></tr>`,
    ].filter(Boolean).join('');

    const visitSummary = `<table style="width:100%;font-size:14px;border-collapse:collapse;margin:16px 0;">${visitRows}</table>`;

    const footer = `
      <div style="padding:16px 28px;background:#f8f9fa;border-top:1px solid #eee;font-size:12px;color:#888;text-align:center;">
        BOM Tracker — Qualitas Technologies Pvt Ltd
      </div>`;

    const projectUrl = `https://visionbomtracker.web.app/project/${esc(projectId)}/bom`;
    const ctaBtn = (label, href = projectUrl) =>
      `<a href="${href}" style="display:inline-block;margin-top:16px;padding:10px 22px;background:#0066cc;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">${label} →</a>`;

    // ── mode: submitted ──────────────────────────────────────────────
    if (mode === 'submitted') {
      const allUsers = await admin.auth().listUsers(1000);
      const adminEmails = allUsers.users
        .filter(u => u.customClaims?.role === 'admin' && u.customClaims?.status === 'approved' && u.email)
        .map(u => u.email);

      if (adminEmails.length === 0) {
        logger.warn('[notifyExpenseApproval] No admin emails found');
        return { success: false, reason: 'no-admins' };
      }

      const submitter = await admin.auth().getUser(auth.uid);
      const submitterName = esc(submitter.displayName || submitter.email || 'A team member');

      const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);overflow:hidden;">
  <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:28px 32px;">
    <h1 style="margin:0;color:#fff;font-size:22px;">Expense Approval Required</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,.9);font-size:14px;">${submitterName} has submitted a travel expense for review</p>
  </div>
  <div style="padding:28px 32px;">${visitSummary}
    <p style="color:#666;font-size:14px;margin:20px 0 0;">Log in to BOM Tracker to approve or reject this claim.</p>
    ${ctaBtn('Review Claim')}
  </div>${footer}
</div></body></html>`;

      await resend.emails.send({
        from: FROM,
        to: adminEmails,
        subject: `Expense Approval Required — ${projectName} (${formatINR(visitTotal)})`,
        html,
      });

      logger.info('[notifyExpenseApproval] Submitted', { adminEmails, projectId });
      return { success: true, sent: adminEmails.length };
    }

    // ── mode: approved / rejected ─────────────────────────────────────
    if (mode === 'approved' || mode === 'rejected') {
      // Verify caller is an admin — prevents non-admins from sending fake approval emails
      const callerRecord = await admin.auth().getUser(auth.uid);
      const callerClaims = callerRecord.customClaims || {};
      if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
        throw new Error('Admin privileges required');
      }

      if (!ownerUid) throw new Error('ownerUid required');

      const owner = await admin.auth().getUser(ownerUid);
      if (!owner.email) {
        logger.warn('[notifyExpenseApproval] Owner has no email', { ownerUid });
        return { success: false, reason: 'no-owner-email' };
      }

      const approver = await admin.auth().getUser(auth.uid);
      const approverName = esc(approver.displayName || approver.email || 'An admin');
      const isApproved = mode === 'approved';
      const word = isApproved ? 'Approved' : 'Rejected';
      const color = isApproved ? '#059669' : '#dc2626';
      const bgColor = isApproved ? '#ecfdf5' : '#fef2f2';

      const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);overflow:hidden;">
  <div style="background:${color};padding:28px 32px;">
    <h1 style="margin:0;color:#fff;font-size:22px;">Expense ${word}</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,.9);font-size:14px;">${approverName} has ${word.toLowerCase()} your travel expense claim</p>
  </div>
  <div style="padding:28px 32px;">
    <div style="background:${bgColor};border:1px solid ${color}44;border-radius:6px;padding:10px 16px;margin-bottom:20px;">
      <p style="margin:0;font-weight:600;color:${color};">Status: ${word}</p>
    </div>
    ${visitSummary}
    <p style="color:#666;font-size:14px;margin:20px 0 0;">${isApproved
        ? 'Your expense claim has been approved. Please proceed with reimbursement as per company policy.'
        : 'Your expense claim was not approved. Please contact your manager for details or resubmit with updated information.'}</p>
    ${ctaBtn('Open BOM Tracker')}
  </div>${footer}
</div></body></html>`;

      await resend.emails.send({
        from: FROM,
        to: owner.email,
        subject: `Your expense claim was ${word} — ${projectName}`,
        html,
      });

      logger.info('[notifyExpenseApproval] Status sent', { ownerEmail: owner.email, mode, projectId });
      return { success: true };
    }

    throw new Error(`Invalid mode: ${mode}`);
  }
);

// ==================== PURCHASE ORDER APPROVAL NOTIFICATIONS ====================

// Notify on PO approval workflow events
// mode='submitted'         → email to all admins (engineer submitted a PO for approval)
// mode='changes-requested' → email to the submitter (admin sent it back for changes)
exports.notifyPOApproval = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { auth, data } = request;
    if (!auth) throw new Error('Authentication required');

    const { mode, projectId, projectName, poId, poNumber, vendorName, totalAmount, submitterUid, note } = data;
    const resend = new Resend(getResendApiKey());
    const FROM = 'BOM Tracker <info@qualitastech.com>';

    const formatINR = (n) => `₹${Math.round(n || 0).toLocaleString('en-IN')}`;
    const esc = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const poRows = [
      `<tr><td style="padding:6px 0;color:#666;width:130px;vertical-align:top;">Project</td><td style="padding:6px 0;font-weight:600;">${esc(projectName)}</td></tr>`,
      `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">PO Number</td><td style="padding:6px 0;">${esc(poNumber)}</td></tr>`,
      `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Vendor</td><td style="padding:6px 0;">${esc(vendorName)}</td></tr>`,
      `<tr><td style="padding:6px 0;color:#666;vertical-align:top;">Amount</td><td style="padding:6px 0;font-weight:700;font-size:17px;color:#0066cc;">${formatINR(totalAmount)}</td></tr>`,
    ].join('');

    const poSummary = `<table style="width:100%;font-size:14px;border-collapse:collapse;margin:16px 0;">${poRows}</table>`;

    const footer = `
      <div style="padding:16px 28px;background:#f8f9fa;border-top:1px solid #eee;font-size:12px;color:#888;text-align:center;">
        BOM Tracker — Qualitas Technologies Pvt Ltd
      </div>`;

    // Deep-link straight to the Documents tab with this PO pre-opened, instead of
    // dropping the reader on the generic BOM page where they have to hunt for it.
    const poDeepLink = poId
      ? `https://visionbomtracker.web.app/project/${esc(projectId)}/bom?tab=documents&po=${esc(poId)}`
      : `https://visionbomtracker.web.app/project/${esc(projectId)}/bom?tab=documents`;
    const ctaBtn = (label) =>
      `<a href="${poDeepLink}" style="display:inline-block;margin-top:16px;padding:10px 22px;background:#0066cc;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">${label} →</a>`;

    // ── mode: submitted ──────────────────────────────────────────────
    if (mode === 'submitted') {
      const allUsers = await admin.auth().listUsers(1000);
      const adminEmails = allUsers.users
        .filter(u => u.customClaims?.role === 'admin' && u.customClaims?.status === 'approved' && u.email)
        .map(u => u.email);

      if (adminEmails.length === 0) {
        logger.warn('[notifyPOApproval] No admin emails found');
        return { success: false, reason: 'no-admins' };
      }

      const submitter = await admin.auth().getUser(auth.uid);
      const submitterName = esc(submitter.displayName || submitter.email || 'A team member');

      const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);overflow:hidden;">
  <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:28px 32px;">
    <h1 style="margin:0;color:#fff;font-size:22px;">PO Approval Required</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,.9);font-size:14px;">${submitterName} has submitted a purchase order for review</p>
  </div>
  <div style="padding:28px 32px;">${poSummary}
    <p style="color:#666;font-size:14px;margin:20px 0 0;">Log in to BOM Tracker to review and send this PO, or request changes.</p>
    ${ctaBtn('Review PO')}
  </div>${footer}
</div></body></html>`;

      await resend.emails.send({
        from: FROM,
        to: adminEmails,
        subject: `PO Approval Required — ${poNumber} (${formatINR(totalAmount)})`,
        html,
      });

      logger.info('[notifyPOApproval] Submitted', { adminEmails, projectId, poNumber });
      return { success: true, sent: adminEmails.length };
    }

    // ── mode: changes-requested ─────────────────────────────────────
    if (mode === 'changes-requested') {
      // Verify caller is an admin — prevents non-admins from sending fake changes-requested emails
      const callerRecord = await admin.auth().getUser(auth.uid);
      const callerClaims = callerRecord.customClaims || {};
      if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
        throw new Error('Admin privileges required');
      }

      if (!submitterUid) throw new Error('submitterUid required');

      const submitter = await admin.auth().getUser(submitterUid);
      if (!submitter.email) {
        logger.warn('[notifyPOApproval] Submitter has no email', { submitterUid });
        return { success: false, reason: 'no-submitter-email' };
      }

      const approver = await admin.auth().getUser(auth.uid);
      const approverName = esc(approver.displayName || approver.email || 'An admin');

      const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#333;margin:0;padding:0;background:#f4f4f4;">
<div style="max-width:600px;margin:24px auto;background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);overflow:hidden;">
  <div style="background:#dc2626;padding:28px 32px;">
    <h1 style="margin:0;color:#fff;font-size:22px;">Changes Requested</h1>
    <p style="margin:8px 0 0;color:rgba(255,255,255,.9);font-size:14px;">${approverName} has requested changes to your purchase order</p>
  </div>
  <div style="padding:28px 32px;">
    ${note ? `<div style="background:#fef2f2;border:1px solid #dc262644;border-radius:6px;padding:10px 16px;margin-bottom:20px;">
      <p style="margin:0;font-weight:600;color:#dc2626;">Note:</p>
      <p style="margin:4px 0 0;color:#333;">${esc(note)}</p>
    </div>` : ''}
    ${poSummary}
    <p style="color:#666;font-size:14px;margin:20px 0 0;">The PO has been reverted to draft. Please make the requested changes and resubmit for approval.</p>
    ${ctaBtn('Open PO')}
  </div>${footer}
</div></body></html>`;

      await resend.emails.send({
        from: FROM,
        to: submitter.email,
        subject: `Changes Requested — PO ${poNumber}`,
        html,
      });

      logger.info('[notifyPOApproval] Changes requested', { submitterEmail: submitter.email, projectId, poNumber });
      return { success: true };
    }

    throw new Error(`Invalid mode: ${mode}`);
  }
);

// Extract text from PDF quotation
// This function downloads a PDF from a URL and extracts its text content
// Note: pdfParse is already imported at the top of the file

exports.extractQuotationText = onCall(
  async (request) => {
    const { auth, data } = request;

    if (!auth) {
      throw new Error('Authentication required');
    }

    try {
      const { quotationId, fileUrl } = data;

      if (!quotationId || !fileUrl) {
        throw new Error('Missing required parameters: quotationId and fileUrl');
      }

      logger.info('Starting PDF text extraction', {
        quotationId,
        fileUrl,
        userId: auth.uid
      });

      // Download the PDF file from Firebase Storage
      const bucket = admin.storage().bucket();

      // Extract the storage path from the URL
      // URL format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{path}?...
      const urlParts = fileUrl.split('/o/')[1];
      if (!urlParts) {
        throw new Error('Invalid file URL format');
      }
      const filePath = decodeURIComponent(urlParts.split('?')[0]);

      logger.info('Downloading PDF', { filePath });

      // Download file to buffer
      const file = bucket.file(filePath);
      const [fileBuffer] = await file.download();

      logger.info('PDF downloaded, extracting text', {
        bufferSize: fileBuffer.length
      });

      // Extract text from PDF
      const pdfData = await pdfParse(fileBuffer);
      const extractedText = pdfData.text;

      logger.info('Text extraction complete', {
        quotationId,
        textLength: extractedText.length,
        numPages: pdfData.numpages
      });

      // Update Firestore document with extracted text
      await admin.firestore().collection('quotations').doc(quotationId).update({
        extractedText: extractedText,
        textExtractedAt: admin.firestore.FieldValue.serverTimestamp(),
        status: 'text_extracted'
      });

      logger.info('Firestore updated successfully', { quotationId });

      return {
        success: true,
        textLength: extractedText.length,
        numPages: pdfData.numpages,
        quotationId: quotationId
      };

    } catch (error) {
      logger.error('Error extracting PDF text:', error);

      // Update status to error if quotationId is available
      if (data.quotationId) {
        try {
          await admin.firestore().collection('quotations').doc(data.quotationId).update({
            status: 'error',
            errorMessage: error.message
          });
        } catch (updateError) {
          logger.error('Failed to update error status:', updateError);
        }
      }

      throw new Error(`Failed to extract PDF text: ${error.message}`);
    }
  }
);

// ==================== PDF QUOTE PARSING FUNCTIONS ====================

/**
 * Parse vendor quote PDF and extract structured line items
 * Uses unpdf for text extraction, falls back to OpenAI Vision for scanned PDFs
 *
 * @param {string} documentId - The document ID in Firestore
 * @param {string} fileUrl - Firebase Storage URL of the PDF
 * @param {string} projectId - The project ID
 * @returns {Object} Parsed quote data with line items
 */
exports.parseVendorQuotePDF = onRequest(
  {
    secrets: [openaiApiKeySecret],
    timeoutSeconds: 180, // 3 minutes for large PDFs
    memory: '1GiB'
  },
  async (request, response) => {
    // Enable CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const startTime = Date.now();

    try {
      const { documentId, fileUrl, projectId, bomItems } = request.body;

      // Validate required fields
      if (!documentId || !fileUrl) {
        response.status(400).json({
          error: 'Missing required fields: documentId and fileUrl'
        });
        return;
      }

      const openaiApiKey = openaiApiKeySecret.value();
      if (!openaiApiKey) {
        response.status(500).json({ error: 'AI service not configured' });
        return;
      }

      logger.info('Starting PDF quote parsing', {
        documentId,
        fileUrl: fileUrl.substring(0, 100) + '...',
        projectId
      });

      // Download PDF from Firebase Storage
      const bucket = admin.storage().bucket();
      const urlParts = fileUrl.split('/o/')[1];
      if (!urlParts) {
        response.status(400).json({ error: 'Invalid file URL format' });
        return;
      }
      const filePath = decodeURIComponent(urlParts.split('?')[0]);

      logger.info('Downloading PDF', { filePath });

      const file = bucket.file(filePath);
      const [fileBuffer] = await file.download();
      const fileSize = fileBuffer.length;

      logger.info('PDF downloaded', { fileSize });

      // Step 1: Try to extract text using pdf-parse
      let extractedText = '';
      let useVisionAPI = false;
      let numPages = 1;

      try {
        const pdfData = await pdfParse(fileBuffer);
        extractedText = pdfData.text || '';
        numPages = pdfData.numpages || 1;

        logger.info('PDF loaded', { numPages, textLength: extractedText.length });

        // Check if we got meaningful text (scanned PDFs return very little)
        const wordCount = extractedText.split(/\s+/).filter(w => w.length > 1).length;
        logger.info('Text extraction complete', {
          textLength: extractedText.length,
          wordCount,
          numPages
        });

        // If less than 50 words per page on average, likely a scanned PDF
        if (wordCount < (numPages * 50)) {
          logger.info('Minimal text extracted, switching to Vision API');
          useVisionAPI = true;
        }

      } catch (extractError) {
        logger.warn('Text extraction failed, using Vision API', { error: extractError.message });
        useVisionAPI = true;
      }

      // Step 2: Parse with OpenAI
      let parsedQuote;

      const systemPrompt = `You are an expert at parsing vendor quotations and invoices. Extract all line items from the document.

For each line item, extract:
- partName: The product/part name or description
- partNumber: Part number, SKU, or model number (if present)
- make: Manufacturer or brand (if present)
- quantity: Number of units
- unitPrice: Price per unit in INR (remove ₹ symbol, handle lakhs notation like 1,50,000)
- totalPrice: Total price for this line (quantity × unitPrice)
- hsnCode: HSN/SAC code if present

Also extract document-level information:
- vendorName: Name of the vendor/supplier
- vendorGST: GST number if present
- quoteNumber: Quote/Invoice number
- quoteDate: Date of the quote
- validUntil: Quote validity date if present
- subtotal: Subtotal before tax
- gstAmount: GST amount
- grandTotal: Grand total including tax
- paymentTerms: Payment terms if mentioned
- deliveryTerms: Delivery terms or lead time if mentioned

IMPORTANT:
- Handle Indian number formatting (e.g., 1,50,000 = 150000)
- Extract ALL line items, even if there are many
- If a field is not present, use null
- Return ONLY valid JSON

JSON OUTPUT FORMAT:
{
  "documentInfo": {
    "vendorName": "string",
    "vendorGST": "string or null",
    "quoteNumber": "string or null",
    "quoteDate": "string or null",
    "validUntil": "string or null",
    "subtotal": number or null,
    "gstAmount": number or null,
    "gstPercent": number or null,
    "grandTotal": number or null,
    "paymentTerms": "string or null",
    "deliveryTerms": "string or null"
  },
  "lineItems": [
    {
      "lineNumber": 1,
      "partName": "string",
      "partNumber": "string or null",
      "make": "string or null",
      "description": "string or null",
      "quantity": number,
      "unit": "string (pcs, nos, etc.)",
      "unitPrice": number,
      "totalPrice": number,
      "hsnCode": "string or null"
    }
  ],
  "totalLineItems": number,
  "parseConfidence": "high|medium|low",
  "notes": "any special observations about the document"
}`;

      if (useVisionAPI) {
        // Use OpenAI Vision API with PDF directly
        logger.info('Using OpenAI Vision API for scanned PDF');

        // Convert PDF buffer to base64
        const base64PDF = fileBuffer.toString('base64');

        const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: systemPrompt },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: 'Parse this vendor quotation/invoice PDF and extract all line items and document information.'
                  },
                  {
                    type: 'file',
                    file: {
                      filename: 'quote.pdf',
                      file_data: `data:application/pdf;base64,${base64PDF}`
                    }
                  }
                ]
              }
            ],
            temperature: 0.1,
            max_tokens: 4000,
            response_format: { type: 'json_object' }
          })
        });

        if (!visionResponse.ok) {
          const errorData = await visionResponse.json().catch(() => ({}));
          logger.error('OpenAI Vision API error', errorData);
          throw new Error(`Vision API error: ${errorData.error?.message || 'Unknown error'}`);
        }

        const visionData = await visionResponse.json();
        parsedQuote = JSON.parse(visionData.choices[0]?.message?.content || '{}');

      } else {
        // Use text-based parsing (cheaper and faster)
        logger.info('Using text-based parsing');

        // Include BOM items context if provided for better matching
        let userPrompt = `Parse this vendor quotation and extract all line items:\n\n${extractedText}`;

        if (bomItems && bomItems.length > 0) {
          const bomContext = bomItems.map(item =>
            `- ${item.name}${item.sku ? ` (SKU: ${item.sku})` : ''}${item.make ? ` [${item.make}]` : ''}`
          ).join('\n');
          userPrompt += `\n\n--- BOM Items to match against ---\n${bomContext}`;
        }

        const textResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt }
            ],
            temperature: 0.1,
            max_tokens: 4000,
            response_format: { type: 'json_object' }
          })
        });

        if (!textResponse.ok) {
          const errorData = await textResponse.json().catch(() => ({}));
          logger.error('OpenAI text API error', errorData);
          throw new Error(`Text API error: ${errorData.error?.message || 'Unknown error'}`);
        }

        const textData = await textResponse.json();
        parsedQuote = JSON.parse(textData.choices[0]?.message?.content || '{}');
      }

      // Validate and clean parsed data
      if (!parsedQuote.lineItems) {
        parsedQuote.lineItems = [];
      }

      // Ensure all prices are numbers
      parsedQuote.lineItems = parsedQuote.lineItems.map((item, index) => ({
        ...item,
        lineNumber: item.lineNumber || index + 1,
        quantity: parseFloat(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice) || 0,
        totalPrice: parseFloat(item.totalPrice) || (parseFloat(item.quantity) * parseFloat(item.unitPrice)) || 0
      }));

      // Calculate totals if not present
      if (!parsedQuote.documentInfo) {
        parsedQuote.documentInfo = {};
      }

      const calculatedSubtotal = parsedQuote.lineItems.reduce((sum, item) => sum + item.totalPrice, 0);
      if (!parsedQuote.documentInfo.subtotal) {
        parsedQuote.documentInfo.subtotal = calculatedSubtotal;
      }

      const processingTime = Date.now() - startTime;

      logger.info('PDF parsing complete', {
        documentId,
        lineItemsFound: parsedQuote.lineItems.length,
        useVisionAPI,
        processingTimeMs: processingTime
      });

      // Optionally update Firestore with parsed data
      if (projectId && documentId) {
        try {
          const db = admin.firestore();
          await db
            .collection('projects')
            .doc(projectId)
            .collection('documents')
            .doc(documentId)
            .update({
              parsedQuoteData: parsedQuote,
              parsedAt: admin.firestore.FieldValue.serverTimestamp(),
              parseMethod: useVisionAPI ? 'vision' : 'text'
            });
          logger.info('Firestore updated with parsed quote data', { documentId });
        } catch (firestoreError) {
          logger.warn('Could not update Firestore', { error: firestoreError.message });
        }
      }

      response.status(200).json({
        success: true,
        documentId,
        parsedQuote,
        metadata: {
          parseMethod: useVisionAPI ? 'vision' : 'text',
          fileSize,
          processingTimeMs: processingTime,
          lineItemsFound: parsedQuote.lineItems.length
        }
      });

    } catch (error) {
      logger.error('Error parsing PDF quote', { error: error.message, stack: error.stack });
      response.status(500).json({
        error: 'Failed to parse PDF quote',
        details: error.message
      });
    }
  }
);

/**
 * Parse an image file (JPG, PNG) using OpenAI Vision API
 * For vendor quotes that are photos/scans saved as images
 */
exports.parseVendorQuoteImage = onRequest(
  {
    secrets: [openaiApiKeySecret],
    timeoutSeconds: 120
  },
  async (request, response) => {
    // Enable CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const startTime = Date.now();

    try {
      const { documentId, fileUrl, projectId } = request.body;

      if (!documentId || !fileUrl) {
        response.status(400).json({
          error: 'Missing required fields: documentId and fileUrl'
        });
        return;
      }

      const openaiApiKey = openaiApiKeySecret.value();
      if (!openaiApiKey) {
        response.status(500).json({ error: 'AI service not configured' });
        return;
      }

      logger.info('Starting image quote parsing', { documentId });

      // Download image from Firebase Storage
      const bucket = admin.storage().bucket();
      const urlParts = fileUrl.split('/o/')[1];
      if (!urlParts) {
        response.status(400).json({ error: 'Invalid file URL format' });
        return;
      }
      const filePath = decodeURIComponent(urlParts.split('?')[0]);

      const file = bucket.file(filePath);
      const [fileBuffer] = await file.download();
      const [metadata] = await file.getMetadata();
      const contentType = metadata.contentType || 'image/jpeg';

      // Convert to base64
      const base64Image = fileBuffer.toString('base64');
      const dataUrl = `data:${contentType};base64,${base64Image}`;

      const systemPrompt = `You are an expert at parsing vendor quotations and invoices from images. Extract all line items from the document.

For each line item, extract:
- partName: The product/part name or description
- partNumber: Part number, SKU, or model number (if present)
- make: Manufacturer or brand (if present)
- quantity: Number of units
- unitPrice: Price per unit in INR
- totalPrice: Total price for this line

Also extract document-level info: vendorName, quoteNumber, quoteDate, grandTotal, gstAmount.

Handle Indian number formatting (e.g., 1,50,000 = 150000).
Return ONLY valid JSON in the same format as PDF parsing.`;

      const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Parse this vendor quotation/invoice image and extract all line items.'
                },
                {
                  type: 'image_url',
                  image_url: { url: dataUrl }
                }
              ]
            }
          ],
          temperature: 0.1,
          max_tokens: 4000,
          response_format: { type: 'json_object' }
        })
      });

      if (!visionResponse.ok) {
        const errorData = await visionResponse.json().catch(() => ({}));
        throw new Error(`Vision API error: ${errorData.error?.message || 'Unknown error'}`);
      }

      const visionData = await visionResponse.json();
      const parsedQuote = JSON.parse(visionData.choices[0]?.message?.content || '{}');

      // Clean and validate
      if (!parsedQuote.lineItems) parsedQuote.lineItems = [];
      parsedQuote.lineItems = parsedQuote.lineItems.map((item, index) => ({
        ...item,
        lineNumber: index + 1,
        quantity: parseFloat(item.quantity) || 1,
        unitPrice: parseFloat(item.unitPrice) || 0,
        totalPrice: parseFloat(item.totalPrice) || 0
      }));

      const processingTime = Date.now() - startTime;

      // Update Firestore
      if (projectId && documentId) {
        try {
          await admin.firestore()
            .collection('projects')
            .doc(projectId)
            .collection('documents')
            .doc(documentId)
            .update({
              parsedQuoteData: parsedQuote,
              parsedAt: admin.firestore.FieldValue.serverTimestamp(),
              parseMethod: 'vision-image'
            });
        } catch (e) {
          logger.warn('Could not update Firestore', { error: e.message });
        }
      }

      response.status(200).json({
        success: true,
        documentId,
        parsedQuote,
        metadata: {
          parseMethod: 'vision-image',
          processingTimeMs: processingTime,
          lineItemsFound: parsedQuote.lineItems.length
        }
      });

    } catch (error) {
      logger.error('Error parsing image quote', { error: error.message });
      response.status(500).json({
        error: 'Failed to parse image quote',
        details: error.message
      });
    }
  }
);

// ==================== AI COMPLIANCE CHECKER FUNCTIONS ====================

/**
 * Run AI Compliance Check on BOM items
 * Validates item data quality and matches vendor quotes to BOM items
 */
exports.runComplianceCheck = onRequest(
  {
    secrets: [openaiApiKeySecret],
    timeoutSeconds: 300, // 5 minutes for PDF parsing
    memory: '1GiB'
  },
  async (request, response) => {
    // Enable CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    const startTime = Date.now();

    try {
      const { projectId, bomItems, vendorQuotes, settings, parseDocuments = true } = request.body;

      // Validate input
      if (!projectId || !bomItems || !Array.isArray(bomItems)) {
        response.status(400).json({ error: 'projectId and bomItems array are required' });
        return;
      }

      const openaiApiKey = openaiApiKeySecret.value();
      if (!openaiApiKey) {
        response.status(500).json({ error: 'AI service not configured' });
        return;
      }

      const issues = [];
      const issuesByType = {};
      const issuesBySeverity = { error: 0, warning: 0, info: 0 };

      // Helper to add issue
      const addIssue = (issue) => {
        issues.push({
          ...issue,
          id: `issue-${issues.length + 1}`,
          createdAt: new Date().toISOString()
        });
        issuesByType[issue.issueType] = (issuesByType[issue.issueType] || 0) + 1;
        issuesBySeverity[issue.severity]++;
      };

      // Build lookup maps for validation
      const itemsByName = new Map();
      const itemsBySku = new Map();
      const linkedDocumentIds = new Set();

      // Collect all linked document IDs from vendor quotes
      vendorQuotes?.forEach(quote => {
        if (quote.documentId) {
          linkedDocumentIds.add(quote.documentId);
        }
      });

      // First pass: build lookup maps for duplicate detection
      bomItems.forEach(item => {
        const itemType = item.itemType || 'component';

        // Track items by normalized name for duplicate detection
        const normalizedName = (item.name || '').toLowerCase().trim();
        if (normalizedName) {
          if (!itemsByName.has(normalizedName)) {
            itemsByName.set(normalizedName, []);
          }
          itemsByName.get(normalizedName).push(item);
        }

        // Track items by SKU for duplicate detection
        if (itemType === 'component' && item.sku) {
          const normalizedSku = item.sku.toLowerCase().trim();
          if (!itemsBySku.has(normalizedSku)) {
            itemsBySku.set(normalizedSku, []);
          }
          itemsBySku.get(normalizedSku).push(item);
        }
      });

      // Phase 1: Comprehensive validation checks
      bomItems.forEach(item => {
        const itemType = item.itemType || 'component';
        const isComponent = itemType === 'component';

        // ============ CRITICAL ERRORS ============

        // 1. Check for missing required fields - Name
        if (!item.name || item.name.trim() === '') {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'error',
            message: 'Item name is required',
            details: 'Every BOM item must have a name.',
            currentValue: item.name || '',
            suggestedFix: null
          });
        }

        // 2. Check for missing Make/Manufacturer (REQUIRED for components)
        if (isComponent && (!item.make || item.make.trim() === '')) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'error',
            message: 'Manufacturer/Make is required',
            details: 'Every component must have a manufacturer specified for procurement.',
            currentValue: '',
            suggestedFix: null
          });
        }

        // 3. Check for missing SKU (REQUIRED for components)
        if (isComponent && (!item.sku || item.sku.trim() === '')) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'error',
            message: 'SKU/Part Number is required',
            details: 'Every component must have a SKU or part number for accurate ordering.',
            currentValue: '',
            suggestedFix: null
          });
        }

        // 4. Check for missing linked vendor quote (REQUIRED for components)
        if (isComponent) {
          // Check if this item has a linked quote document
          // Either via item.linkedQuoteDocumentId OR via document.linkedBOMItems
          const hasLinkedQuoteOnItem = !!item.linkedQuoteDocumentId;
          const hasLinkedQuoteOnDocument = vendorQuotes?.some(quote =>
            quote.linkedBOMItems?.includes(item.id)
          );
          const hasLinkedQuote = hasLinkedQuoteOnItem || hasLinkedQuoteOnDocument;

          if (!hasLinkedQuote) {
            addIssue({
              bomItemId: item.id,
              bomItemName: item.name || 'Unnamed Item',
              category: item.category || 'Unknown',
              issueType: 'missing-quote',
              severity: 'error',
              message: 'No vendor quote linked',
              details: 'Every component must have a linked vendor quote before ordering.',
              currentValue: '',
              suggestedFix: null
            });
          }
        }

        // ============ WARNINGS ============

        // 5. Check for missing description
        if (!item.description || item.description.trim() === '') {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'Item description is missing',
            details: 'Adding a description helps with clarity and quote matching.',
            currentValue: '',
            suggestedFix: {
              type: 'update-field',
              field: 'description',
              suggestedValue: item.name,
              description: 'Use item name as description'
            }
          });
        }

        // 6. Check SKU format for components
        if (isComponent && item.sku) {
          const skuIssues = [];
          if (item.sku.length < 3) {
            skuIssues.push('SKU is too short (minimum 3 characters)');
          }
          if (/\s{2,}/.test(item.sku)) {
            skuIssues.push('SKU contains multiple consecutive spaces');
          }
          if (/[<>{}[\]\\|]/.test(item.sku)) {
            skuIssues.push('SKU contains invalid characters');
          }
          if (/^\s|\s$/.test(item.sku)) {
            skuIssues.push('SKU has leading or trailing spaces');
          }

          if (skuIssues.length > 0) {
            addIssue({
              bomItemId: item.id,
              bomItemName: item.name,
              category: item.category || 'Unknown',
              issueType: 'invalid-sku',
              severity: 'warning',
              message: 'SKU format issues detected',
              details: skuIssues.join('. '),
              currentValue: item.sku,
              suggestedFix: {
                type: 'update-field',
                field: 'sku',
                suggestedValue: item.sku.trim().replace(/\s+/g, '-'),
                description: 'Clean up SKU format'
              }
            });
          }
        }

        // 7. Check for missing price on ordered/received items
        if ((item.status === 'ordered' || item.status === 'received') && !item.price) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name,
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'Price is missing for ordered item',
            details: 'Items that are ordered should have a price for accurate cost tracking.',
            currentValue: '',
            suggestedFix: null
          });
        }

        // 8. Check for zero or negative quantity
        if (!item.quantity || item.quantity <= 0) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'Invalid quantity',
            details: 'Quantity must be greater than zero.',
            currentValue: String(item.quantity || 0),
            suggestedFix: {
              type: 'update-field',
              field: 'quantity',
              suggestedValue: 1,
              description: 'Set quantity to 1'
            }
          });
        }

        // 9. Check for unreasonably high quantity (potential data entry error)
        if (item.quantity > 10000) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name,
            category: item.category || 'Unknown',
            issueType: 'quantity-mismatch',
            severity: 'warning',
            message: 'Unusually high quantity',
            details: `Quantity of ${item.quantity} seems unusually high. Please verify this is correct.`,
            currentValue: String(item.quantity),
            suggestedFix: null
          });
        }

        // 10. Check for missing category
        if (!item.category || item.category.trim() === '' || item.category === 'Uncategorized') {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Item',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'Item is uncategorized',
            details: 'Assign a category for better organization and reporting.',
            currentValue: item.category || '',
            suggestedFix: null
          });
        }

        // 11. Check for missing finalized vendor on items ready to order
        if (isComponent && item.price && !item.finalizedVendor) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name,
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'No vendor selected',
            details: 'Item has a price but no vendor has been selected for ordering.',
            currentValue: '',
            suggestedFix: null
          });
        }

        // ============ INFO / SUGGESTIONS ============

        // 12. Check for very short item names (might be abbreviations)
        if (item.name && item.name.trim().length < 5) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name,
            category: item.category || 'Unknown',
            issueType: 'name-format',
            severity: 'info',
            message: 'Item name is very short',
            details: 'Short names might be unclear. Consider using a more descriptive name.',
            currentValue: item.name,
            suggestedFix: null
          });
        }

        // 13. Check for items with price but no linked quote
        // (This is an INFO level duplicate check - the ERROR is already added above for all components)
        // Skip this to avoid duplicate issues - the main check at #4 covers all components without quotes

        // 14. Check for services without rate
        if (!isComponent && (!item.price || item.price <= 0)) {
          addIssue({
            bomItemId: item.id,
            bomItemName: item.name || 'Unnamed Service',
            category: item.category || 'Unknown',
            issueType: 'missing-field',
            severity: 'warning',
            message: 'Service rate is missing',
            details: 'Services should have a rate per day specified.',
            currentValue: '',
            suggestedFix: null
          });
        }
      });

      // ============ CROSS-ITEM CHECKS ============

      // 15. Check for duplicate items by name
      itemsByName.forEach((items, name) => {
        if (items.length > 1) {
          items.forEach(item => {
            addIssue({
              bomItemId: item.id,
              bomItemName: item.name,
              category: item.category || 'Unknown',
              issueType: 'duplicate-item',
              severity: 'warning',
              message: 'Possible duplicate item',
              details: `${items.length} items have the same name "${item.name}". Verify these are not duplicates.`,
              currentValue: item.name,
              suggestedFix: null
            });
          });
        }
      });

      // 16. Check for duplicate SKUs
      itemsBySku.forEach((items, sku) => {
        if (items.length > 1) {
          items.forEach(item => {
            addIssue({
              bomItemId: item.id,
              bomItemName: item.name,
              category: item.category || 'Unknown',
              issueType: 'duplicate-item',
              severity: 'error',
              message: 'Duplicate SKU detected',
              details: `${items.length} items share SKU "${item.sku}". Each component should have a unique SKU.`,
              currentValue: item.sku,
              suggestedFix: null
            });
          });
        }
      });

      // Phase 2: Parse vendor quote PDFs and match to BOM items
      let quoteAnalysis = [];
      let quotesMatched = 0;
      let documentsParsed = 0;
      const parsedQuoteData = [];

      if (vendorQuotes && vendorQuotes.length > 0 && bomItems.length > 0) {
        const bucket = admin.storage().bucket();

        // Helper function to parse a single PDF
        const parsePDFDocument = async (quote) => {
          try {
            // Check if already parsed
            if (quote.parsedQuoteData && quote.parsedQuoteData.lineItems) {
              logger.info('Using cached parsed data', { documentId: quote.documentId });
              return quote.parsedQuoteData;
            }

            // Check if we have a file URL
            if (!quote.fileUrl) {
              logger.warn('No file URL for quote', { documentId: quote.documentId });
              return null;
            }

            // Download PDF from Firebase Storage
            const urlParts = quote.fileUrl.split('/o/')[1];
            if (!urlParts) {
              logger.warn('Invalid file URL format', { documentId: quote.documentId });
              return null;
            }
            const filePath = decodeURIComponent(urlParts.split('?')[0]);

            logger.info('Downloading PDF for parsing', { documentId: quote.documentId, filePath });

            const file = bucket.file(filePath);
            const [fileBuffer] = await file.download();

            // Try text extraction first using pdf-parse
            let extractedText = '';
            let useVisionAPI = false;
            let numPages = 1;

            try {
              const pdfData = await pdfParse(fileBuffer);
              extractedText = pdfData.text || '';
              numPages = pdfData.numpages || 1;

              const wordCount = extractedText.split(/\s+/).filter(w => w.length > 1).length;

              // If less than 50 words per page, likely scanned
              if (wordCount < (numPages * 50)) {
                useVisionAPI = true;
              }
            } catch (extractError) {
              logger.warn('Text extraction failed', { error: extractError.message });
              useVisionAPI = true;
            }

            // Parse with OpenAI
            const parsePrompt = `You are an expert at parsing vendor quotations. Extract all line items.

For each line item, extract: partName, partNumber (SKU), make, quantity, unitPrice, totalPrice.
Also extract: vendorName, quoteNumber, quoteDate, grandTotal, gstAmount.

Handle Indian number formatting (1,50,000 = 150000).
Return ONLY valid JSON:
{
  "documentInfo": { "vendorName": "", "quoteNumber": "", "quoteDate": "", "grandTotal": null, "gstAmount": null },
  "lineItems": [{ "partName": "", "partNumber": null, "make": null, "quantity": 1, "unitPrice": 0, "totalPrice": 0 }]
}`;

            let parsedResult;

            if (useVisionAPI) {
              // Use Vision API for scanned PDFs
              const base64PDF = fileBuffer.toString('base64');

              const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${openaiApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-4o',
                  messages: [
                    { role: 'system', content: parsePrompt },
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: 'Parse this vendor quotation PDF and extract all line items.' },
                        { type: 'file', file: { filename: 'quote.pdf', file_data: `data:application/pdf;base64,${base64PDF}` } }
                      ]
                    }
                  ],
                  temperature: 0.1,
                  max_tokens: 4000,
                  response_format: { type: 'json_object' }
                })
              });

              if (visionResponse.ok) {
                const data = await visionResponse.json();
                parsedResult = JSON.parse(data.choices[0]?.message?.content || '{}');
              }
            } else {
              // Use text-based parsing
              const textResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${openaiApiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  messages: [
                    { role: 'system', content: parsePrompt },
                    { role: 'user', content: `Parse this vendor quotation:\n\n${extractedText}` }
                  ],
                  temperature: 0.1,
                  max_tokens: 4000,
                  response_format: { type: 'json_object' }
                })
              });

              if (textResponse.ok) {
                const data = await textResponse.json();
                parsedResult = JSON.parse(data.choices[0]?.message?.content || '{}');
              }
            }

            // Store parsed data back to Firestore for future use
            if (parsedResult && parsedResult.lineItems && projectId) {
              try {
                await admin.firestore()
                  .collection('projects')
                  .doc(projectId)
                  .collection('documents')
                  .doc(quote.documentId)
                  .update({
                    parsedQuoteData: parsedResult,
                    parsedAt: admin.firestore.FieldValue.serverTimestamp(),
                    parseMethod: useVisionAPI ? 'vision' : 'text'
                  });
              } catch (e) {
                logger.warn('Could not cache parsed data', { error: e.message });
              }
            }

            return parsedResult;

          } catch (parseError) {
            logger.error('Error parsing PDF', { documentId: quote.documentId, error: parseError.message });
            return null;
          }
        };

        // Parse all vendor quote PDFs if parseDocuments is enabled
        if (parseDocuments) {
          logger.info('Parsing vendor quote PDFs', { count: vendorQuotes.length });

          for (const quote of vendorQuotes) {
            const parsed = await parsePDFDocument(quote);
            if (parsed) {
              parsedQuoteData.push({
                documentId: quote.documentId,
                documentName: quote.documentName,
                ...parsed
              });
              documentsParsed++;
            }
          }

          logger.info('PDF parsing complete', { documentsParsed });
        }

        // Prepare data for AI analysis
        const bomItemsForAI = bomItems.map(item => ({
          id: item.id,
          name: item.name,
          make: item.make,
          sku: item.sku,
          description: item.description,
          quantity: item.quantity,
          price: item.price,
          category: item.category
        }));

        // Build quote data for AI - use parsed data or fall back to extractedText
        const quotesForAI = parsedQuoteData.length > 0
          ? parsedQuoteData.map(q => ({
              documentId: q.documentId,
              documentName: q.documentName,
              vendorName: q.documentInfo?.vendorName || 'Unknown',
              lineItems: q.lineItems || []
            }))
          : vendorQuotes.map(q => ({
              documentId: q.documentId,
              documentName: q.documentName,
              extractedText: q.extractedText || 'No text available'
            }));

        const systemPrompt = `You are a BOM compliance expert. Your task is to match vendor quote line items to BOM items and identify discrepancies.

Given BOM items and parsed vendor quote line items, you must:
1. Match quote line items to BOM items using:
   - SKU/Part number exact match (highest confidence)
   - Name similarity (medium confidence)
   - Make + partial name match (lower confidence)
2. Identify mismatches in quantity (flag any difference), price (flag if >15% different)
3. Flag BOM items that have no matching quote line

STRICT JSON OUTPUT:
{
  "quoteAnalysis": [
    {
      "documentId": "quote document ID",
      "documentName": "quote name",
      "vendorName": "vendor name",
      "lineMatches": [
        {
          "quoteLineItem": {
            "partName": "name from quote",
            "partNumber": "part number from quote or null",
            "make": "manufacturer or null",
            "quantity": number,
            "unitPrice": number
          },
          "bomItemId": "matched BOM item ID or null",
          "bomItemName": "matched BOM item name or null",
          "matchScore": 0-100,
          "matchReasons": ["reason1", "reason2"],
          "mismatches": ["mismatch description if any"]
        }
      ],
      "unmatchedQuoteLines": number,
      "unmatchedBOMItems": ["item IDs not matched"]
    }
  ],
  "suggestedFixes": [
    {
      "bomItemId": "item ID",
      "field": "name|description|sku|make|price",
      "currentValue": "current",
      "suggestedValue": "suggested based on quote",
      "reason": "why this change is suggested"
    }
  ]
}

CRITICAL: Return ONLY valid JSON. Be thorough in matching.`;

        const userPrompt = `BOM Items:
${JSON.stringify(bomItemsForAI, null, 2)}

Vendor Quotes (Parsed):
${JSON.stringify(quotesForAI, null, 2)}

Match the quote line items to BOM items. Flag any price or quantity mismatches.`;

        try {
          const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ],
              temperature: 0.1,
              max_tokens: 4000,
              response_format: { type: 'json_object' }
            })
          });

          if (openaiResponse.ok) {
            const data = await openaiResponse.json();
            const aiResult = JSON.parse(data.choices[0]?.message?.content || '{}');

            quoteAnalysis = aiResult.quoteAnalysis || [];

            // Process AI results to create issues
            quoteAnalysis.forEach(qa => {
              // Count matched items
              qa.lineMatches?.forEach(match => {
                if (match.bomItemId && match.matchScore >= 50) {
                  quotesMatched++;

                  // Add mismatch issues
                  match.mismatches?.forEach(mismatch => {
                    const mismatchType = mismatch.toLowerCase().includes('price') ? 'price-mismatch' :
                                         mismatch.toLowerCase().includes('quantity') ? 'quantity-mismatch' :
                                         'quote-mismatch';
                    addIssue({
                      bomItemId: match.bomItemId,
                      bomItemName: match.bomItemName || 'Unknown',
                      category: 'Unknown',
                      issueType: mismatchType,
                      severity: mismatchType === 'price-mismatch' ? 'warning' : 'info',
                      message: `Quote mismatch: ${mismatch}`,
                      details: `From quote: ${qa.documentName}`,
                      documentId: qa.documentId,
                      documentName: qa.documentName,
                      confidence: match.matchScore
                    });
                  });
                }
              });

              // Add issues for unmatched BOM items
              qa.unmatchedBOMItems?.forEach(itemId => {
                const item = bomItems.find(i => i.id === itemId);
                if (item) {
                  addIssue({
                    bomItemId: itemId,
                    bomItemName: item.name,
                    category: item.category || 'Unknown',
                    issueType: 'missing-quote',
                    severity: 'info',
                    message: 'No matching line in vendor quote',
                    details: `Item not found in quote: ${qa.documentName}`,
                    documentId: qa.documentId,
                    documentName: qa.documentName
                  });
                }
              });
            });

            // Process suggested fixes from AI
            aiResult.suggestedFixes?.forEach(fix => {
              const item = bomItems.find(i => i.id === fix.bomItemId);
              if (item && fix.suggestedValue && fix.suggestedValue !== fix.currentValue) {
                addIssue({
                  bomItemId: fix.bomItemId,
                  bomItemName: item.name,
                  category: item.category || 'Unknown',
                  issueType: fix.field === 'name' ? 'name-format' :
                             fix.field === 'description' ? 'description-mismatch' :
                             'invalid-sku',
                  severity: 'info',
                  message: `Suggested update for ${fix.field}`,
                  details: fix.reason,
                  currentValue: fix.currentValue,
                  suggestedFix: {
                    type: 'update-field',
                    field: fix.field,
                    suggestedValue: fix.suggestedValue,
                    description: fix.reason
                  },
                  confidence: 75
                });
              }
            });
          }
        } catch (aiError) {
          logger.error('AI analysis error:', aiError);
          // Continue without AI analysis - basic checks are still useful
        }
      }

      // Build final report
      const report = {
        id: `compliance-${Date.now()}`,
        projectId,
        createdAt: new Date().toISOString(),
        createdBy: 'system',
        status: 'completed',
        totalItemsChecked: bomItems.length,
        itemsWithIssues: new Set(issues.map(i => i.bomItemId)).size,
        totalIssues: issues.length,
        issuesByType,
        issuesBySeverity,
        quotesAnalyzed: vendorQuotes?.length || 0,
        documentsParsed,
        quotesMatched,
        quoteMismatches: issues.filter(i => i.issueType === 'quote-mismatch' ||
                                           i.issueType === 'price-mismatch' ||
                                           i.issueType === 'quantity-mismatch').length,
        issues,
        processingTimeMs: Date.now() - startTime
      };

      logger.info('Compliance check completed', {
        projectId,
        itemsChecked: bomItems.length,
        documentsParsed,
        issuesFound: issues.length,
        processingTimeMs: report.processingTimeMs
      });

      response.status(200).json({
        success: true,
        report,
        quoteAnalysis,
        parsedQuoteData
      });

    } catch (error) {
      logger.error('Error in compliance check:', error);
      response.status(500).json({
        error: 'Internal server error during compliance check',
        details: error.message
      });
    }
  }
);

/**
 * Trigger spec sheet search via n8n workflow
 * This function sends a request to n8n which will search for spec sheets
 * and then updates Firestore with the result
 */
exports.triggerSpecSearch = onRequest(
  async (request, response) => {
    // Enable CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    try {
      const { bomItemId, projectId, itemName, make, sku, userId } = request.body;

      // Validate required fields
      if (!bomItemId || !projectId || !itemName) {
        response.status(400).json({
          error: 'Missing required fields: bomItemId, projectId, itemName'
        });
        return;
      }

      // Production n8n webhook URL (workflow must be activated in n8n for this to work)
      const n8nWebhookUrl = 'https://n8n.qualitastech.com/webhook/spec-search';

      // Generate a unique search ID
      const searchId = `spec-search-${bomItemId}-${Date.now()}`;

      // Prepare the payload for n8n
      const n8nPayload = {
        searchId,
        bomItemId,
        projectId,
        itemName,
        make: make || '',
        sku: sku || '',
        userId: userId || 'system',
        timestamp: new Date().toISOString()
      };

      logger.info('Triggering n8n spec search', {
        searchId,
        bomItemId,
        itemName,
        make
      });

      // Call n8n webhook
      const n8nResponse = await fetch(n8nWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(n8nPayload)
      });

      if (!n8nResponse.ok) {
        const errorText = await n8nResponse.text();
        logger.error('n8n webhook error:', { status: n8nResponse.status, error: errorText });
        response.status(500).json({
          success: false,
          error: 'Failed to trigger spec search workflow'
        });
        return;
      }

      // Parse the n8n response which contains the spec URL
      const n8nResult = await n8nResponse.json();
      logger.info('n8n response:', n8nResult);

      // If n8n returned a specificationUrl, update the BOM item in Firestore
      if (n8nResult.success && n8nResult.specificationUrl) {
        try {
          // Get the BOM data document
          const bomDocRef = admin.firestore()
            .collection('projects')
            .doc(projectId)
            .collection('bom')
            .doc('data');

          const bomDoc = await bomDocRef.get();

          if (bomDoc.exists) {
            const bomData = bomDoc.data();
            let updated = false;

            // Find and update the item in categories
            if (bomData.categories && Array.isArray(bomData.categories)) {
              for (const category of bomData.categories) {
                if (category.items && Array.isArray(category.items)) {
                  const itemIndex = category.items.findIndex(item => item.id === bomItemId);
                  if (itemIndex !== -1) {
                    category.items[itemIndex].specificationUrl = n8nResult.specificationUrl;
                    category.items[itemIndex].updatedAt = new Date().toISOString();
                    updated = true;
                    break;
                  }
                }
              }
            }

            if (updated) {
              await bomDocRef.update({
                categories: bomData.categories,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              logger.info('Updated BOM item with spec URL', {
                bomItemId,
                specificationUrl: n8nResult.specificationUrl
              });
            }
          }
        } catch (firestoreError) {
          logger.error('Error updating Firestore:', firestoreError);
          // Don't fail the whole request, just log the error
        }
      }

      // Return success response
      response.status(200).json({
        success: true,
        searchId,
        status: 'completed',
        specificationUrl: n8nResult.specificationUrl || null,
        message: n8nResult.specificationUrl
          ? 'Spec sheet found and saved!'
          : 'Search completed but no spec sheet found.'
      });

    } catch (error) {
      logger.error('Error triggering spec search:', error);
      response.status(500).json({
        error: 'Internal server error',
        details: error.message
      });
    }
  }
);

// ==================== BOM STATUS DIGEST FUNCTIONS ====================

/**
 * Get ISO week string (e.g., "2026-W03")
 */
const getISOWeek = (date = new Date()) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
};

/**
 * Get last week's ISO week string
 */
const getLastISOWeek = () => {
  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  return getISOWeek(lastWeek);
};

/**
 * Save weekly snapshot for a project
 */
const saveWeeklySnapshot = async (db, projectId, summary) => {
  const weekOf = getISOWeek();
  const snapshotRef = db
    .collection('projects')
    .doc(projectId)
    .collection('weeklySnapshots')
    .doc(weekOf);

  await snapshotRef.set({
    projectId,
    weekOf,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    summary: {
      received: summary.received,
      ordered: summary.ordered,
      overdue: summary.overdue,
      pending: summary.pending,
      progressPercent: summary.progressPercent
    }
  });

  return weekOf;
};

/**
 * Get last week's snapshot for a project
 */
const getLastWeekSnapshot = async (db, projectId) => {
  const lastWeekId = getLastISOWeek();
  const snapshotRef = db
    .collection('projects')
    .doc(projectId)
    .collection('weeklySnapshots')
    .doc(lastWeekId);

  const snapshot = await snapshotRef.get();
  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data().summary;
};

/**
 * Calculate delta between current and last week's summary
 */
const calculateDelta = (current, lastWeek) => {
  if (!lastWeek) {
    return null; // First week, no delta to show
  }

  return {
    received: current.received - lastWeek.received,
    ordered: current.ordered - lastWeek.ordered,
    overdue: current.overdue - lastWeek.overdue,
    pending: current.pending - lastWeek.pending,
    progressPercent: current.progressPercent - lastWeek.progressPercent
  };
};

/**
 * Generate HTML email for BOM status digest
 */
const generateBOMDigestEmailHTML = ({
  projectName,
  clientName,
  clientLogo,
  companyName,
  reportDate,
  weekOf,
  summary,
  delta,
  overdueItems,
  arrivingSoonItems,
  pendingItems,
  recentChanges
}) => {
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getDaysText = (days) => {
    if (days === 1) return '1 day';
    return `${days} days`;
  };

  // Format delta with +/- sign and color
  const formatDelta = (value, isInverse = false) => {
    if (value === 0) return '';
    const isPositive = value > 0;
    // For some metrics like overdue/pending, increase is bad (inverse)
    const isGood = isInverse ? !isPositive : isPositive;
    const color = isGood ? '#16a34a' : '#dc2626';
    const sign = isPositive ? '+' : '';
    return `<span style="font-size: 12px; color: ${color}; margin-left: 4px;">(${sign}${value})</span>`;
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BOM Status Update</title>
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5;">
  <div style="max-width: 650px; margin: 0 auto; padding: 20px;">
    <!-- Header -->
    <div style="background: #1a365d; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
      <h1 style="margin: 0; font-size: 24px;">${companyName}</h1>
      <p style="margin: 5px 0 0 0; opacity: 0.9;">Weekly BOM Status Update</p>
      ${weekOf ? `<p style="margin: 5px 0 0 0; font-size: 12px; opacity: 0.7;">Week ${weekOf}</p>` : ''}
    </div>

    <!-- Project Info -->
    <div style="background: white; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <div style="display: flex; align-items: center; gap: 16px;">
        ${clientLogo ? `
        <div style="flex-shrink: 0;">
          <img src="${clientLogo}" alt="${clientName}" style="max-height: 60px; max-width: 120px; object-fit: contain;" />
        </div>
        ` : ''}
        <div style="flex: 1;">
          <p style="margin: 0;"><strong>Project:</strong> ${projectName}</p>
          <p style="margin: 5px 0 0 0;"><strong>Client:</strong> ${clientName}</p>
          <p style="margin: 5px 0 0 0;"><strong>Report Date:</strong> ${reportDate}</p>
        </div>
      </div>
    </div>

    <!-- Summary Section -->
    <div style="background: white; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #1a365d;">Summary ${delta ? '<span style="font-size: 12px; color: #666; font-weight: normal;">(vs last week)</span>' : ''}</h2>
      <div style="display: flex; justify-content: space-around; text-align: center;">
        <div style="flex: 1; padding: 10px;">
          <div style="font-size: 28px; font-weight: bold; color: #22c55e;">
            ${summary.received}${delta ? formatDelta(delta.received) : ''}
          </div>
          <div style="font-size: 12px; color: #666;">Received</div>
        </div>
        <div style="flex: 1; padding: 10px;">
          <div style="font-size: 28px; font-weight: bold; color: #3b82f6;">
            ${summary.ordered}${delta ? formatDelta(delta.ordered) : ''}
          </div>
          <div style="font-size: 12px; color: #666;">Ordered</div>
        </div>
        <div style="flex: 1; padding: 10px;">
          <div style="font-size: 28px; font-weight: bold; color: #ef4444;">
            ${summary.overdue}${delta ? formatDelta(delta.overdue, true) : ''}
          </div>
          <div style="font-size: 12px; color: #666;">Overdue</div>
        </div>
        <div style="flex: 1; padding: 10px;">
          <div style="font-size: 28px; font-weight: bold; color: #9ca3af;">
            ${summary.pending}${delta ? formatDelta(delta.pending, true) : ''}
          </div>
          <div style="font-size: 12px; color: #666;">Pending</div>
        </div>
      </div>
      <div style="margin-top: 15px; text-align: center;">
        <p style="margin: 0; font-size: 14px; color: #666;">
          Total Items: ${summary.total} | Progress: ${summary.progressPercent}%${delta ? formatDelta(delta.progressPercent) : ''}
        </p>
      </div>
    </div>

    ${overdueItems.length > 0 ? `
    <!-- Overdue Items -->
    <div style="background: #fef2f2; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #991b1b;">Overdue Items (${overdueItems.length})</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background: #fee2e2;">
          <th style="padding: 8px; text-align: left; font-size: 12px;">Item</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Expected</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Status</th>
        </tr>
        ${overdueItems.map(item => `
        <tr style="border-bottom: 1px solid #fecaca;">
          <td style="padding: 8px; font-size: 13px;">${item.name}</td>
          <td style="padding: 8px; font-size: 13px;">${formatDate(item.expectedArrival)}</td>
          <td style="padding: 8px; font-size: 13px;">
            <span style="background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 12px; font-size: 11px;">
              ${getDaysText(item.daysLate)} late
            </span>
          </td>
        </tr>
        `).join('')}
      </table>
    </div>
    ` : ''}

    ${arrivingSoonItems.length > 0 ? `
    <!-- Arriving Soon -->
    <div style="background: #fffbeb; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #92400e;">Arriving Soon (${arrivingSoonItems.length})</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background: #fef3c7;">
          <th style="padding: 8px; text-align: left; font-size: 12px;">Item</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Expected</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Days Left</th>
        </tr>
        ${arrivingSoonItems.map(item => `
        <tr style="border-bottom: 1px solid #fde68a;">
          <td style="padding: 8px; font-size: 13px;">${item.name}</td>
          <td style="padding: 8px; font-size: 13px;">${formatDate(item.expectedArrival)}</td>
          <td style="padding: 8px; font-size: 13px;">
            <span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 12px; font-size: 11px;">
              ${getDaysText(item.daysLeft)}
            </span>
          </td>
        </tr>
        `).join('')}
      </table>
    </div>
    ` : ''}

    ${pendingItems.length > 0 ? `
    <!-- Pending Items (Not Ordered) -->
    <div style="background: #f3f4f6; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #4b5563;">Pending Items - Not Yet Ordered (${pendingItems.length})</h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr style="background: #e5e7eb;">
          <th style="padding: 8px; text-align: left; font-size: 12px;">Item</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Quantity</th>
          <th style="padding: 8px; text-align: left; font-size: 12px;">Category</th>
        </tr>
        ${pendingItems.map(item => `
        <tr style="border-bottom: 1px solid #d1d5db;">
          <td style="padding: 8px; font-size: 13px;">${item.name}${item.make ? ` <span style="color: #6b7280; font-size: 11px;">(${item.make})</span>` : ''}</td>
          <td style="padding: 8px; font-size: 13px;">${item.quantity}</td>
          <td style="padding: 8px; font-size: 13px;">
            <span style="background: #e5e7eb; color: #4b5563; padding: 2px 8px; border-radius: 12px; font-size: 11px;">
              ${item.category || 'Uncategorized'}
            </span>
          </td>
        </tr>
        `).join('')}
      </table>
    </div>
    ` : ''}

    ${(recentChanges.ordered.length > 0 || recentChanges.received.length > 0) ? `
    <!-- Recent Changes -->
    <div style="background: white; padding: 20px; border-bottom: 1px solid #e5e7eb;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #1a365d;">Changes Since Last Update</h2>

      ${recentChanges.received.length > 0 ? `
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #166534;">Received</h3>
        <ul style="margin: 0; padding-left: 20px;">
          ${recentChanges.received.map(item => `
          <li style="margin-bottom: 5px; font-size: 13px;">${item.name} - Received ${formatDate(item.actualArrival)}</li>
          `).join('')}
        </ul>
      </div>
      ` : ''}

      ${recentChanges.ordered.length > 0 ? `
      <div>
        <h3 style="margin: 0 0 10px 0; font-size: 14px; color: #1d4ed8;">Newly Ordered</h3>
        <ul style="margin: 0; padding-left: 20px;">
          ${recentChanges.ordered.map(item => `
          <li style="margin-bottom: 5px; font-size: 13px;">${item.name} - Expected ${formatDate(item.expectedArrival)}</li>
          `).join('')}
        </ul>
      </div>
      ` : ''}
    </div>
    ` : ''}

    <!-- Footer -->
    <div style="background: #f3f4f6; padding: 20px; text-align: center; border-radius: 0 0 8px 8px;">
      <p style="margin: 0; font-size: 12px; color: #666;">
        This is an automated notification from BOM Tracker.
      </p>
      <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">
        To stop receiving these updates, contact your project manager.
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

/**
 * Helper to calculate BOM digest data from categories
 */
const calculateBOMDigestData = (categories, lastNotificationSentAt) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const allItems = categories.flatMap(cat => cat.items || []);
  const components = allItems.filter(item => item.itemType !== 'service');

  // Summary counts
  const received = components.filter(item => item.status === 'received').length;
  const ordered = components.filter(item => item.status === 'ordered').length;
  const pending = components.filter(item => item.status === 'not-ordered').length;
  const total = components.length;

  // Calculate overdue and arriving soon
  const overdueItems = [];
  const arrivingSoonItems = [];

  components.forEach(item => {
    if (item.status === 'ordered' && item.expectedArrival) {
      const expectedDate = new Date(item.expectedArrival);
      expectedDate.setHours(0, 0, 0, 0);
      const diffDays = Math.ceil((expectedDate - today) / (1000 * 60 * 60 * 24));

      if (diffDays < 0) {
        overdueItems.push({
          ...item,
          daysLate: Math.abs(diffDays)
        });
      } else if (diffDays <= 7) {
        arrivingSoonItems.push({
          ...item,
          daysLeft: diffDays
        });
      }
    }
  });

  // Sort by urgency
  overdueItems.sort((a, b) => b.daysLate - a.daysLate);
  arrivingSoonItems.sort((a, b) => a.daysLeft - b.daysLeft);

  // Calculate recent changes (since last notification)
  const recentChanges = { ordered: [], received: [] };

  if (lastNotificationSentAt) {
    const lastSentDate = lastNotificationSentAt instanceof Date
      ? lastNotificationSentAt
      : lastNotificationSentAt.toDate();

    components.forEach(item => {
      // Check for newly ordered items
      if (item.status === 'ordered' && item.orderDate) {
        const orderDate = new Date(item.orderDate);
        if (orderDate > lastSentDate) {
          recentChanges.ordered.push(item);
        }
      }

      // Check for newly received items
      if (item.status === 'received' && item.actualArrival) {
        const arrivalDate = new Date(item.actualArrival);
        if (arrivalDate > lastSentDate) {
          recentChanges.received.push(item);
        }
      }
    });
  } else {
    // First notification - show all ordered/received as recent
    recentChanges.ordered = components.filter(item => item.status === 'ordered');
    recentChanges.received = components.filter(item => item.status === 'received');
  }

  const progressPercent = total > 0 ? Math.round((received / total) * 100) : 0;

  // Get pending items (not ordered yet)
  const pendingItems = components.filter(item => item.status === 'not-ordered');

  return {
    summary: {
      total,
      received,
      ordered,
      overdue: overdueItems.length,
      pending,
      progressPercent
    },
    overdueItems,
    arrivingSoonItems,
    pendingItems,
    recentChanges
  };
};

/**
 * Send BOM digest for a single project to all enabled stakeholders
 */
/**
 * Collect all notification recipients from the project document (members + externalRecipients).
 * Mirrors the pure frontend helper getNotificationRecipients in projectFirestore.ts.
 */
const getNotificationRecipientsFromProjectData = (projectData) => {
  const recipients = [];
  for (const m of projectData.members || []) {
    if (m.notificationsEnabled !== false && m.email) {
      recipients.push({ email: m.email, name: m.displayName || m.email });
    }
  }
  for (const r of projectData.externalRecipients || []) {
    if (r.notificationsEnabled !== false && r.email) {
      recipients.push({ email: r.email, name: r.name || r.email });
    }
  }
  return recipients;
};

const sendProjectDigest = async (projectId, projectData, prSettings, resendApiKeyValue) => {
  const db = admin.firestore();
  const results = { sent: 0, failed: 0, skipped: 0 };

  // Collect recipients from project document (replaces stakeholders subcollection)
  const recipients = getNotificationRecipientsFromProjectData(projectData);

  if (recipients.length === 0) {
    logger.info('No enabled notification recipients for project', { projectId });
    return results;
  }

  // Get BOM data
  const bomDocRef = db.collection('projects').doc(projectId).collection('bom').doc('data');
  const bomDoc = await bomDocRef.get();

  if (!bomDoc.exists || !bomDoc.data().categories) {
    logger.info('No BOM data for project', { projectId });
    return results;
  }

  const categories = bomDoc.data().categories;
  const reportDate = new Date().toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  // Get current week identifier
  const weekOf = getISOWeek();

  // Get last week's snapshot for delta comparison
  let lastWeekSummary = null;
  try {
    lastWeekSummary = await getLastWeekSnapshot(db, projectId);
    if (lastWeekSummary) {
      logger.info('Found last week snapshot for delta', { projectId, lastWeekId: getLastISOWeek() });
    }
  } catch (error) {
    logger.warn('Could not fetch last week snapshot', { projectId, error: error.message });
  }

  // Try to get client logo by looking up client by company name
  let clientLogo = null;
  if (projectData.clientName) {
    try {
      const clientsSnapshot = await db.collection('clients')
        .where('company', '==', projectData.clientName)
        .limit(1)
        .get();
      if (!clientsSnapshot.empty) {
        const clientData = clientsSnapshot.docs[0].data();
        clientLogo = clientData.logo || null;
      }
    } catch (error) {
      logger.warn('Could not fetch client logo', { clientName: projectData.clientName, error: error.message });
    }
  }

  // Calculate digest data once — same content for all recipients
  const digestData = calculateBOMDigestData(categories, null);

  // Calculate delta from last week
  const delta = calculateDelta(digestData.summary, lastWeekSummary);

  // Save this week's snapshot (do this once per project, not per stakeholder)
  let snapshotSaved = false;

  // Generate digest HTML
  const htmlContent = generateBOMDigestEmailHTML({
    projectName: projectData.projectName,
    clientName: projectData.clientName,
    clientLogo: clientLogo,
    companyName: prSettings.companyName || 'Qualitas Technologies Pvt Ltd',
    reportDate,
    weekOf,
    delta,
    ...digestData
  });

  const resend = new Resend(resendApiKeyValue);

  // Send email to each recipient
  for (const recipient of recipients) {
    try {
      const emailData = {
        from: prSettings.fromEmail || 'info@qualitastech.com',
        to: recipient.email,
        subject: `[${projectData.projectName}] - Weekly BOM Status Update (${weekOf})`,
        html: htmlContent,
        text: stripHtml(htmlContent)
      };

      await resend.emails.send(emailData);

      // Save this week's snapshot once after the first successful send
      if (!snapshotSaved) {
        try {
          await saveWeeklySnapshot(db, projectId, digestData.summary);
          snapshotSaved = true;
          logger.info('Saved weekly snapshot', { projectId, weekOf });
        } catch (snapshotError) {
          logger.warn('Could not save weekly snapshot', { projectId, error: snapshotError.message });
        }
      }

      results.sent++;
      logger.info('Weekly digest sent', { projectId, recipientEmail: recipient.email, itemsTotal: digestData.summary.total });

    } catch (error) {
      logger.error('Failed to send digest', {
        projectId,
        recipientEmail: recipient.email,
        errorMessage: error.message,
        errorCode: error.code,
        stack: error.stack
      });

      if (error.code === 401 || error.message?.includes('Unauthorized') || error.message?.includes('Invalid API key')) {
        results.authError = 'Resend API key invalid or expired';
      } else if (error.code === 403 || error.message?.includes('Forbidden') || error.message?.includes('Domain not verified')) {
        results.authError = 'Sender email not verified in Resend';
      }

      results.failed++;
      results.lastError = error.message;
    }
  }

  return results;
};

/**
 * Weekly scheduled function to send BOM status digests
 * Runs at 9:00 AM IST every Monday
 */
exports.sendWeeklyBOMDigest = onSchedule(
  {
    schedule: 'every monday 09:00',
    timeZone: 'Asia/Kolkata',
    secrets: [resendApiKey]
  },
  async (event) => {
    logger.info('Starting weekly BOM digest job');
    const startTime = Date.now();
    const db = admin.firestore();

    try {
      // Get Resend API key for passing to sendProjectDigest
      const resendApiKeyValue = getResendApiKey();

      // Get PR settings for email config
      const prSettingsDoc = await db.collection('settings').doc('purchaseRequest').get();
      const prSettings = prSettingsDoc.exists ? prSettingsDoc.data() : {};

      // Get all active projects
      const projectsSnapshot = await db.collection('projects')
        .where('status', 'in', ['Planning', 'Ongoing', 'Delayed'])
        .get();

      if (projectsSnapshot.empty) {
        logger.info('No active projects found');
        return;
      }

      const results = { projectsProcessed: 0, totalSent: 0, totalFailed: 0 };

      // Process each project
      for (const projectDoc of projectsSnapshot.docs) {
        const projectData = projectDoc.data();
        const projectId = projectDoc.id;

        try {
          const projectResults = await sendProjectDigest(projectId, projectData, prSettings, resendApiKeyValue);
          results.projectsProcessed++;
          results.totalSent += projectResults.sent;
          results.totalFailed += projectResults.failed;
        } catch (error) {
          logger.error('Error processing project', { projectId, error: error.message });
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Weekly BOM digest job completed', {
        ...results,
        durationMs: duration
      });

    } catch (error) {
      logger.error('Weekly BOM digest job failed', { error: error.message });
      throw error;
    }
  }
);

/**
 * Manual trigger to send BOM digest immediately for a project
 * Called from the UI "Send Update Now" button
 */
exports.sendBOMDigestNow = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { auth, data } = request;

    if (!auth) {
      throw new Error('Authentication required');
    }

    const { projectId } = data;
    if (!projectId) {
      throw new Error('Project ID is required');
    }

    logger.info('Manual BOM digest triggered', { projectId, userId: auth.uid });

    const db = admin.firestore();

    try {
      // Get Resend API key for passing to sendProjectDigest
      const resendApiKeyValue = getResendApiKey();

      // Get project data
      const projectDoc = await db.collection('projects').doc(projectId).get();
      if (!projectDoc.exists) {
        throw new Error('Project not found');
      }
      const projectData = projectDoc.data();

      // Get PR settings for email config
      const prSettingsDoc = await db.collection('settings').doc('purchaseRequest').get();
      const prSettings = prSettingsDoc.exists ? prSettingsDoc.data() : {};

      // Send digest
      const results = await sendProjectDigest(projectId, projectData, prSettings, resendApiKeyValue);

      logger.info('Manual BOM digest completed', { projectId, results });

      // Check if there was an auth error
      if (results.authError) {
        return {
          success: false,
          message: results.authError,
          ...results
        };
      }

      if (results.sent === 0 && results.failed > 0) {
        return {
          success: false,
          message: `Failed to send to ${results.failed} recipient(s). ${results.lastError || ''}`,
          ...results
        };
      }

      return {
        success: true,
        message: `Digest sent to ${results.sent} recipient(s)`,
        ...results
      };

    } catch (error) {
      // Log detailed error
      logger.error('Manual BOM digest failed', {
        projectId,
        errorMessage: error.message,
        errorCode: error.code,
        stack: error.stack
      });

      // Provide user-friendly error messages
      let userMessage = 'Failed to send digest';
      if (error.code === 401 || error.message?.includes('Unauthorized') || error.message?.includes('Invalid API key')) {
        userMessage = 'Email service authentication failed. The Resend API key may be invalid or expired.';
      } else if (error.message?.includes('Project not found')) {
        userMessage = 'Project not found. Please refresh and try again.';
      } else if (error.message?.includes('No enabled notification recipients')) {
        userMessage = 'No recipients with notifications enabled. Add members or email recipients first.';
      }

      throw new Error(`${userMessage}`);
    }
  }
);

/**
 * Generate HTML email for BOM update notifications
 */
const generateBOMUpdateEmailHTML = ({
  projectName,
  clientName,
  companyName,
  changeType,
  changes,
  updatedAt
}) => {
  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const getChangeIcon = (type) => {
    switch (type) {
      case 'added': return '➕';
      case 'removed': return '➖';
      case 'status_ordered': return '📦';
      case 'status_received': return '✅';
      case 'modified': return '✏️';
      default: return '🔔';
    }
  };

  const getChangeTitle = (type) => {
    switch (type) {
      case 'added': return 'Items Added';
      case 'removed': return 'Items Removed';
      case 'status_ordered': return 'Items Ordered';
      case 'status_received': return 'Items Received';
      case 'modified': return 'Items Modified';
      default: return 'Changes';
    }
  };

  const getChangeColor = (type) => {
    switch (type) {
      case 'added': return '#166534';
      case 'removed': return '#dc2626';
      case 'status_ordered': return '#1d4ed8';
      case 'status_received': return '#166534';
      case 'modified': return '#d97706';
      default: return '#374151';
    }
  };

  // Group changes by type
  const groupedChanges = {};
  changes.forEach(change => {
    const type = change.changeType || 'modified';
    if (!groupedChanges[type]) {
      groupedChanges[type] = [];
    }
    groupedChanges[type].push(change);
  });

  const changesSections = Object.entries(groupedChanges).map(([type, items]) => `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 10px 0; font-size: 14px; color: ${getChangeColor(type)};">
        ${getChangeIcon(type)} ${getChangeTitle(type)} (${items.length})
      </h3>
      <ul style="margin: 0; padding-left: 20px;">
        ${items.map(item => `
        <li style="margin-bottom: 8px; font-size: 13px;">
          <strong>${item.name}</strong>
          ${item.details ? `<br><span style="color: #666; font-size: 12px;">${item.details}</span>` : ''}
        </li>
        `).join('')}
      </ul>
    </div>
  `).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 20px; background-color: #f3f4f6; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); padding: 25px; text-align: center;">
      <h1 style="margin: 0; color: white; font-size: 20px; font-weight: 600;">${companyName}</h1>
      <p style="margin: 5px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">BOM Update Notification</p>
    </div>

    <!-- Project Info -->
    <div style="background: #f8fafc; padding: 15px 20px; border-bottom: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 14px; color: #374151;">
        <strong>Project:</strong> ${projectName}
        ${clientName ? `<br><strong>Client:</strong> ${clientName}` : ''}
      </p>
      <p style="margin: 5px 0 0 0; font-size: 12px; color: #6b7280;">
        Updated: ${formatDate(updatedAt)}
      </p>
    </div>

    <!-- Changes -->
    <div style="padding: 20px;">
      <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #1a365d;">What Changed</h2>
      ${changesSections}
    </div>

    <!-- CTA -->
    <div style="padding: 0 20px 20px 20px; text-align: center;">
      <p style="margin: 0 0 15px 0; font-size: 13px; color: #666;">
        View the full BOM details in the BOM Tracker application.
      </p>
    </div>

    <!-- Footer -->
    <div style="background: #f3f4f6; padding: 20px; text-align: center; border-radius: 0 0 8px 8px;">
      <p style="margin: 0; font-size: 12px; color: #666;">
        This is an automated notification from BOM Tracker.
      </p>
      <p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">
        To stop receiving these updates, contact your project manager.
      </p>
    </div>
  </div>
</body>
</html>
  `;
};

/**
 * Detect meaningful changes between old and new BOM data
 */
const detectBOMChanges = (beforeData, afterData) => {
  const changes = [];

  const beforeItems = beforeData?.categories?.flatMap(cat => cat.items || []) || [];
  const afterItems = afterData?.categories?.flatMap(cat => cat.items || []) || [];

  // Create maps for quick lookup
  const beforeMap = new Map(beforeItems.map(item => [item.id, item]));
  const afterMap = new Map(afterItems.map(item => [item.id, item]));

  // Check for added items
  afterItems.forEach(item => {
    if (!beforeMap.has(item.id)) {
      changes.push({
        changeType: 'added',
        name: item.name,
        details: `Category: ${item.category}${item.quantity ? `, Qty: ${item.quantity}` : ''}`
      });
    }
  });

  // Check for removed items
  beforeItems.forEach(item => {
    if (!afterMap.has(item.id)) {
      changes.push({
        changeType: 'removed',
        name: item.name,
        details: `Category: ${item.category}`
      });
    }
  });

  // Check for status changes (ordered/received)
  afterItems.forEach(afterItem => {
    const beforeItem = beforeMap.get(afterItem.id);
    if (beforeItem) {
      // Status changed to ordered
      if (beforeItem.status !== 'ordered' && afterItem.status === 'ordered') {
        changes.push({
          changeType: 'status_ordered',
          name: afterItem.name,
          details: afterItem.expectedArrival
            ? `Expected: ${new Date(afterItem.expectedArrival).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
            : (afterItem.finalizedVendor?.name ? `Vendor: ${afterItem.finalizedVendor.name}` : null)
        });
      }

      // Status changed to received
      if (beforeItem.status !== 'received' && afterItem.status === 'received') {
        changes.push({
          changeType: 'status_received',
          name: afterItem.name,
          details: afterItem.actualArrival
            ? `Received: ${new Date(afterItem.actualArrival).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
            : null
        });
      }

      // Price changed (significant)
      if (beforeItem.price !== afterItem.price && afterItem.price) {
        const priceDiff = afterItem.price - (beforeItem.price || 0);
        if (Math.abs(priceDiff) > 0) {
          changes.push({
            changeType: 'modified',
            name: afterItem.name,
            details: `Price updated: ₹${afterItem.price.toLocaleString('en-IN')}`
          });
        }
      }

      // Quantity changed
      if (beforeItem.quantity !== afterItem.quantity) {
        changes.push({
          changeType: 'modified',
          name: afterItem.name,
          details: `Quantity: ${beforeItem.quantity} → ${afterItem.quantity}`
        });
      }
    }
  });

  return changes;
};

/**
 * Firestore trigger: Send notification emails when BOM is updated
 * Triggers on any write to projects/{projectId}/bom/data
 */
exports.onBOMUpdate = onDocumentWritten(
  {
    document: 'projects/{projectId}/bom/data',
    secrets: [resendApiKey]
  },
  async (event) => {
    const projectId = event.params.projectId;
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();

    // Skip if document was deleted
    if (!afterData) {
      logger.info('BOM document deleted, skipping notification', { projectId });
      return;
    }

    // Skip if document was just created (no before data) - this is initial import
    if (!beforeData) {
      logger.info('BOM document created, skipping notification for initial creation', { projectId });
      return;
    }

    // Detect meaningful changes
    const changes = detectBOMChanges(beforeData, afterData);

    if (changes.length === 0) {
      logger.info('No meaningful BOM changes detected, skipping notification', { projectId });
      return;
    }

    logger.info('BOM changes detected', { projectId, changeCount: changes.length, changes: changes.slice(0, 5) });

    const db = admin.firestore();

    try {
      // Get project data
      const projectDoc = await db.collection('projects').doc(projectId).get();
      if (!projectDoc.exists) {
        logger.error('Project not found', { projectId });
        return;
      }
      const projectData = projectDoc.data();

      // Collect recipients from project document
      const notifRecipients = getNotificationRecipientsFromProjectData(projectData);

      if (notifRecipients.length === 0) {
        logger.info('No enabled notification recipients for BOM update', { projectId });
        return;
      }

      // Get PR settings for email config
      const prSettingsDoc = await db.collection('settings').doc('purchaseRequest').get();
      const prSettings = prSettingsDoc.exists ? prSettingsDoc.data() : {};

      // Initialize Resend
      const resend = new Resend(getResendApiKey());

      const companyName = prSettings.companyName || 'Qualitas Technologies Pvt Ltd';
      const fromEmail = prSettings.fromEmail || 'info@qualitastech.com';
      const updatedAt = new Date().toISOString();

      // Determine change type summary for subject
      const changeTypes = [...new Set(changes.map(c => c.changeType))];
      let changeTypeSummary = 'Updated';
      if (changeTypes.length === 1) {
        switch (changeTypes[0]) {
          case 'added': changeTypeSummary = 'Items Added'; break;
          case 'removed': changeTypeSummary = 'Items Removed'; break;
          case 'status_ordered': changeTypeSummary = 'Items Ordered'; break;
          case 'status_received': changeTypeSummary = 'Items Received'; break;
          default: changeTypeSummary = 'Updated';
        }
      } else if (changeTypes.includes('status_ordered') || changeTypes.includes('status_received')) {
        changeTypeSummary = 'Status Updated';
      }

      // Generate email HTML
      const htmlContent = generateBOMUpdateEmailHTML({
        projectName: projectData.projectName,
        clientName: projectData.clientName,
        companyName,
        changeType: changeTypeSummary,
        changes,
        updatedAt
      });

      let sentCount = 0;
      let failedCount = 0;

      // Send email to each recipient
      for (const recipient of notifRecipients) {
        try {
          const emailData = {
            from: fromEmail,
            to: recipient.email,
            subject: `[${projectData.projectName}] BOM ${changeTypeSummary} - ${changes.length} change(s)`,
            html: htmlContent,
            text: stripHtml(htmlContent)
          };

          await resend.emails.send(emailData);
          sentCount++;

          logger.info('BOM update notification sent', {
            projectId,
            recipientEmail: recipient.email,
            changeCount: changes.length
          });

        } catch (error) {
          logger.error('Failed to send BOM update notification', {
            projectId,
            recipientEmail: recipient.email,
            error: error.message
          });
          failedCount++;
        }
      }

      logger.info('BOM update notifications completed', {
        projectId,
        sentCount,
        failedCount,
        totalChanges: changes.length
      });

    } catch (error) {
      logger.error('BOM update notification job failed', {
        projectId,
        error: error.message
      });
    }
  }
);

// ============================================
// Purchase Order PDF Generation
// ============================================

/**
 * Safely format a date value (handles Firestore Timestamps, Date objects, ISO strings, and null)
 */
function formatDateSafe(dateValue) {
  // Handle null, undefined, or falsy values
  if (dateValue === null || dateValue === undefined) return '-';
  
  // Use try-catch to handle any unexpected date formats or null property access
  try {
    let date;
    
    // Handle Firestore Timestamp (has _seconds property when serialized)
    // Check if dateValue is an object and has _seconds property that is not null
    if (typeof dateValue === 'object' && dateValue !== null && 
        '_seconds' in dateValue && dateValue._seconds !== null && dateValue._seconds !== undefined) {
      date = new Date(dateValue._seconds * 1000);
    }
    // Handle Firestore Timestamp (has seconds property)
    else if (typeof dateValue === 'object' && dateValue !== null && 
             'seconds' in dateValue && dateValue.seconds !== null && dateValue.seconds !== undefined) {
      date = new Date(dateValue.seconds * 1000);
    }
    // Handle ISO string or timestamp number
    else if (typeof dateValue === 'string' || typeof dateValue === 'number') {
      date = new Date(dateValue);
    }
    // Handle Date object
    else if (dateValue instanceof Date) {
      date = dateValue;
    }
    else {
      return '-';
    }

    // Check if valid date
    if (!date || isNaN(date.getTime())) return '-';

    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (error) {
    // If any error occurs during date formatting, return '-'
    logger.warn('Error formatting date', { error: error.message, dateValue });
    return '-';
  }
}

/**
 * Format currency in Indian format (₹1,23,456.00)
 */
function formatIndianCurrency(amount) {
  // Use "Rs." instead of "₹" because PDFKit's Helvetica font doesn't support the Rupee symbol
  if (amount === undefined || amount === null || isNaN(amount)) return 'Rs. 0.00';
  const num = parseFloat(amount);
  const formatted = num.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `Rs. ${formatted}`;
}

/**
 * Convert number to words (Indian numbering system)
 */
function numberToWords(num) {
  if (num === 0) return 'Zero Rupees Only';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const hundred = Math.floor((num % 1000) / 100);
  const remainder = Math.floor(num % 100);
  const paise = Math.round((num % 1) * 100);

  let words = '';

  if (crore > 0) {
    if (crore < 20) words += ones[crore];
    else words += tens[Math.floor(crore / 10)] + (crore % 10 ? ' ' + ones[crore % 10] : '');
    words += ' Crore ';
  }

  if (lakh > 0) {
    if (lakh < 20) words += ones[lakh];
    else words += tens[Math.floor(lakh / 10)] + (lakh % 10 ? ' ' + ones[lakh % 10] : '');
    words += ' Lakh ';
  }

  if (thousand > 0) {
    if (thousand < 20) words += ones[thousand];
    else words += tens[Math.floor(thousand / 10)] + (thousand % 10 ? ' ' + ones[thousand % 10] : '');
    words += ' Thousand ';
  }

  if (hundred > 0) {
    words += ones[hundred] + ' Hundred ';
  }

  if (remainder > 0) {
    if (remainder < 20) words += ones[remainder];
    else words += tens[Math.floor(remainder / 10)] + (remainder % 10 ? ' ' + ones[remainder % 10] : '');
  }

  words = words.trim() + ' Rupees';

  if (paise > 0) {
    words += ' and ';
    if (paise < 20) words += ones[paise];
    else words += tens[Math.floor(paise / 10)] + (paise % 10 ? ' ' + ones[paise % 10] : '');
    words += ' Paise';
  }

  return words + ' Only';
}

/**
 * Recompute one project's full stakeholder set (its own members/externalRecipients
 * plus its client's active CRM contacts) and apply the delta against
 * projectStakeholderCache/{projectId} (the last-synced set) to stakeholderIndex.
 * Shared by both syncStakeholderIndex (fires on project writes) and
 * syncStakeholderIndexFromClient (fires on client writes, fans out to every
 * project of that client) so a CRM contact added once is a stakeholder on
 * every project for that client without re-entering them per project.
 */
async function syncProjectStakeholderIndex(db, projectId, projectData) {
  let clientData;
  if (projectData && projectData.clientId) {
    const clientSnap = await db.collection('clients').doc(projectData.clientId).get();
    clientData = clientSnap.exists ? clientSnap.data() : undefined;
  }
  const afterEmails = projectData ? computeProjectStakeholderEmails(projectData, clientData) : new Set();

  const cacheRef = db.collection('projectStakeholderCache').doc(projectId);
  const cacheSnap = await cacheRef.get();
  const beforeEmails = new Set(cacheSnap.exists ? cacheSnap.data().emails || [] : []);

  const { added, removed } = diffEmailSets(beforeEmails, afterEmails);
  if (added.length === 0 && removed.length === 0) return;

  const indexCol = db.collection('stakeholderIndex');
  await Promise.all([
    ...added.map(async (email) => {
      const ref = indexCol.doc(email);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const projectIds = new Set(snap.exists ? snap.data().projectIds || [] : []);
        projectIds.add(projectId);
        tx.set(ref, { projectIds: [...projectIds] });
      });
    }),
    ...removed.map(async (email) => {
      const ref = indexCol.doc(email);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const projectIds = new Set(snap.data().projectIds || []);
        projectIds.delete(projectId);
        if (projectIds.size === 0) {
          tx.delete(ref);
        } else {
          tx.set(ref, { projectIds: [...projectIds] });
        }
      });
    }),
  ]);

  if (afterEmails.size === 0) {
    await cacheRef.delete();
  } else {
    await cacheRef.set({ emails: [...afterEmails] });
  }

  logger.info('syncProjectStakeholderIndex updated', { projectId, added, removed });
}

/**
 * Firestore trigger: keep stakeholderIndex/{email} -> { projectIds } in sync
 * with each project's own members + externalRecipients (and, via
 * syncProjectStakeholderIndex, its client's CRM contacts), so the Fathom
 * webhook can look up "which project(s) is this attendee a stakeholder of"
 * in O(1) reads instead of scanning every project.
 */
exports.syncStakeholderIndex = onDocumentWritten(
  { document: 'projects/{projectId}' },
  async (event) => {
    const projectId = event.params.projectId;
    const afterData = event.data?.after?.data();
    await syncProjectStakeholderIndex(admin.firestore(), projectId, afterData);
  }
);

/**
 * Firestore trigger: when a client's CRM contacts change, resync
 * stakeholderIndex for every project that belongs to that client — a contact
 * added once (the same list Support tickets already use via
 * reportedByContactId) becomes a meeting stakeholder on all of that client's
 * projects without being re-entered per project.
 */
exports.syncStakeholderIndexFromClient = onDocumentWritten(
  { document: 'clients/{clientId}' },
  async (event) => {
    const clientId = event.params.clientId;
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();

    const { added, removed } = diffEmailSets(
      extractClientContactEmails(beforeData),
      extractClientContactEmails(afterData)
    );
    if (added.length === 0 && removed.length === 0) return;

    const db = admin.firestore();
    const projectsSnap = await db.collection('projects').where('clientId', '==', clientId).get();
    await Promise.all(
      projectsSnap.docs.map((doc) => syncProjectStakeholderIndex(db, doc.id, doc.data()))
    );

    logger.info('syncStakeholderIndexFromClient resynced projects', {
      clientId,
      projectCount: projectsSnap.size,
    });
  }
);

/**
 * Fathom "new meeting content ready" webhook. Verifies the Svix signature,
 * normalizes the payload, matches attendees against stakeholderIndex, and
 * files the meeting under the single matched project or into
 * unassignedMeetings for manual triage. No transcript is stored.
 */
exports.fathomMeetingWebhook = onRequest(
  { secrets: [fathomWebhookSecret] },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed');
      return;
    }

    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const valid = verifySvixSignature({
      id: req.get('webhook-id'),
      timestamp: req.get('webhook-timestamp'),
      signatureHeader: req.get('webhook-signature'),
      rawBody,
      secret: fathomWebhookSecret.value(),
    });

    if (!valid) {
      logger.warn('fathomMeetingWebhook: invalid or missing signature');
      res.status(401).send('Invalid signature');
      return;
    }

    const meeting = normalizeFathomPayload(req.body);
    if (!meeting.fathomRecordingId) {
      res.status(400).send('Missing recording id');
      return;
    }

    const db = admin.firestore();
    const dedupRef = db.collection('fathomIngestedMeetings').doc(meeting.fathomRecordingId);
    const dedupSnap = await dedupRef.get();
    if (dedupSnap.exists) {
      logger.info('fathomMeetingWebhook: already ingested, skipping', {
        fathomRecordingId: meeting.fathomRecordingId,
      });
      res.status(200).send('Already ingested');
      return;
    }

    const attendeeEmails = meeting.attendees.map((a) => a.email);
    const lookups = await Promise.all(
      [...new Set(attendeeEmails.map((e) => String(e || '').toLowerCase().trim()).filter(Boolean))]
        .map(async (email) => {
          const snap = await db.collection('stakeholderIndex').doc(email).get();
          return [email, snap.exists ? snap.data().projectIds || [] : []];
        })
    );
    const emailToProjectIds = Object.fromEntries(lookups);
    const matchedProjectIds = collectMatchedProjectIds(attendeeEmails, emailToProjectIds);

    const baseDoc = {
      fathomRecordingId: meeting.fathomRecordingId,
      title: meeting.title,
      shareUrl: meeting.shareUrl,
      startedAt: meeting.startedAt ? new Date(meeting.startedAt) : admin.firestore.FieldValue.serverTimestamp(),
      endedAt: meeting.endedAt ? new Date(meeting.endedAt) : admin.firestore.FieldValue.serverTimestamp(),
      hostEmail: meeting.hostEmail,
      attendees: meeting.attendees,
      summary: meeting.summary,
      actionItems: meeting.actionItems,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (matchedProjectIds.length === 1) {
      const [projectId] = matchedProjectIds;
      await db
        .collection('projects')
        .doc(projectId)
        .collection('meetings')
        .doc(meeting.fathomRecordingId)
        .set({ ...baseDoc, matchedStakeholderEmails: attendeeEmails });
      logger.info('fathomMeetingWebhook: matched to project', { projectId, fathomRecordingId: meeting.fathomRecordingId });
    } else {
      await db
        .collection('unassignedMeetings')
        .doc(meeting.fathomRecordingId)
        .set({ ...baseDoc, candidateProjectIds: matchedProjectIds });
      logger.info('fathomMeetingWebhook: unassigned', {
        candidateCount: matchedProjectIds.length,
        fathomRecordingId: meeting.fathomRecordingId,
      });
    }

    await dedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp() });
    res.status(200).send('OK');
  }
);

/** Move an unassigned meeting into a project's meetings subcollection. Admin only. */
exports.assignUnassignedMeeting = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) {
    throw new Error('Authentication required');
  }
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }

  const { meetingId, projectId } = data;
  if (!meetingId || !projectId) {
    throw new Error('meetingId and projectId are required');
  }

  const db = admin.firestore();
  const unassignedRef = db.collection('unassignedMeetings').doc(meetingId);
  const snap = await unassignedRef.get();
  if (!snap.exists) {
    throw new Error('Meeting not found');
  }
  const { candidateProjectIds, ...meetingData } = snap.data();
  const projectMeetingRef = db.collection('projects').doc(projectId).collection('meetings').doc(meetingId);

  await db.runTransaction(async (tx) => {
    tx.set(projectMeetingRef, {
      ...meetingData,
      matchedStakeholderEmails: meetingData.attendees?.map((a) => a.email) || [],
    });
    tx.delete(unassignedRef);
  });

  logger.info('assignUnassignedMeeting: assigned', { meetingId, projectId, by: auth.uid });
  return { success: true };
});

/** Discard an unassigned meeting that isn't actually project-related. Admin only. */
exports.discardUnassignedMeeting = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) {
    throw new Error('Authentication required');
  }
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new Error('Admin privileges required');
  }

  const { meetingId } = data;
  if (!meetingId) {
    throw new Error('meetingId is required');
  }

  await admin.firestore().collection('unassignedMeetings').doc(meetingId).delete();
  logger.info('discardUnassignedMeeting: discarded', { meetingId, by: auth.uid });
  return { success: true };
});

/**
 * Connect the caller's own Gmail account: exchange an OAuth code for a
 * refresh token and store it server-only. Requires only auth (not admin) —
 * a user can only ever connect their own gmailConnections/{uid} doc.
 */
exports.connectGmailAccount = onCall(
  { secrets: [googleOAuthClientId, googleOAuthClientSecret] },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }
    const callerRecord = await admin.auth().getUser(auth.uid);
    const callerClaims = callerRecord.customClaims || {};
    if (callerClaims.status !== 'approved') {
      throw new functions.https.HttpsError('permission-denied', 'Approved access is required');
    }
    const { code, redirectUri } = data || {};
    if (!code || !redirectUri) {
      throw new functions.https.HttpsError('invalid-argument', 'code and redirectUri are required');
    }

    const { refreshToken, email, historyId } = await exchangeAuthCodeForTokens({
      code,
      redirectUri,
      clientId: googleOAuthClientId.value(),
      clientSecret: googleOAuthClientSecret.value(),
      fetchImpl: fetch,
    });

    await admin.firestore().collection('gmailConnections').doc(auth.uid).set({
      email,
      refreshToken,
      status: 'connected',
      lastHistoryId: historyId,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    logger.info('connectGmailAccount: connected', { uid: auth.uid, email });
    return { success: true, email };
  }
);

/** Read back the caller's own Gmail connection state, without ever exposing the refresh token. */
exports.getGmailConnectionStatus = onCall(async (request) => {
  const { auth } = request;
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  if (callerClaims.status !== 'approved') {
    throw new functions.https.HttpsError('permission-denied', 'Approved access is required');
  }

  const snap = await admin.firestore().collection('gmailConnections').doc(auth.uid).get();
  if (!snap.exists) {
    return { connected: false };
  }
  const data = snap.data();
  return {
    connected: true,
    email: data.email,
    status: data.status,
    lastSyncedAt: data.lastSyncedAt ? data.lastSyncedAt.toDate().toISOString() : null,
  };
});

/**
 * Poll every connected Gmail account for new messages every 10 minutes.
 * Applies the capture-scope guard, matches external participants against
 * stakeholderIndex (reusing collectMatchedProjectIds unchanged — spec §3),
 * sanitizes the body, and files it under the matched project or into
 * unassignedEmails for triage. No attachments, no backfill.
 */
exports.syncGmailAccounts = onSchedule(
  {
    schedule: 'every 10 minutes',
    secrets: [googleOAuthClientId, googleOAuthClientSecret, geminiApiKeySecret],
    timeoutSeconds: 300,
    memory: '512MiB',
  },
  async () => {
    const db = admin.firestore();
    const connectionsSnap = await db.collection('gmailConnections').where('status', '==', 'connected').get();
    if (connectionsSnap.empty) return;

    const clientId = googleOAuthClientId.value();
    const clientSecret = googleOAuthClientSecret.value();
    const geminiApiKey = geminiApiKeySecret.value();

    for (const connectionDoc of connectionsSnap.docs) {
      const uid = connectionDoc.id;
      try {
        await syncOneGmailAccount({
          db,
          connectionRef: connectionDoc.ref,
          connection: connectionDoc.data(),
          clientId,
          clientSecret,
          geminiApiKey,
        });
      } catch (error) {
        logger.error('syncGmailAccounts: account sync failed', { uid, error: error.message });
        if (error.status === 400 || error.status === 401) {
          await connectionDoc.ref.set({ status: 'needs_reconnect' }, { merge: true });
        }
      }
    }
  }
);

async function syncOneGmailAccount({ db, connectionRef, connection, clientId, clientSecret, geminiApiKey }) {
  const { accessToken } = await refreshAccessToken({
    refreshToken: connection.refreshToken,
    clientId,
    clientSecret,
    fetchImpl: fetch,
  });

  const { messageIds, newHistoryId, historyExpired } = await listNewGmailMessageIds({
    accessToken,
    startHistoryId: connection.lastHistoryId,
    fetchImpl: fetch,
  });

  if (historyExpired) {
    // Gmail's history log only retains ~7 days. Recovering the gap would mean
    // backfilling, which is explicitly out of scope (spec Non-goals) — just
    // re-anchor to "now" and resume incremental sync from there.
    const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!profileResponse.ok) {
      // Don't touch lastHistoryId on a failed re-anchor fetch — writing a bad
      // value here (e.g. "undefined") would permanently break this account's
      // sync. Leave the cursor as-is and retry the whole sync next cycle.
      logger.warn('syncGmailAccounts: profile re-anchor fetch failed, will retry next cycle', {
        uid: connectionRef.id,
        status: profileResponse.status,
      });
      return;
    }
    const profile = await profileResponse.json();
    await connectionRef.set(
      { lastHistoryId: String(profile.historyId), lastSyncedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
    logger.warn('syncGmailAccounts: history expired, re-anchored', { uid: connectionRef.id });
    return;
  }

  for (const messageId of messageIds) {
    await processGmailMessage({ db, accessToken, messageId, geminiApiKey });
  }

  await connectionRef.set(
    { lastHistoryId: newHistoryId, lastSyncedAt: admin.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function processGmailMessage({ db, accessToken, messageId, geminiApiKey }) {
  const dedupRef = db.collection('gmailIngestedMessages').doc(messageId);
  const dedupSnap = await dedupRef.get();
  if (dedupSnap.exists) return;

  const resource = await getGmailMessage({ accessToken, messageId, fetchImpl: fetch });

  const labels = new Set(resource.labelIds || []);
  if (labels.has('DRAFT') || labels.has('SPAM') || labels.has('TRASH') || labels.has('CHAT')) {
    // Drafts/spam/trash/chat are never real captured correspondence.
    await dedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp(), captured: false });
    return;
  }

  const parsed = parseGmailMessage(resource);
  const participants = [parsed.from, ...parsed.to, ...parsed.cc];

  if (!hasExternalParticipant(participants)) {
    // Purely internal thread: never written anywhere, not even unassignedEmails.
    await dedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp(), captured: false });
    return;
  }

  // A physical message can arrive under a different Gmail message id in each
  // connected mailbox on the same thread. Dedup on the globally-unique
  // RFC-822 Message-ID (falling back to this mailbox's own Gmail id if that
  // header is somehow absent) so the same email isn't filed twice.
  const globalMessageKey = String(parsed.messageIdHeader || parsed.gmailMessageId)
    .trim()
    .replace(/^<|>$/g, '');
  const globalDedupRef = db.collection('gmailIngestedMessageIds').doc(globalMessageKey);
  const globalDedupSnap = await globalDedupRef.get();
  if (globalDedupSnap.exists) {
    await dedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp(), captured: false });
    return;
  }

  const externalEmails = filterExternalParticipants(participants).map((p) => p.email);
  const lookups = await Promise.all(
    [...new Set(externalEmails.map((e) => String(e || '').toLowerCase().trim()).filter(Boolean))]
      .map(async (email) => {
        const snap = await db.collection('stakeholderIndex').doc(email).get();
        return [email, snap.exists ? snap.data().projectIds || [] : []];
      })
  );
  const emailToProjectIds = Object.fromEntries(lookups);
  const matchedProjectIds = collectMatchedProjectIds(externalEmails, emailToProjectIds);

  const { body, sanitizeFailed } = await sanitizeEmailBody({ apiKey: geminiApiKey, rawBody: parsed.rawBody, fetchImpl: fetch });

  const baseDoc = {
    gmailMessageId: parsed.gmailMessageId,
    gmailThreadId: parsed.gmailThreadId,
    subject: parsed.subject,
    from: parsed.from,
    to: parsed.to,
    cc: parsed.cc,
    sentAt: new Date(parsed.sentAt),
    direction: classifyDirection(parsed.from.email),
    body,
    sanitizeFailed,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (matchedProjectIds.length === 1) {
    const [projectId] = matchedProjectIds;
    await db.collection('projects').doc(projectId).collection('emails').doc(messageId).set({
      ...baseDoc,
      matchedStakeholderEmails: externalEmails,
    });
    logger.info('syncGmailAccounts: matched to project', { projectId, messageId });
  } else {
    await db.collection('unassignedEmails').doc(messageId).set({
      ...baseDoc,
      candidateProjectIds: matchedProjectIds,
    });
    logger.info('syncGmailAccounts: unassigned', { candidateCount: matchedProjectIds.length, messageId });
  }

  await dedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp(), captured: true });
  await globalDedupRef.set({ ingestedAt: admin.firestore.FieldValue.serverTimestamp(), gmailMessageId: parsed.gmailMessageId });
}

/** Move an unassigned email into a project's emails subcollection. Admin only. */
exports.assignUnassignedEmail = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new functions.https.HttpsError('permission-denied', 'Admin privileges required');
  }

  const { emailId, projectId } = data;
  if (!emailId || !projectId) {
    throw new functions.https.HttpsError('invalid-argument', 'emailId and projectId are required');
  }

  const db = admin.firestore();
  const unassignedRef = db.collection('unassignedEmails').doc(emailId);
  const snap = await unassignedRef.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Email not found');
  }
  const { candidateProjectIds, ...emailData } = snap.data();
  const projectEmailRef = db.collection('projects').doc(projectId).collection('emails').doc(emailId);

  await db.runTransaction(async (tx) => {
    tx.set(projectEmailRef, {
      ...emailData,
      matchedStakeholderEmails: [emailData.from, ...(emailData.to || []), ...(emailData.cc || [])]
        .map((p) => p && p.email)
        .filter(Boolean),
    });
    tx.delete(unassignedRef);
  });

  logger.info('assignUnassignedEmail: assigned', { emailId, projectId, by: auth.uid });
  return { success: true };
});

/** Discard an unassigned email that isn't actually project-related. Admin only. */
exports.discardUnassignedEmail = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  const callerRecord = await admin.auth().getUser(auth.uid);
  const callerClaims = callerRecord.customClaims || {};
  if (callerClaims.role !== 'admin' || callerClaims.status !== 'approved') {
    throw new functions.https.HttpsError('permission-denied', 'Admin privileges required');
  }

  const { emailId } = data;
  if (!emailId) {
    throw new functions.https.HttpsError('invalid-argument', 'emailId is required');
  }

  await admin.firestore().collection('unassignedEmails').doc(emailId).delete();
  logger.info('discardUnassignedEmail: discarded', { emailId, by: auth.uid });
  return { success: true };
});

/**
 * Generate Purchase Order PDF
 * Creates a professional PO document and stores it in Firebase Storage
 */
exports.generatePOPDF = onCall(async (request) => {
  const { purchaseOrder, companySettings, companyLogo, companyLogoUrl, companyLogoPath } = request.data;

  if (!purchaseOrder || !companySettings) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'purchaseOrder and companySettings are required'
    );
  }

  try {
    // Resolve company logo - can be base64, URL, or storage path
    let resolvedLogo = companyLogo;

    // If logo URL provided, try to fetch it
    if (!resolvedLogo && companyLogoUrl) {
      try {
        const https = require('https');
        const http = require('http');
        const protocol = companyLogoUrl.startsWith('https') ? https : http;

        resolvedLogo = await new Promise((resolve) => {
          protocol.get(companyLogoUrl, (response) => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
              const buffer = Buffer.concat(chunks);
              resolve(buffer.toString('base64'));
            });
            response.on('error', () => resolve(null));
          }).on('error', () => resolve(null));
        });
      } catch (e) {
        logger.warn('Failed to fetch logo from URL', { error: e.message });
      }
    }

    // If storage path provided, download from Firebase Storage
    if (!resolvedLogo && companyLogoPath) {
      try {
        const bucket = admin.storage().bucket();
        const file = bucket.file(companyLogoPath);
        const [buffer] = await file.download();
        resolvedLogo = buffer.toString('base64');
      } catch (e) {
        logger.warn('Failed to download logo from storage', { error: e.message, path: companyLogoPath });
      }
    }
    logger.info('Generating PO PDF', { poNumber: purchaseOrder.poNumber });

    // Create PDF document
    // IMPORTANT: All info fields must have non-null values or PDFKit crashes with 'valueOf' error
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 40, bottom: 40, left: 40, right: 40 },
      info: {
        Title: `Purchase Order - ${purchaseOrder.poNumber || 'Draft'}`,
        Author: companySettings.companyName || 'Company',
        Subject: 'Purchase Order',
        Creator: 'BOM Tracker'
      }
    });

    // Collect PDF chunks
    const chunks = [];
    doc.on('data', chunk => chunks.push(chunk));

    // Document dimensions
    const pageWidth = doc.page.width - 80; // 40 margin on each side
    const startX = 40;
    let y = 40;

    // Colors
    const primaryColor = '#1e40af'; // Blue
    const borderColor = '#d1d5db'; // Gray-300
    const headerBgColor = '#f3f4f6'; // Gray-100

    // ========== HEADER WITH LOGO ==========
    // Company Logo (if provided) - rectangular logo support
    const logoMaxWidth = 120; // Max width for rectangular logos
    const logoMaxHeight = 40; // Max height to keep it subtle
    let logoOffset = 0;

    if (resolvedLogo) {
      try {
        const logoBuffer = Buffer.from(resolvedLogo, 'base64');
        // Use fit to maintain aspect ratio within bounds
        doc.image(logoBuffer, startX, y, {
          fit: [logoMaxWidth, logoMaxHeight],
          align: 'left',
          valign: 'top'
        });
        logoOffset = logoMaxWidth + 15;
      } catch (e) {
        logger.warn('Failed to add logo to PDF', { error: e.message });
      }
    }

    // Company Name and Address (beside logo or centered)
    const textStartY = resolvedLogo ? y : y;
    const headerTextWidth = pageWidth - logoOffset;

    // Company name
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .fillColor(primaryColor)
       .text(companySettings.companyName || 'Company', startX + logoOffset, textStartY, {
         width: headerTextWidth,
         align: resolvedLogo ? 'left' : 'center'
       });

    // Address - calculate actual height needed
    const addressText = companySettings.companyAddress || '-';
    doc.font('Helvetica').fontSize(8);
    const addressHeight = doc.heightOfString(addressText, { width: headerTextWidth });

    doc.fillColor('#374151')
       .text(addressText, startX + logoOffset, textStartY + 18, {
         width: headerTextWidth,
         align: resolvedLogo ? 'left' : 'center'
       });

    // Add GSTIN and PAN below address (with proper spacing)
    const gstPanY = textStartY + 18 + addressHeight + 4;
    const gstPanLine = [];
    if (companySettings.gstin) gstPanLine.push(`GSTIN: ${companySettings.gstin}`);
    if (companySettings.pan) gstPanLine.push(`PAN: ${companySettings.pan}`);
    if (gstPanLine.length > 0) {
      doc.font('Helvetica')
         .fontSize(8)
         .fillColor('#374151')
         .text(gstPanLine.join('  |  '), startX + logoOffset, gstPanY, {
           width: headerTextWidth,
           align: resolvedLogo ? 'left' : 'center'
         });
    }

    // Move y past the header (calculate actual height used)
    const headerHeight = Math.max(logoMaxHeight, 18 + addressHeight + 4 + 12);
    y += headerHeight + 10;

    // PO Title Bar
    doc.rect(startX, y, pageWidth, 25)
       .fillAndStroke(primaryColor, primaryColor);
    doc.font('Helvetica-Bold')
       .fontSize(14)
       .fillColor('white')
       .text('PURCHASE ORDER', startX, y + 6, { width: pageWidth, align: 'center' });
    y += 35;

    // ========== PO DETAILS & VENDOR INFO (Two columns) ==========
    const colWidth = pageWidth / 2 - 10;
    const leftColX = startX;
    const rightColX = startX + colWidth + 20;
    const detailsStartY = y;

    // Left Column: PO Details
    doc.rect(leftColX, y, colWidth, 20)
       .fillAndStroke(headerBgColor, borderColor);
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor('#1f2937')
       .text('PO Details', leftColX + 5, y + 5);
    y += 20;

    const poDetails = [
      ['PO Number:', purchaseOrder.poNumber || '-'],
      ['PO Date:', formatDateSafe(purchaseOrder.poDate)],
      ['Reference:', purchaseOrder.projectReference || '-'],
      ['Vendor Quote:', purchaseOrder.vendorQuoteReference || '-']
    ];

    const valueWidth = colWidth - 90;
    poDetails.forEach(([label, value]) => {
      // Calculate height needed for this row based on value text
      doc.font('Helvetica-Bold').fontSize(9);
      const textHeight = doc.heightOfString(value, { width: valueWidth });
      const rowHeight = Math.max(18, textHeight + 8);

      doc.rect(leftColX, y, colWidth, rowHeight)
         .stroke(borderColor);
      doc.font('Helvetica')
         .fontSize(9)
         .fillColor('#4b5563')
         .text(label, leftColX + 5, y + 4, { width: 80 });
      doc.font('Helvetica-Bold')
         .fillColor('#1f2937')
         .text(value, leftColX + 85, y + 4, { width: valueWidth });
      y += rowHeight;
    });

    // Right Column: Vendor Details
    let rightY = detailsStartY;
    doc.rect(rightColX, rightY, colWidth, 20)
       .fillAndStroke(headerBgColor, borderColor);
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor('#1f2937')
       .text('Vendor Details', rightColX + 5, rightY + 5);
    rightY += 20;

    doc.rect(rightColX, rightY, colWidth, 72)
       .stroke(borderColor);
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor('#1f2937')
       .text(purchaseOrder.vendorName || '-', rightColX + 5, rightY + 4);
    doc.font('Helvetica')
       .fontSize(9)
       .fillColor('#4b5563')
       .text(purchaseOrder.vendorAddress || '-', rightColX + 5, rightY + 18, {
         width: colWidth - 10,
         height: 30
       });
    doc.text(`GSTIN: ${purchaseOrder.vendorGstin || '-'}`, rightColX + 5, rightY + 50);
    doc.text(`State: ${purchaseOrder.vendorStateName || '-'} (${purchaseOrder.vendorStateCode || '-'})`, rightColX + 5, rightY + 62);

    y = Math.max(y, rightY + 72) + 15;

    // ========== INVOICE TO / SHIP TO ==========
    const addressColWidth = pageWidth / 2 - 10;
    const addressStartY = y;

    // Invoice To
    doc.rect(leftColX, y, addressColWidth, 20)
       .fillAndStroke(headerBgColor, borderColor);
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor('#1f2937')
       .text('Invoice To', leftColX + 5, y + 5);
    y += 20;

    doc.rect(leftColX, y, addressColWidth, 55)
       .stroke(borderColor);
    doc.font('Helvetica-Bold')
       .fontSize(9)
       .fillColor('#1f2937')
       .text(purchaseOrder.invoiceToCompany || '-', leftColX + 5, y + 4);
    doc.font('Helvetica')
       .fillColor('#4b5563')
       .text(purchaseOrder.invoiceToAddress || '-', leftColX + 5, y + 16, {
         width: addressColWidth - 10,
         height: 25
       });
    doc.text(`GSTIN: ${purchaseOrder.invoiceToGstin || '-'}`, leftColX + 5, y + 42);

    // Ship To
    rightY = addressStartY;
    doc.rect(rightColX, rightY, addressColWidth, 20)
       .fillAndStroke(headerBgColor, borderColor);
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor('#1f2937')
       .text('Ship To', rightColX + 5, rightY + 5);
    rightY += 20;

    doc.rect(rightColX, rightY, addressColWidth, 55)
       .stroke(borderColor);
    doc.font('Helvetica')
       .fontSize(9)
       .fillColor('#4b5563')
       .text(purchaseOrder.shipToAddress || '-', rightColX + 5, rightY + 4, {
         width: addressColWidth - 10,
         height: 50
       });

    y = Math.max(y + 55, rightY + 55) + 15;

    // ========== ITEMS TABLE ==========
    // Table header
    const colWidths = [30, 180, 60, 45, 60, 50, 90]; // S.No, Description, HSN, UOM, Qty, Rate, Amount
    const tableX = startX;

    doc.rect(tableX, y, pageWidth, 22)
       .fillAndStroke(primaryColor, primaryColor);

    const headers = ['S.No', 'Description', 'HSN', 'UOM', 'Qty', 'Rate', 'Amount'];
    let headerX = tableX;
    headers.forEach((header, i) => {
      doc.font('Helvetica-Bold')
         .fontSize(9)
         .fillColor('white')
         .text(header, headerX + 3, y + 6, { width: colWidths[i] - 6, align: i > 3 ? 'right' : 'left' });
      headerX += colWidths[i];
    });
    y += 22;

    // Table rows
    const items = purchaseOrder.items || [];
    items.forEach((item, idx) => {
      // Calculate row height based on description length
      const descText = item.description || '-';
      const descHeight = doc.heightOfString(descText, { width: colWidths[1] - 10 });
      const rowHeight = Math.max(20, descHeight + 8);

      // Check for page break
      if (y + rowHeight > doc.page.height - 150) {
        doc.addPage();
        y = 40;
      }

      // Alternate row background
      if (idx % 2 === 0) {
        doc.rect(tableX, y, pageWidth, rowHeight)
           .fill('#f9fafb');
      }

      // Row border
      doc.rect(tableX, y, pageWidth, rowHeight)
         .stroke(borderColor);

      // Cell borders and content
      let cellX = tableX;
      const rowData = [
        (item.slNo ?? idx + 1).toString(),
        `${item.description || '-'}${item.make ? `\nMake: ${item.make}` : ''}${item.itemCode ? `\nCode: ${item.itemCode}` : ''}`,
        item.hsn || '-',
        item.uom || '-',
        (item.quantity ?? 0).toString(),
        formatIndianCurrency(item.rate).replace('Rs. ', ''),
        formatIndianCurrency(item.amount)
      ];

      rowData.forEach((data, i) => {
        doc.rect(cellX, y, colWidths[i], rowHeight)
           .stroke(borderColor);
        doc.font(i === 1 ? 'Helvetica' : 'Helvetica')
           .fontSize(8)
           .fillColor('#374151')
           .text(data, cellX + 3, y + 4, {
             width: colWidths[i] - 6,
             height: rowHeight - 6,
             align: i > 3 ? 'right' : 'left'
           });
        cellX += colWidths[i];
      });

      y += rowHeight;
    });

    // ========== TOTALS SECTION ==========
    y += 10;
    const totalsX = startX + pageWidth - 200;
    const totalsWidth = 200;

    // Subtotal
    doc.rect(totalsX, y, totalsWidth, 18)
       .stroke(borderColor);
    doc.font('Helvetica')
       .fontSize(9)
       .fillColor('#4b5563')
       .text('Subtotal:', totalsX + 5, y + 4, { width: 90 });
    doc.font('Helvetica-Bold')
       .fillColor('#1f2937')
       .text(formatIndianCurrency(purchaseOrder.subtotal), totalsX + 95, y + 4, { width: 100, align: 'right' });
    y += 18;

    // Tax
    if (purchaseOrder.taxType === 'igst') {
      doc.rect(totalsX, y, totalsWidth, 18)
         .stroke(borderColor);
      doc.font('Helvetica')
         .fontSize(9)
         .fillColor('#4b5563')
         .text(`IGST (${purchaseOrder.taxPercentage}%):`, totalsX + 5, y + 4, { width: 90 });
      doc.font('Helvetica')
         .fillColor('#1f2937')
         .text(formatIndianCurrency(purchaseOrder.igstAmount), totalsX + 95, y + 4, { width: 100, align: 'right' });
      y += 18;
    } else {
      // CGST
      doc.rect(totalsX, y, totalsWidth, 18)
         .stroke(borderColor);
      doc.font('Helvetica')
         .fontSize(9)
         .fillColor('#4b5563')
         .text(`CGST (${purchaseOrder.taxPercentage / 2}%):`, totalsX + 5, y + 4, { width: 90 });
      doc.font('Helvetica')
         .fillColor('#1f2937')
         .text(formatIndianCurrency(purchaseOrder.cgstAmount), totalsX + 95, y + 4, { width: 100, align: 'right' });
      y += 18;

      // SGST
      doc.rect(totalsX, y, totalsWidth, 18)
         .stroke(borderColor);
      doc.font('Helvetica')
         .fontSize(9)
         .fillColor('#4b5563')
         .text(`SGST (${purchaseOrder.taxPercentage / 2}%):`, totalsX + 5, y + 4, { width: 90 });
      doc.font('Helvetica')
         .fillColor('#1f2937')
         .text(formatIndianCurrency(purchaseOrder.sgstAmount), totalsX + 95, y + 4, { width: 100, align: 'right' });
      y += 18;
    }

    // Total
    doc.rect(totalsX, y, totalsWidth, 22)
       .fillAndStroke(primaryColor, primaryColor);
    doc.font('Helvetica-Bold')
       .fontSize(10)
       .fillColor('white')
       .text('TOTAL:', totalsX + 5, y + 5, { width: 90 });
    doc.text(formatIndianCurrency(purchaseOrder.totalAmount), totalsX + 95, y + 5, { width: 100, align: 'right' });
    y += 30;

    // Amount in words
    doc.font('Helvetica-Bold')
       .fontSize(9)
       .fillColor('#1f2937')
       .text('Amount in Words:', startX, y);
    doc.font('Helvetica')
       .text(purchaseOrder.amountInWords || numberToWords(purchaseOrder.totalAmount), startX + 90, y, {
         width: pageWidth - 90
       });
    y += 25;

    // ========== TERMS ==========
    if (purchaseOrder.paymentTerms || purchaseOrder.deliveryTerms || purchaseOrder.vendorQuoteReference) {
      doc.rect(startX, y, pageWidth, 20)
         .fillAndStroke(headerBgColor, borderColor);
      doc.font('Helvetica-Bold')
         .fontSize(10)
         .fillColor('#1f2937')
         .text('Terms & Conditions', startX + 5, y + 5);
      y += 20;

      // Calculate dynamic height for terms box
      const termsStartY = y;
      let termsContentY = y + 5;
      const labelWidth = 85;
      const contentWidth = pageWidth - labelWidth - 15;

      if (purchaseOrder.paymentTerms) {
        doc.font('Helvetica-Bold')
           .fontSize(8)
           .fillColor('#4b5563')
           .text('Payment Terms:', startX + 5, termsContentY);
        doc.font('Helvetica')
           .text(purchaseOrder.paymentTerms, startX + labelWidth, termsContentY, { width: contentWidth });
        // Calculate height of the text
        const paymentTermsHeight = doc.heightOfString(purchaseOrder.paymentTerms, { width: contentWidth });
        termsContentY += Math.max(paymentTermsHeight, 12) + 5;
      }

      if (purchaseOrder.deliveryTerms) {
        doc.font('Helvetica-Bold')
           .fontSize(8)
           .fillColor('#4b5563')
           .text('Delivery Terms:', startX + 5, termsContentY);
        doc.font('Helvetica')
           .text(purchaseOrder.deliveryTerms, startX + labelWidth, termsContentY, { width: contentWidth });
        const deliveryTermsHeight = doc.heightOfString(purchaseOrder.deliveryTerms, { width: contentWidth });
        termsContentY += Math.max(deliveryTermsHeight, 12) + 5;
      }

      if (purchaseOrder.vendorQuoteReference) {
        doc.font('Helvetica-Bold')
           .fontSize(8)
           .fillColor('#4b5563')
           .text('Quote Ref.', startX + 5, termsContentY);
        doc.font('Helvetica')
           .text(purchaseOrder.vendorQuoteReference, startX + labelWidth, termsContentY, { width: contentWidth });
        termsContentY += 15;
      }

      // Draw the box around terms content
      const termsBoxHeight = termsContentY - termsStartY + 5;
      doc.rect(startX, termsStartY, pageWidth, termsBoxHeight)
         .stroke(borderColor);

      y = termsContentY + 10;
    }

    // ========== SIGNATURE ==========
    // Check for page break - need more space for signature section
    if (y > doc.page.height - 150) {
      doc.addPage();
      y = 40;
    }

    y += 20;

    // Company name
    doc.font('Helvetica-Bold')
       .fontSize(9)
       .fillColor('#1f2937')
       .text(`For ${companySettings.companyName || 'Company'}`, startX + pageWidth - 180, y, { width: 180, align: 'right' });
    y += 15;

    // Try to add signature and seal images
    const signatureX = startX + pageWidth - 170;
    const sealX = startX + pageWidth - 80;
    const imageY = y;

    try {
      const path = require('path');
      const fs = require('fs');
      const assetsDir = path.join(__dirname, 'assets');

      // Add signature image
      const signaturePath = path.join(assetsDir, 'signature.jpg');
      if (fs.existsSync(signaturePath)) {
        doc.image(signaturePath, signatureX, imageY, {
          width: 80,
          height: 40
        });
      }

      // Add seal image
      const sealPath = path.join(assetsDir, 'seal.png');
      if (fs.existsSync(sealPath)) {
        doc.image(sealPath, sealX, imageY, {
          width: 55,
          height: 55
        });
      }
    } catch (imgError) {
      logger.warn('Could not load signature/seal images', { error: imgError.message });
    }

    y += 60;

    // Authorized Signatory text
    doc.font('Helvetica')
       .fontSize(9)
       .fillColor('#4b5563')
       .text('Authorized Signatory', startX + pageWidth - 180, y, { width: 180, align: 'right' });

    // Finalize PDF
    doc.end();

    // Wait for PDF to be complete
    const pdfBuffer = await new Promise((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    // Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const poNumberSafe = (purchaseOrder.poNumber || 'DRAFT').replace(/[^a-zA-Z0-9-]/g, '_');
    const filename = `purchase-orders/${purchaseOrder.projectId || 'unknown'}/${poNumberSafe}.pdf`;
    const file = bucket.file(filename);

    await file.save(pdfBuffer, {
      metadata: {
        contentType: 'application/pdf',
        metadata: {
          poNumber: purchaseOrder.poNumber || 'DRAFT',
          projectId: purchaseOrder.projectId || 'unknown',
          vendorId: purchaseOrder.vendorId || '',
          generatedAt: new Date().toISOString()
        }
      }
    });

    // Generate a download token for Firebase Storage
    const downloadToken = require('crypto').randomUUID();

    // Update file metadata with download token
    await file.setMetadata({
      metadata: {
        firebaseStorageDownloadTokens: downloadToken
      }
    });

    // Firebase Storage download URL format
    const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filename)}?alt=media&token=${downloadToken}`;

    logger.info('PO PDF generated successfully', {
      poNumber: purchaseOrder.poNumber,
      filename,
      size: pdfBuffer.length
    });

    return {
      success: true,
      pdfUrl: downloadUrl,
      storagePath: filename,
      downloadUrl,
      size: pdfBuffer.length
    };

  } catch (error) {
    logger.error('Failed to generate PO PDF', {
      poNumber: purchaseOrder?.poNumber,
      error: error.message,
      stack: error.stack
    });
    throw new functions.https.HttpsError(
      'internal',
      `Failed to generate PO PDF: ${error.message}`
    );
  }
});

/**
 * Send Purchase Order via Email
 * Generates PDF and sends to vendor with the PO attached
 */
exports.sendPurchaseOrder = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { purchaseOrder, companySettings, companyLogo, companyLogoPath, recipientEmail, ccEmails } = request.data;

    if (!purchaseOrder || !companySettings || !recipientEmail) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'purchaseOrder, companySettings, and recipientEmail are required'
      );
    }

    try {
      logger.info('Sending PO via email', {
        poNumber: purchaseOrder.poNumber,
        to: recipientEmail
      });

      // First generate the PDF
      const pdfResult = await exports.generatePOPDF.run({
        data: { purchaseOrder, companySettings, companyLogo, companyLogoPath }
      }, { auth: request.auth });

      // Download the PDF from storage
      const bucket = admin.storage().bucket();
      const file = bucket.file(pdfResult.storagePath);
      const [pdfBuffer] = await file.download();

      // Initialize Resend
      const resend = new Resend(getResendApiKey());

      // Build email
      const poNum = purchaseOrder.poNumber || 'DRAFT';
      const emailData = {
        from: 'info@qualitastech.com', // Must be verified in Resend
        to: recipientEmail,
        cc: ccEmails || [],
        subject: `Purchase Order ${poNum} - ${companySettings.companyName || 'Company'}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1e40af;">Purchase Order ${poNum}</h2>
            <p>Dear ${purchaseOrder.vendorName || 'Vendor'},</p>
            <p>Please find attached our Purchase Order for your reference.</p>

            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>PO Number:</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${poNum}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>PO Date:</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${formatDateSafe(purchaseOrder.poDate)}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Total Amount:</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${formatIndianCurrency(purchaseOrder.totalAmount)}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border: 1px solid #ddd;"><strong>Items:</strong></td>
                <td style="padding: 8px; border: 1px solid #ddd;">${purchaseOrder.items?.length || 0} item(s)</td>
              </tr>
            </table>

            <p>Please acknowledge receipt of this Purchase Order.</p>

            <p>
              Best regards,<br/>
              <strong>${companySettings.companyName || 'Company'}</strong><br/>
              ${companySettings.phone ? `Phone: ${companySettings.phone}<br/>` : ''}
              ${companySettings.email ? `Email: ${companySettings.email}` : ''}
            </p>
          </div>
        `,
        attachments: [
          {
            content: pdfBuffer.toString('base64'),
            filename: `${poNum}.pdf`,
            type: 'application/pdf'
          }
        ]
      };

      await resend.emails.send(emailData);

      // Update PO status to 'sent' in Firestore
      const db = admin.firestore();
      await db.collection('projects').doc(purchaseOrder.projectId).collection('purchaseOrders').doc(purchaseOrder.id).update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        sentBy: request.auth?.uid || 'system',
        sentToEmail: recipientEmail,
        pdfUrl: pdfResult.pdfUrl
      });

      // Create ProjectDocument entry for the generated PO PDF
      // This makes the PO appear in the "Vendor POs" documents section
      const projectDocRef = await db.collection('projectDocuments').add({
        projectId: purchaseOrder.projectId,
        name: (purchaseOrder.poNumber || 'PO') + '.pdf',
        url: pdfResult.pdfUrl,
        type: 'vendor-po',
        uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
        uploadedBy: request.auth?.uid || 'system',
        linkedBOMItems: purchaseOrder.items.map(item => item.bomItemId),
        fileSize: pdfResult.size || 0
      });

      logger.info('ProjectDocument created for PO', {
        documentId: projectDocRef.id,
        poNumber: purchaseOrder.poNumber
      });

      logger.info('PO email sent successfully', {
        poNumber: purchaseOrder.poNumber,
        to: recipientEmail
      });

      return {
        success: true,
        message: `Purchase Order ${purchaseOrder.poNumber} sent to ${recipientEmail}`,
        pdfUrl: pdfResult.pdfUrl
      };

    } catch (error) {
      // Log full error for debugging
      logger.error('Failed to send PO email', {
        poNumber: purchaseOrder?.poNumber,
        error: error.message,
        code: error.code,
        response: error.response?.body,
        stack: error.stack
      });

      // Provide user-friendly error messages based on error type
      let errorCode = 'internal';
      let userMessage = 'Failed to send Purchase Order';
      let troubleshooting = '';

      if (error.code === 401 || error.message?.includes('Unauthorized') || error.message?.includes('Invalid API key')) {
        errorCode = 'unauthenticated';
        userMessage = 'Email service authentication failed';
        troubleshooting = 'The Resend API key is invalid or expired. Please contact your administrator.';
      } else if (error.code === 403 || error.message?.includes('Forbidden') || error.message?.includes('Domain not verified')) {
        errorCode = 'permission-denied';
        userMessage = 'Email service access denied';
        troubleshooting = 'The sender email may not be verified in Resend.';
      } else if (error.code === 400) {
        errorCode = 'invalid-argument';
        userMessage = 'Invalid email request';
        troubleshooting = 'Check that the vendor email address is valid.';
      } else if (error.message?.includes('ENOTFOUND') || error.message?.includes('ETIMEDOUT')) {
        errorCode = 'unavailable';
        userMessage = 'Email service unreachable';
        troubleshooting = 'Network issue. Please try again.';
      } else if (error.message?.includes('PDF')) {
        userMessage = 'Failed to generate PO PDF';
        troubleshooting = error.message;
      } else {
        troubleshooting = error.message;
      }

      throw new functions.https.HttpsError(
        errorCode,
        `${userMessage}. ${troubleshooting || error.message}`
      );
    }
  }
);

// ==================== SUPPORT TICKET COMMUNICATIONS ====================

/**
 * Allows an approved project member to add a contact to the linked client CRM
 * without granting access to the broader Settings workspace.
 */
exports.addClientCRMContact = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  if (auth.token.status !== 'approved') {
    throw new functions.https.HttpsError('permission-denied', 'Approved access is required');
  }

  const {
    projectId,
    clientId,
    name,
    email = '',
    phone = '',
    designation = '',
    role = 'technical',
  } = data || {};
  const allowedRoles = ['technical', 'commercial', 'operations', 'management', 'other'];
  const trimmedName = String(name || '').trim();
  const trimmedEmail = String(email || '').trim().toLowerCase();
  const trimmedPhone = String(phone || '').trim();
  const trimmedDesignation = String(designation || '').trim();

  if (!projectId || !clientId || !trimmedName) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Project, client, and contact name are required',
    );
  }
  if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    throw new functions.https.HttpsError('invalid-argument', 'Contact email is invalid');
  }
  if (!allowedRoles.includes(role)) {
    throw new functions.https.HttpsError('invalid-argument', 'Contact relationship is invalid');
  }

  const firestore = admin.firestore();
  const projectRef = firestore.collection('projects').doc(projectId);
  const clientRef = firestore.collection('clients').doc(clientId);
  const [projectSnapshot, clientSnapshot] = await Promise.all([
    projectRef.get(),
    clientRef.get(),
  ]);
  if (!projectSnapshot.exists || !clientSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'Project or client not found');
  }

  const project = projectSnapshot.data();
  const client = clientSnapshot.data();
  const isAdmin = auth.token.role === 'admin';
  const isMember = !project.memberIds || project.memberIds.includes(auth.uid);
  const clientMatchesProject =
    project.clientId === clientId ||
    (!project.clientId &&
      String(project.clientName || '').trim().toLowerCase() ===
        String(client.company || '').trim().toLowerCase());

  if ((!isAdmin && !isMember) || !clientMatchesProject) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'You cannot add contacts for this project client',
    );
  }

  const contactId = clientRef.collection('_contactIds').doc().id;
  const newContact = await firestore.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(clientRef);
    const currentClient = currentSnapshot.data();
    const existingContacts =
      Array.isArray(currentClient.contacts) && currentClient.contacts.length
        ? currentClient.contacts
        : (currentClient.contactPerson || currentClient.email || currentClient.phone)
          ? [{
              id: 'legacy-primary',
              name: currentClient.contactPerson || 'Primary contact',
              email: currentClient.email || '',
              phone: currentClient.phone || '',
              designation: '',
              role: 'technical',
              isPrimary: true,
              isActive: true,
            }]
          : [];

    const duplicate = existingContacts.find((contact) => {
      const sameEmail =
        trimmedEmail &&
        String(contact.email || '').trim().toLowerCase() === trimmedEmail;
      const sameNameAndPhone =
        trimmedPhone &&
        String(contact.name || '').trim().toLowerCase() === trimmedName.toLowerCase() &&
        String(contact.phone || '').trim() === trimmedPhone;
      return sameEmail || sameNameAndPhone;
    });
    if (duplicate) {
      throw new functions.https.HttpsError(
        'already-exists',
        'This CRM contact already exists',
      );
    }

    const contact = {
      id: contactId,
      name: trimmedName,
      email: trimmedEmail,
      phone: trimmedPhone,
      designation: trimmedDesignation,
      role,
      isPrimary: existingContacts.length === 0,
      isActive: true,
    };
    const contacts = [...existingContacts, contact];
    const primary = contacts.find((item) => item.isPrimary) || contacts[0];
    transaction.update(clientRef, {
      contacts,
      contactPerson: primary?.name || '',
      email: primary?.email || '',
      phone: primary?.phone || '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return contact;
  });

  logger.info('Client CRM contact added from support', {
    projectId,
    clientId,
    contactId: newContact.id,
    addedBy: auth.uid,
  });
  return { contact: newContact };
});

/**
 * Creates a numbered, branded support quotation PDF and records it against the
 * ticket. Amounts are recalculated server-side; the client cannot submit totals.
 */
exports.prepareSupportQuotation = onCall(async (request) => {
  const { auth, data } = request;
  if (!auth || auth.token.status !== 'approved') {
    throw new functions.https.HttpsError('permission-denied', 'Approved access is required');
  }
  const {
    projectId,
    ticketId,
    billingEntityId: requestedBillingEntityId,
    lines = [],
    taxType = 'igst',
    taxPercent = 18,
    validityDays = 30,
    paymentTerms = '',
    termsAndConditions = '',
    notes = '',
  } = data || {};
  if (!projectId || !ticketId || !Array.isArray(lines) || !lines.length) {
    throw new functions.https.HttpsError('invalid-argument', 'Project, ticket and quotation lines are required');
  }
  if (!['igst', 'cgst-sgst', 'none'].includes(taxType)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid tax type');
  }

  const firestore = admin.firestore();
  const projectRef = firestore.collection('projects').doc(projectId);
  const ticketRef = projectRef.collection('supportTickets').doc(ticketId);
  const [projectSnapshot, ticketSnapshot, userRecord] = await Promise.all([
    projectRef.get(),
    ticketRef.get(),
    admin.auth().getUser(auth.uid),
  ]);
  if (!projectSnapshot.exists || !ticketSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'Project or support ticket not found');
  }
  const project = projectSnapshot.data();
  const ticket = ticketSnapshot.data();
  const isAdmin = auth.token.role === 'admin';
  const isMember = !project.memberIds || project.memberIds.includes(auth.uid);
  if (!isAdmin && !isMember) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to this ticket');
  }

  const billingEntityId = project.billingEntityId || requestedBillingEntityId || 'company';
  if (project.billingEntityId && requestedBillingEntityId && project.billingEntityId !== requestedBillingEntityId) {
    throw new functions.https.HttpsError('failed-precondition', 'The selected billing entity does not match the project');
  }
  const entityRef = billingEntityId === 'company'
    ? firestore.collection('settings').doc('company')
    : firestore.collection('billingEntities').doc(billingEntityId);

  let billingEntity;
  let quotationNumber;
  await firestore.runTransaction(async (transaction) => {
    const entitySnapshot = await transaction.get(entityRef);
    if (!entitySnapshot.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Configure the project billing entity before preparing a quotation');
    }
    const stored = entitySnapshot.data();
    billingEntity = billingEntityId === 'company'
      ? {
          id: 'company',
          legalName: stored.companyName,
          displayName: stored.companyName,
          companyAddress: stored.companyAddress,
          gstin: stored.gstin,
          stateCode: stored.stateCode,
          stateName: stored.stateName,
          pan: stored.pan,
          cin: stored.cin,
          udyamRegistrationNumber: stored.udyamRegistrationNumber,
          phone: stored.phone,
          email: stored.email,
          website: stored.website,
          fax: stored.fax,
          authorizedSignatoryName: stored.authorizedSignatoryName,
          authorizedSignatoryDesignation: stored.authorizedSignatoryDesignation,
          logo: stored.logo,
          logoPath: stored.logoPath,
          quotationPrefix: stored.quotationPrefix || 'SVC',
          nextQuotationNumber: stored.nextQuotationNumber || 1,
          defaultValidityDays: stored.defaultValidityDays || 30,
          defaultPaymentTerms: stored.defaultPaymentTerms || '',
          defaultTermsAndConditions: stored.defaultTermsAndConditions || '',
          bankName: stored.bankName || '',
          bankAccountName: stored.bankAccountName || '',
          bankAccountNumber: stored.bankAccountNumber || '',
          bankIfsc: stored.bankIfsc || '',
          bankBranch: stored.bankBranch || '',
        }
      : { id: entitySnapshot.id, ...stored };
    if (!billingEntity.legalName || !billingEntity.companyAddress || !billingEntity.gstin) {
      throw new functions.https.HttpsError('failed-precondition', 'The billing entity needs legal name, address and GSTIN');
    }
    const nextNumber = Math.max(1, Number(billingEntity.nextQuotationNumber) || 1);
    const now = new Date();
    const fyStart = now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
    const fy = `${String(fyStart).slice(-2)}-${String(fyStart + 1).slice(-2)}`;
    quotationNumber = `${billingEntity.quotationPrefix || 'SVC'}/${fy}/${String(nextNumber).padStart(4, '0')}`;
    transaction.update(entityRef, {
      nextQuotationNumber: nextNumber + 1,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  const normalizedLines = lines.slice(0, 50).map((line, index) => {
    const quantity = Math.max(0, Number(line.quantity) || 0);
    const unitRate = Math.max(0, Number(line.unitRate) || 0);
    const description = String(line.description || '').trim();
    if (!description || quantity <= 0) {
      throw new functions.https.HttpsError('invalid-argument', `Quotation line ${index + 1} is incomplete`);
    }
    return {
      id: String(line.id || `line-${index + 1}`),
      category: ['engineering', 'travel', 'material'].includes(line.category) ? line.category : 'material',
      description,
      hsnSac: String(line.hsnSac || '').trim().toUpperCase(),
      quantity,
      unit: String(line.unit || 'nos').trim(),
      unitRate,
      amount: Math.round(quantity * unitRate * 100) / 100,
    };
  });
  const subtotal = Math.round(normalizedLines.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  const safeTaxPercent = taxType === 'none' ? 0 : Math.min(100, Math.max(0, Number(taxPercent) || 0));
  const taxAmount = Math.round(subtotal * safeTaxPercent) / 100;
  const total = Math.round((subtotal + taxAmount) * 100) / 100;
  if (subtotal <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Quotation total must be greater than zero');
  }

  let client = {};
  const clientId = ticket.clientId || project.clientId;
  if (clientId) {
    const clientSnapshot = await firestore.collection('clients').doc(clientId).get();
    if (clientSnapshot.exists) client = clientSnapshot.data();
  } else if (project.clientName) {
    const clientQuery = await firestore.collection('clients')
      .where('company', '==', project.clientName)
      .limit(1)
      .get();
    if (!clientQuery.empty) client = clientQuery.docs[0].data();
  }
  const quotationDate = new Date();
  const validUntilDate = new Date(quotationDate);
  validUntilDate.setDate(validUntilDate.getDate() + Math.max(1, Math.min(365, Number(validityDays) || 30)));
  const toIsoDate = (date) => date.toISOString().slice(0, 10);
  const money = (value) => `INR ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const doc = new PDFDocument({ size: 'A4', margin: 42, bufferPages: true });
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  let logoBuffer = null;
  try {
    if (billingEntity.logoPath) {
      [logoBuffer] = await admin.storage().bucket().file(billingEntity.logoPath).download();
    } else if (billingEntity.logo) {
      const response = await fetch(billingEntity.logo);
      if (response.ok) logoBuffer = Buffer.from(await response.arrayBuffer());
    }
  } catch (error) {
    logger.warn('Support quotation logo could not be loaded', { billingEntityId, error: error.message });
  }

  if (logoBuffer) {
    try { doc.image(logoBuffer, 42, 38, { fit: [120, 50] }); } catch (error) { logger.warn('Support quote logo render failed', { error: error.message }); }
  }
  const quotationEntityName = getBillingEntityDisplayName(billingEntity);
  let y = drawSupportQuotationHeader({
    doc,
    billingEntity,
    client,
    project,
    ticket,
    projectId,
    ticketId,
    quotationNumber,
    quotationDateText: toIsoDate(quotationDate),
    validUntilText: toIsoDate(validUntilDate),
    hasLogo: Boolean(logoBuffer),
  });
  const drawHeader = () => {
    doc.rect(42, y, 511, 24).fill('#0f172a');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.text('#', 48, y + 8); doc.text('Description', 75, y + 8); doc.text('HSN/SAC', 255, y + 8); doc.text('Qty', 319, y + 8);
    doc.text('Unit', 369, y + 8); doc.text('Rate', 421, y + 8, { width: 62, align: 'right' });
    doc.text('Amount', 492, y + 8, { width: 55, align: 'right' });
    y += 24;
  };
  drawHeader();
  normalizedLines.forEach((line, index) => {
    if (y > 680) { doc.addPage(); y = 42; drawHeader(); }
    const rowHeight = Math.max(30, doc.heightOfString(line.description, { width: 165 }) + 14);
    if (index % 2 === 0) doc.rect(42, y, 511, rowHeight).fill('#f8fafc');
    doc.font('Helvetica').fontSize(8).fillColor('#0f172a');
    doc.text(String(index + 1), 48, y + 9);
    doc.text(line.description, 75, y + 8, { width: 165 });
    doc.text(line.hsnSac || '-', 255, y + 9, { width: 52 });
    doc.text(String(line.quantity), 319, y + 9, { width: 45, align: 'right' });
    doc.text(line.unit, 369, y + 9, { width: 42 });
    doc.text(money(line.unitRate), 414, y + 9, { width: 70, align: 'right' });
    doc.text(money(line.amount), 482, y + 9, { width: 65, align: 'right' });
    doc.moveTo(42, y + rowHeight).lineTo(553, y + rowHeight).strokeColor('#e2e8f0').stroke();
    y += rowHeight;
  });

  y += 12;
  const totalsX = 353;
  doc.font('Helvetica').fontSize(9).fillColor('#475569').text('Subtotal', totalsX, y, { width: 90 });
  doc.fillColor('#0f172a').text(money(subtotal), 443, y, { width: 110, align: 'right' }); y += 18;
  if (taxType === 'cgst-sgst') {
    doc.fillColor('#475569').text(`Est. CGST ${safeTaxPercent / 2}%`, totalsX, y, { width: 90 }); doc.fillColor('#0f172a').text(money(taxAmount / 2), 443, y, { width: 110, align: 'right' }); y += 18;
    doc.fillColor('#475569').text(`Est. SGST ${safeTaxPercent / 2}%`, totalsX, y, { width: 90 }); doc.fillColor('#0f172a').text(money(taxAmount / 2), 443, y, { width: 110, align: 'right' }); y += 18;
  } else if (taxType === 'igst') {
    doc.fillColor('#475569').text(`Est. IGST ${safeTaxPercent}%`, totalsX, y, { width: 90 }); doc.fillColor('#0f172a').text(money(taxAmount), 443, y, { width: 110, align: 'right' }); y += 18;
  }
  doc.rect(totalsX - 8, y - 4, 208, 26).fill('#0f172a');
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff').text('TOTAL', totalsX, y + 4).text(money(total), 443, y + 4, { width: 102, align: 'right' });
  y += 42;
  if (y > 620) { doc.addPage(); y = 42; }
  const quotationDisclaimer = 'COMMERCIAL QUOTATION - NOT A TAX INVOICE. GST shown is indicative and will be charged at the applicable rate. The final tax invoice will be issued separately through the e-invoicing system and will carry the IRN and signed QR code where applicable.';
  const disclaimerHeight = Math.max(42, doc.heightOfString(quotationDisclaimer, { width: 487 }) + 18);
  doc.roundedRect(42, y, 511, disclaimerHeight, 4).fillAndStroke('#eff6ff', '#bfdbfe');
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1e3a8a').text(quotationDisclaimer, 54, y + 9, { width: 487 });
  y += disclaimerHeight + 16;
  if (y > 650) { doc.addPage(); y = 42; }
  const finalPaymentTerms = String(paymentTerms || billingEntity.defaultPaymentTerms || '').trim();
  const finalTerms = String(termsAndConditions || billingEntity.defaultTermsAndConditions || '').trim();
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('Payment terms', 42, y);
  doc.font('Helvetica').fontSize(8).fillColor('#475569').text(finalPaymentTerms || 'As agreed', 42, y + 15, { width: 245 });
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('Bank details', 310, y);
  doc.font('Helvetica').fontSize(8).fillColor('#475569').text([
    billingEntity.bankName,
    billingEntity.bankAccountName,
    billingEntity.bankAccountNumber ? `A/c: ${billingEntity.bankAccountNumber}` : '',
    billingEntity.bankIfsc ? `IFSC: ${billingEntity.bankIfsc}` : '',
    billingEntity.bankBranch,
  ].filter(Boolean).join('\n') || 'Provided on invoice', 310, y + 15, { width: 243 });
  y += 82;
  if (finalTerms) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('Terms and conditions', 42, y);
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(finalTerms, 42, y + 15, { width: 511 });
    y += doc.heightOfString(finalTerms, { width: 511 }) + 28;
  }
  if (notes) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text('Notes', 42, y);
    doc.font('Helvetica').fontSize(8).fillColor('#475569').text(String(notes), 42, y + 15, { width: 511 });
    y += doc.heightOfString(String(notes), { width: 511 }) + 28;
  }
  if (y > 690) { doc.addPage(); y = 42; }
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a').text(`For ${quotationEntityName}`, 353, y, { width: 200, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor('#475569')
    .text(billingEntity.authorizedSignatoryName || 'Authorised signatory', 353, y + 28, { width: 200, align: 'right' });
  if (billingEntity.authorizedSignatoryDesignation) {
    doc.text(billingEntity.authorizedSignatoryDesignation, 353, y + 40, { width: 200, align: 'right' });
  }
  doc.end();
  const pdfBuffer = await new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const quoteRef = projectRef.collection('supportQuotations').doc();
  const safeNumber = quotationNumber.replace(/[^a-zA-Z0-9-]/g, '_');
  const storagePath = `projects/${projectId}/support/${ticketId}/quotation/${safeNumber}.pdf`;
  const bucket = admin.storage().bucket();
  const file = bucket.file(storagePath);
  const downloadToken = require('crypto').randomUUID();
  await file.save(pdfBuffer, {
    metadata: {
      contentType: 'application/pdf',
      metadata: { firebaseStorageDownloadTokens: downloadToken, quotationNumber, ticketId, projectId },
    },
  });
  const pdfUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const documentRef = projectRef.collection('supportDocuments').doc();
  const quotation = {
    id: quoteRef.id,
    quotationNumber,
    quotationDate: toIsoDate(quotationDate),
    validUntil: toIsoDate(validUntilDate),
    billingEntityId,
    billingEntityName: billingEntity.displayName || billingEntity.legalName,
    supplierGstin: billingEntity.gstin,
    supplierPan: billingEntity.pan || '',
    supplierCin: billingEntity.cin || '',
    customerGstin: client.gstin || '',
    customerPan: client.pan || '',
    customerStateCode: client.stateCode || '',
    customerStateName: client.stateName || '',
    isTaxInvoice: false,
    lines: normalizedLines,
    subtotal,
    taxType,
    taxPercent: safeTaxPercent,
    taxAmount,
    total,
    paymentTerms: finalPaymentTerms,
    termsAndConditions: finalTerms,
    notes: String(notes || ''),
    documentId: documentRef.id,
    pdfUrl,
    storagePath,
    createdBy: auth.uid,
    createdByName: userRecord.displayName || userRecord.email || 'Support user',
    createdAt: new Date().toISOString(),
  };
  const batch = firestore.batch();
  const nextCommercialStatus = ['accepted', 'invoiced'].includes(ticket.commercialStatus)
    ? ticket.commercialStatus
    : 'quotation-prepared';
  batch.set(quoteRef, { ...quotation, createdAt: now, projectId, ticketId });
  batch.set(documentRef, {
    projectId,
    ticketId,
    name: `${quotationNumber}.pdf`,
    url: pdfUrl,
    storagePath,
    category: 'quotation',
    fileSize: pdfBuffer.length,
    contentType: 'application/pdf',
    uploadedAt: now,
    uploadedBy: auth.uid,
    uploadedByName: quotation.createdByName,
  });
  batch.update(ticketRef, {
    quotation,
    quotationNumber,
    quotationDocumentId: documentRef.id,
    estimatedAmount: total,
    commercialStatus: nextCommercialStatus,
    paymentStatus: ticket.paymentStatus || 'not-invoiced',
    updatedAt: now,
  });
  batch.set(ticketRef.collection('activities').doc(), {
    type: 'commercial',
    message: `Quotation ${quotationNumber} prepared for ${money(total)}`,
    createdAt: now,
    createdBy: auth.uid,
    createdByName: quotation.createdByName,
    metadata: { quotationId: quoteRef.id, quotationNumber, total },
  });
  await batch.commit();
  logger.info('Support quotation prepared', { projectId, ticketId, quotationNumber, total, billingEntityId });
  return { quotation };
});

const getSupportFollowUpContext = async ({ auth, projectId, ticketId }) => {
  if (!auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
  }
  if (!projectId || !ticketId) {
    throw new functions.https.HttpsError('invalid-argument', 'projectId and ticketId are required');
  }

  const firestore = admin.firestore();
  const projectRef = firestore.collection('projects').doc(projectId);
  const ticketRef = projectRef.collection('supportTickets').doc(ticketId);
  const [projectSnapshot, ticketSnapshot, documentsSnapshot, userRecord] = await Promise.all([
    projectRef.get(),
    ticketRef.get(),
    projectRef.collection('supportDocuments').get(),
    admin.auth().getUser(auth.uid),
  ]);
  if (!projectSnapshot.exists || !ticketSnapshot.exists) {
    throw new functions.https.HttpsError('not-found', 'Project or support ticket not found');
  }

  const project = projectSnapshot.data();
  const ticket = { id: ticketSnapshot.id, ...ticketSnapshot.data() };
  const isAdmin = auth.token.role === 'admin' && auth.token.status === 'approved';
  const isMember = !project.memberIds || project.memberIds.includes(auth.uid);
  if (auth.token.status !== 'approved' || (!isAdmin && !isMember)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'You do not have access to this support ticket',
    );
  }

  const members = Array.isArray(project.members) ? project.members : [];
  const assigneeMember = members.find((member) => member.userId === ticket.assignee?.userId);
  const assignee = ticket.assignee
    ? {
        ...ticket.assignee,
        name: ticket.assignee.name || assigneeMember?.displayName || assigneeMember?.email,
        email: ticket.assignee.email || assigneeMember?.email,
      }
    : null;
  if (!assignee) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Assign an engineer before preparing a follow-up',
    );
  }

  let recipients;
  try {
    recipients = resolveRecipients({
      assignee,
      members,
      senderEmail: userRecord.email || auth.token.email || '',
    });
  } catch (error) {
    throw new functions.https.HttpsError('failed-precondition', error.message);
  }

  const documents = documentsSnapshot.docs.map((document) => ({
    id: document.id,
    ...document.data(),
  }));
  const missingItems = collectMissingRecords({ ticket, documents, project });
  return {
    firestore,
    projectRef,
    ticketRef,
    project,
    ticket,
    userRecord,
    assignee,
    recipients,
    missingItems,
  };
};

/**
 * Generates a reviewable, status-aware internal follow-up for the assigned
 * support engineer. Recipients and completeness checks come from Firestore.
 */
exports.prepareSupportEngineerFollowUp = onCall(
  { secrets: [geminiApiKeySecret] },
  async (request) => {
    const { projectId, ticketId, quickNote = '' } = request.data || {};
    if (typeof quickNote !== 'string' || quickNote.length > 2000) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'The follow-up instruction must be 2,000 characters or fewer',
      );
    }
    const context = await getSupportFollowUpContext({
      auth: request.auth,
      projectId,
      ticketId,
    });
    const supportUrl = `https://visionbomtracker.web.app/project/${encodeURIComponent(projectId)}/support/${encodeURIComponent(ticketId)}`;
    const fallback = buildFallbackDraft({
      ticket: context.ticket,
      project: context.project,
      assigneeName: context.assignee.name || 'Engineer',
      senderName: context.userRecord.displayName || context.userRecord.email || 'Support team',
      quickNote,
      missingItems: context.missingItems,
      supportUrl,
    });

    let draft = fallback;
    let generatedByAI = false;
    try {
      draft = await prepareSupportFollowUpWithGemini({
        apiKey: geminiApiKeySecret.value(),
        fallback,
        ticket: context.ticket,
        project: context.project,
        assignee: context.assignee,
        quickNote: quickNote.trim(),
        missingItems: context.missingItems,
        supportUrl,
      });
      generatedByAI = draft !== fallback;
    } catch (error) {
      logger.warn('Gemini support follow-up refinement failed; using deterministic draft', {
        projectId,
        ticketId,
        error: error.message,
      });
    }

    return {
      ...draft,
      to: context.recipients.to,
      cc: context.recipients.cc,
      missingItems: context.missingItems,
      generatedByAI,
      aiProvider: generatedByAI ? 'gemini' : 'fallback',
    };
  },
);

/**
 * Sends a reviewed internal follow-up. The server re-resolves recipients so
 * the browser cannot redirect the message away from the assigned engineer or
 * omit the project team.
 */
exports.sendSupportEngineerFollowUp = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { projectId, ticketId, subject = '', body = '' } = request.data || {};
    const cleanSubject = String(subject).replace(/[\r\n]+/g, ' ').trim();
    const cleanBody = String(body).trim();
    if (!cleanSubject || cleanSubject.length > 180 || !cleanBody || cleanBody.length > 12000) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'A subject and message are required and must be within the allowed length',
      );
    }
    const context = await getSupportFollowUpContext({
      auth: request.auth,
      projectId,
      ticketId,
    });
    const escapeHtml = (value) => String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
    const messageHtml = escapeHtml(cleanBody).replace(/\n/g, '<br/>');
    const ticketNumber = escapeHtml(context.ticket.ticketNumber || ticketId);
    const supportUrl = `https://visionbomtracker.web.app/project/${encodeURIComponent(projectId)}/support/${encodeURIComponent(ticketId)}`;
    const messageText = cleanBody.includes(supportUrl)
      ? cleanBody
      : `${cleanBody}\n\nUpdate BOM Tracker: ${supportUrl}`;
    const html = `<!doctype html>
<html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#1e293b;">
  <div style="max-width:680px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.08);">
    <div style="padding:24px 30px;background:#0f172a;color:#fff;">
      <div style="font-size:12px;color:#67e8f9;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">Internal support follow-up</div>
      <h1 style="margin:8px 0 0;font-size:21px;">${ticketNumber}</h1>
    </div>
    <div style="padding:28px 30px;line-height:1.55;">${messageHtml}
      <p style="margin-top:24px;"><a href="${supportUrl}" style="display:inline-block;padding:11px 18px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Update BOM Tracker</a></p>
    </div>
    <div style="padding:14px 30px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">This internal follow-up is recorded in the support activity trail.</div>
  </div>
</body></html>`;

    try {
      const resend = new Resend(getResendApiKey());
      const response = await resend.emails.send({
        from: 'BOM Tracker Support <info@qualitastech.com>',
        to: context.recipients.to,
        ...(context.recipients.cc.length ? { cc: context.recipients.cc } : {}),
        subject: cleanSubject,
        html,
        text: messageText,
      });
      if (response?.error) {
        throw new Error(response.error.message || 'Email provider rejected the message');
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      await context.ticketRef.update({ updatedAt: now, lastEngineerFollowUpAt: now });
      await context.ticketRef.collection('activities').add({
        type: 'communication',
        message: `Engineer follow-up sent to ${context.recipients.to}`,
        createdAt: now,
        createdBy: request.auth.uid,
        createdByName: context.userRecord.displayName || context.userRecord.email || 'Support user',
        metadata: {
          kind: 'engineer-follow-up',
          to: context.recipients.to,
          ccCount: context.recipients.cc.length,
          missingRecordCount: context.missingItems.length,
          subject: cleanSubject,
          messageId: response?.data?.id || response?.id || null,
          supportUrl,
        },
      });
      logger.info('Support engineer follow-up sent', {
        projectId,
        ticketId,
        to: context.recipients.to,
        ccCount: context.recipients.cc.length,
        sentBy: request.auth.uid,
      });
      return {
        success: true,
        messageId: response?.data?.id || response?.id,
        to: context.recipients.to,
        cc: context.recipients.cc,
      };
    } catch (error) {
      logger.error('Support engineer follow-up failed', {
        projectId,
        ticketId,
        error: error.message,
      });
      throw new functions.https.HttpsError(
        'internal',
        `Engineer follow-up could not be sent. ${error.message}`,
      );
    }
  },
);

/**
 * Sends a customer-facing support acknowledgement, quotation, or closure note.
 * The linked support ticket remains the system of record and receives an
 * immutable communication activity entry after a successful send.
 */
exports.sendSupportCommunication = onCall(
  { secrets: [resendApiKey] },
  async (request) => {
    const { auth, data } = request;
    if (!auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentication required');
    }

    const {
      projectId,
      ticketId,
      kind,
      message = '',
      documentId,
    } = data || {};

    if (!projectId || !ticketId || !kind) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'projectId, ticketId, and kind are required',
      );
    }
    if (!['acknowledgement', 'quotation', 'resolution'].includes(kind)) {
      throw new functions.https.HttpsError('invalid-argument', 'Unsupported communication type');
    }
    const firestore = admin.firestore();
    const projectRef = firestore.collection('projects').doc(projectId);
    const ticketRef = projectRef.collection('supportTickets').doc(ticketId);
    const [projectSnapshot, ticketSnapshot, userRecord] = await Promise.all([
      projectRef.get(),
      ticketRef.get(),
      admin.auth().getUser(auth.uid),
    ]);

    if (!projectSnapshot.exists || !ticketSnapshot.exists) {
      throw new functions.https.HttpsError('not-found', 'Project or support ticket not found');
    }

    const project = projectSnapshot.data();
    const ticket = ticketSnapshot.data();
    const isAdmin = auth.token.role === 'admin' && auth.token.status === 'approved';
    const isMember = !project.memberIds || project.memberIds.includes(auth.uid);
    if (auth.token.status !== 'approved' || (!isAdmin && !isMember)) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'You do not have access to this support ticket',
      );
    }

    // The CRM is the source of truth for recipients. Ticket contact fields are
    // retained only as an immutable incident snapshot and legacy fallback.
    let crmContact = null;
    const clientId = ticket.clientId || project.clientId;
    if (clientId && ticket.reportedByContactId) {
      const clientSnapshot = await firestore.collection('clients').doc(clientId).get();
      if (clientSnapshot.exists) {
        const client = clientSnapshot.data();
        const contacts = Array.isArray(client.contacts) && client.contacts.length
          ? client.contacts
          : (client.contactPerson || client.email || client.phone)
            ? [{
                id: 'legacy-primary',
                name: client.contactPerson || 'Primary contact',
                email: client.email || '',
                phone: client.phone || '',
                isActive: true,
              }]
            : [];
        crmContact = contacts.find(
          (contact) =>
            contact.id === ticket.reportedByContactId &&
            contact.isActive !== false,
        ) || null;
      }
    }

    const recipientEmail = crmContact?.email || ticket.reportedByEmail;
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!recipientEmail || !emailPattern.test(recipientEmail)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'The selected client CRM contact does not have a valid email address',
      );
    }

    let documentUrl = '';
    let documentStoragePath = '';
    let documentName = '';
    if (documentId) {
      const documentSnapshot = await projectRef
        .collection('supportDocuments')
        .doc(documentId)
        .get();
      const supportDocument = documentSnapshot.data();
      if (
        !documentSnapshot.exists ||
        supportDocument.ticketId !== ticketId ||
        !supportDocument.url
      ) {
        throw new functions.https.HttpsError(
          'invalid-argument',
          'The selected document is not linked to this support ticket',
        );
      }
      documentUrl = supportDocument.url;
      documentStoragePath = supportDocument.storagePath || '';
      documentName = supportDocument.name || 'support-document.pdf';
    }

    let billingEntityName = 'Qualitas Technologies';
    const communicationBillingEntityId = ticket.quotation?.billingEntityId || project.billingEntityId;
    if (communicationBillingEntityId) {
      const entityRef = communicationBillingEntityId === 'company'
        ? firestore.collection('settings').doc('company')
        : firestore.collection('billingEntities').doc(communicationBillingEntityId);
      const entitySnapshot = await entityRef.get();
      if (entitySnapshot.exists) {
        const entity = entitySnapshot.data();
        billingEntityName = entity.displayName || entity.legalName || entity.companyName || billingEntityName;
      }
    }

    const escapeHtml = (value) =>
      String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    const paragraph = (value) =>
      escapeHtml(value).replace(/\n/g, '<br/>');
    const ticketNumber = escapeHtml(ticket.ticketNumber || ticketId);
    const projectName = escapeHtml(project.projectName || ticket.projectName || projectId);
    const clientName = escapeHtml(project.clientName || ticket.clientName || '');
    const recipientName = escapeHtml(crmContact?.name || ticket.reportedByName || 'Customer');
    const senderName = escapeHtml(userRecord.displayName || userRecord.email || 'Support team');
    const supportUrl = `https://visionbomtracker.web.app/project/${encodeURIComponent(projectId)}/support/${encodeURIComponent(ticketId)}`;

    const templates = {
      acknowledgement: {
        subject: `[${ticketNumber}] Support request acknowledged - ${projectName}`,
        heading: 'Support request acknowledged',
        intro: `We have registered your support request for ${projectName}.`,
        body: `
          <p style="margin:0 0 12px;">Our team is reviewing the reported issue and will coordinate the next diagnostic step with you.</p>
          <table style="width:100%;border-collapse:collapse;margin:18px 0;font-size:14px;">
            <tr><td style="padding:8px;border:1px solid #e2e8f0;color:#64748b;width:150px;">Ticket</td><td style="padding:8px;border:1px solid #e2e8f0;font-weight:600;">${ticketNumber}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e2e8f0;color:#64748b;">Issue</td><td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(ticket.title)}</td></tr>
            <tr><td style="padding:8px;border:1px solid #e2e8f0;color:#64748b;">Priority</td><td style="padding:8px;border:1px solid #e2e8f0;">${escapeHtml(ticket.priority)}</td></tr>
          </table>`,
      },
      quotation: {
        subject: `[${ticketNumber}] Support quotation - ${projectName}`,
        heading: 'Support quotation',
        intro: `Please find the support quotation for ${projectName}.`,
        body: `
          <p style="margin:0 0 12px;">Work will be scheduled after written acceptance or receipt of the applicable customer purchase order.</p>
          ${ticket.quotationNumber ? `<p><strong>Quotation:</strong> ${escapeHtml(ticket.quotationNumber)}</p>` : ''}
          ${ticket.estimatedAmount ? `<p><strong>Quotation amount:</strong> INR ${Number(ticket.estimatedAmount).toLocaleString('en-IN')}</p>` : ''}`,
      },
      resolution: {
        subject: `[${ticketNumber}] RCA and solution report - ${projectName}`,
        heading: 'RCA and solution report',
        intro: `The support work for ${projectName} has been completed.`,
        body: `
          <div style="margin:18px 0;padding:16px;background:#f8fafc;border-radius:8px;">
            <p style="margin:0 0 6px;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;">Root cause</p>
            <p style="margin:0 0 16px;">${paragraph(ticket.rootCause || 'See attached report')}</p>
            <p style="margin:0 0 6px;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;">Corrective action</p>
            <p style="margin:0 0 16px;">${paragraph(ticket.correctiveAction || 'See attached report')}</p>
            <p style="margin:0 0 6px;color:#64748b;font-size:12px;text-transform:uppercase;font-weight:700;">Solution / validation</p>
            <p style="margin:0;">${paragraph(ticket.resolutionSummary || 'See attached report')}</p>
          </div>
          <p>Please confirm that the machine is operating satisfactorily so the ticket can be formally closed.</p>`,
      },
    };
    const template = templates[kind];
    const documentButton = documentUrl
      ? `<a href="${escapeHtml(documentUrl)}" style="display:inline-block;margin:8px 0 18px;padding:11px 18px;background:#0f766e;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Open ${kind === 'quotation' ? 'quotation' : 'report'}</a>`
      : '';
    const customMessage = message
      ? `<div style="margin:18px 0;padding:14px;border-left:3px solid #0891b2;background:#ecfeff;">${paragraph(message)}</div>`
      : '';

    const html = `<!doctype html>
<html>
<body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#1e293b;">
  <div style="max-width:640px;margin:24px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(15,23,42,.08);">
    <div style="padding:26px 30px;background:#0f172a;color:#fff;">
      <div style="font-size:12px;color:#67e8f9;text-transform:uppercase;letter-spacing:.08em;font-weight:700;">${escapeHtml(billingEntityName)} Service &amp; Support</div>
      <h1 style="margin:8px 0 0;font-size:23px;">${template.heading}</h1>
    </div>
    <div style="padding:28px 30px;">
      <p>Dear ${recipientName},</p>
      <p>${template.intro}</p>
      ${template.body}
      ${customMessage}
      ${documentButton}
      <p style="margin-top:22px;">Regards,<br/><strong>${senderName}</strong><br/>${escapeHtml(billingEntityName)}</p>
    </div>
    <div style="padding:14px 30px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
      ${ticketNumber} · ${clientName} · This communication is recorded in the support system.
    </div>
  </div>
</body>
</html>`;

    try {
      const resend = new Resend(getResendApiKey());
      let attachments;
      if (documentStoragePath) {
        const [documentBuffer] = await admin.storage().bucket().file(documentStoragePath).download();
        attachments = [{ filename: documentName, content: documentBuffer }];
      }
      const response = await resend.emails.send({
        from: `${billingEntityName.replace(/[<>\r\n]/g, '')} Service & Support <info@qualitastech.com>`,
        to: recipientEmail,
        subject: template.subject,
        html,
        text: stripHtml(html),
        attachments,
      });
      if (response?.error) {
        throw new Error(response.error.message || 'Email provider rejected the message');
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const updates = { updatedAt: now };
      if (kind === 'acknowledgement' && !ticket.firstResponseAt) {
        updates.firstResponseAt = now;
      }
      if (kind === 'quotation') {
        updates.commercialStatus = 'quotation-sent';
        updates.quotationSentAt = now;
        updates.status = ticket.status === 'open' ? 'waiting' : ticket.status;
      }
      await ticketRef.update(updates);
      await ticketRef.collection('activities').add({
        type: 'communication',
        message: `${template.heading} sent to ${recipientEmail}`,
        createdAt: now,
        createdBy: auth.uid,
        createdByName: userRecord.displayName || userRecord.email || 'Support user',
        metadata: {
          kind,
          to: recipientEmail,
          messageId: response?.data?.id || response?.id || null,
          supportUrl,
        },
      });

      logger.info('Support communication sent', {
        projectId,
        ticketId,
        ticketNumber: ticket.ticketNumber,
        kind,
        to: recipientEmail,
        sentBy: auth.uid,
      });
      return { success: true, messageId: response?.data?.id || response?.id };
    } catch (error) {
      logger.error('Support communication failed', {
        projectId,
        ticketId,
        kind,
        error: error.message,
      });
      throw new functions.https.HttpsError(
        'internal',
        `Support email could not be sent. ${error.message}`,
      );
    }
  },
);

// ==================== TRANSCRIPT EXTRACTION FUNCTIONS ====================

/**
 * Extract activities from standup transcript
 * Groups by project, identifies activity types, extracts key information
 */
exports.extractTranscriptActivities = onRequest(
  {
    secrets: [openaiApiKeySecret],
    timeoutSeconds: 120  // Transcripts can be long
  },
  async (request, response) => {
    // Enable CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    try {
      const { transcript, knownProjects, meetingDate, projectContext } = request.body;

      if (!transcript || typeof transcript !== 'string') {
        response.status(400).json({ error: 'Transcript text is required' });
        return;
      }

      const openaiApiKey = openaiApiKeySecret.value();
      if (!openaiApiKey) {
        logger.error('OpenAI API key not configured');
        response.status(500).json({ error: 'AI service not configured' });
        return;
      }

      // Build list of known projects from BOM Tracker
      const projectsList = knownProjects && knownProjects.length > 0
        ? knownProjects.join(', ')
        : '';

      if (!projectsList && !projectContext) {
        logger.warn('No known projects or context provided - extraction may be limited');
      }

      // Use rich context if provided, otherwise fall back to simple project list
      const projectContextSection = projectContext
        ? projectContext
        : `ACTIVE PROJECTS FROM BOM TRACKER: ${projectsList || '(No projects provided - extract all mentioned projects)'}`;

      const systemPrompt = `You are an expert at extracting structured project updates from engineering standup meeting transcripts.

CONTEXT: This is a daily engineering standup where team members report updates on their assigned projects. The company (Vision AI) builds custom automation, machine vision, and robotics solutions for clients.

${projectContextSection}

TRANSCRIPT FORMAT:
- Speaker lines appear as: "Speaker Name (Vision AI) 00:00:00" or "Speaker Name (Company) 00:00:00"
- Extract the speaker name (without company) and the timestamp
- Each speaker typically discusses 1-3 projects they're working on

YOUR TASK: Extract actionable updates ONLY for projects listed above.

ACTIVITY TYPES (be precise):
- progress: Tangible work completed - "fixture ready", "machine running", "code deployed", "parts received", "testing done"
- blocker: Issues ACTIVELY blocking progress - waiting for approvals, missing parts, technical issues, client delays
- decision: Explicit decisions made during the meeting - "we decided to...", "agreed to use...", "will go with..."
- action: Commitments for future work - "will send by EOD", "need to follow up", "scheduled for tomorrow"
- note: Status context that doesn't fit above - "client visit next week", "awaiting feedback", general status

EXTRACTION RULES:
1. ONLY extract updates for projects listed in the PROJECTS section above
2. Use the VENDORS mapping: When someone mentions a vendor name, attribute to the associated project
3. Use the OWNERS info: When a specific person speaks, likely discussing their owned projects
4. Use ALIASES: Project may be referenced by alternative names (client name, code name, etc.)
5. Any project/company mentioned that is NOT in the list = SALES/LEAD (add to unrecognizedProjects)
6. One speaker may discuss multiple projects - create separate activities for each
7. Keep summaries CLIENT-READABLE (1-2 sentences, professional tone)
8. DO NOT include:
   - Projects not in the known list (these are sales leads)
   - Internal tools/software development discussions
   - Administrative talk, casual conversation, greetings
9. INFER project context - if someone says "the fixture" right after discussing a known project, it's still that project
10. Use "Remember" hints - if a term was previously learned to mean a project, apply that
11. Set confidence: 0.9+ if project explicitly named, 0.7-0.8 if inferred from context/vendor/owner

OUTPUT FORMAT (strict JSON):
{
  "activities": [
    {
      "projectName": "ExactNameFromBOMTracker",
      "type": "progress",
      "summary": "Professional, client-readable summary of the update.",
      "speaker": "SpeakerName",
      "timestamp": "00:02:30",
      "rawExcerpt": "Original text from transcript",
      "confidence": 0.95
    }
  ],
  "unrecognizedProjects": ["ProjectX", "NewLead"],
  "warnings": ["Any extraction issues"]
}

IMPORTANT:
- "unrecognizedProjects" should list ALL project/company names mentioned that are NOT in the BOM Tracker list
- These are potential sales leads or new projects not yet in the system

CRITICAL: Return ONLY valid JSON. No markdown, no explanation.`;

      const userPrompt = `Extract activities from this transcript:

${transcript}`;

      // Using GPT-5.2 for better transcript understanding and extraction
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5.2',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.2,
          max_completion_tokens: 4000,
          response_format: { type: 'json_object' }
        })
      });

      if (!openaiResponse.ok) {
        const errorData = await openaiResponse.json().catch(() => ({}));
        logger.error('OpenAI API error:', errorData);
        response.status(openaiResponse.status).json({
          error: `AI service error: ${errorData.error?.message || 'Unknown error'}`
        });
        return;
      }

      const data = await openaiResponse.json();
      const aiResponse = data.choices[0]?.message?.content;

      if (!aiResponse) {
        response.status(500).json({ error: 'No response from AI service' });
        return;
      }

      let parsedResponse;
      try {
        parsedResponse = JSON.parse(aiResponse);
      } catch (parseError) {
        logger.error('Failed to parse AI response:', aiResponse);
        response.status(500).json({ error: 'Invalid response from AI service' });
        return;
      }

      // Validate and clean up activities
      const activities = (parsedResponse.activities || []).map((activity, index) => ({
        projectName: activity.projectName || 'Unknown',
        type: ['progress', 'blocker', 'decision', 'action', 'note'].includes(activity.type)
          ? activity.type
          : 'note',
        summary: activity.summary || 'No summary',
        speaker: activity.speaker || undefined,
        timestamp: activity.timestamp || undefined,
        rawExcerpt: activity.rawExcerpt || undefined,
        confidence: typeof activity.confidence === 'number' ? activity.confidence : 0.5
      }));

      const result = {
        activities,
        unrecognizedProjects: parsedResponse.unrecognizedProjects || [],
        warnings: parsedResponse.warnings || [],
        totalActivities: activities.length,
        projectsFound: [...new Set(activities.map(a => a.projectName))]
      };

      logger.info('Transcript extraction completed', {
        transcriptLength: transcript.length,
        activitiesCount: activities.length,
        projectsCount: result.projectsFound.length
      });

      response.status(200).json(result);

    } catch (error) {
      logger.error('Error extracting transcript activities:', error);
      response.status(500).json({
        error: 'Internal server error during transcript extraction'
      });
    }
  }
);

/**
 * Generate a client-ready status update from activities
 */
exports.generateStatusUpdate = onRequest(
  {
    secrets: [openaiApiKeySecret]
  },
  async (request, response) => {
    // Enable CORS
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.set('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
      response.status(204).send('');
      return;
    }

    if (request.method !== 'POST') {
      response.status(405).json({ error: 'Method not allowed. Use POST.' });
      return;
    }

    try {
      const { projectName, activities, dateRange } = request.body;

      if (!projectName || !activities || !Array.isArray(activities)) {
        response.status(400).json({ error: 'projectName and activities array are required' });
        return;
      }

      const openaiApiKey = openaiApiKeySecret.value();
      if (!openaiApiKey) {
        response.status(500).json({ error: 'AI service not configured' });
        return;
      }

      // Group activities by type for context
      const byType = {
        progress: activities.filter(a => a.type === 'progress'),
        blocker: activities.filter(a => a.type === 'blocker'),
        decision: activities.filter(a => a.type === 'decision'),
        action: activities.filter(a => a.type === 'action'),
        note: activities.filter(a => a.type === 'note')
      };

      let context = `Project: ${projectName}\n`;
      if (dateRange) {
        context += `Period: ${dateRange.start} to ${dateRange.end}\n`;
      }
      context += '\n';

      if (byType.progress.length > 0) {
        context += `Progress:\n${byType.progress.map(a => `- ${a.summary}`).join('\n')}\n\n`;
      }
      if (byType.blocker.length > 0) {
        context += `Blockers:\n${byType.blocker.map(a => `- ${a.summary}`).join('\n')}\n\n`;
      }
      if (byType.decision.length > 0) {
        context += `Decisions:\n${byType.decision.map(a => `- ${a.summary}`).join('\n')}\n\n`;
      }
      if (byType.action.length > 0) {
        context += `Next Steps:\n${byType.action.map(a => `- ${a.summary}`).join('\n')}\n\n`;
      }

      const systemPrompt = `You are a professional project manager writing client status updates.

Write a concise, professional status update email body based on the provided activities.

RULES:
1. Be professional and client-appropriate
2. Start with a brief summary (1-2 sentences)
3. Use bullet points for clarity
4. Group by: Progress, Current Status, Blockers (if any), Next Steps
5. Keep it concise - 200 words max
6. Don't include internal details or team names unless relevant
7. End with a forward-looking statement

OUTPUT: Return ONLY the status update text (no JSON, no formatting instructions).`;

      // Using GPT-5.2 for better status update generation
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5.2',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: context }
          ],
          temperature: 0.3,
          max_completion_tokens: 1000
        })
      });

      if (!openaiResponse.ok) {
        const errorData = await openaiResponse.json().catch(() => ({}));
        response.status(openaiResponse.status).json({
          error: `AI service error: ${errorData.error?.message || 'Unknown error'}`
        });
        return;
      }

      const data = await openaiResponse.json();
      const statusUpdate = data.choices[0]?.message?.content;

      if (!statusUpdate) {
        response.status(500).json({ error: 'No response from AI service' });
        return;
      }

      logger.info('Status update generated', {
        projectName,
        activitiesCount: activities.length,
        updateLength: statusUpdate.length
      });

      response.status(200).json({
        statusUpdate: statusUpdate.trim(),
        projectName,
        activitiesIncluded: activities.length
      });

    } catch (error) {
      logger.error('Error generating status update:', error);
      response.status(500).json({
        error: 'Internal server error during status update generation'
      });
    }
  }
);

// ---------------------------------------------------------------------------
// Pulse <-> BOM Tracker integration (unified cost tracking)
// ---------------------------------------------------------------------------

function requireAdminContext(context) {
  // v2 onCall passes auth on `context.auth`; custom claims live on `token`.
  const claims = context?.auth?.token || {};
  if (claims.role !== 'admin' || claims.status !== 'approved') {
    throw new functions.https.HttpsError('permission-denied', 'admin access required');
  }
}

async function callPulse(pathAndQuery, secretValue) {
  const url = `${PULSE_BASE_URL}${pathAndQuery}`;
  const res = await fetch(url, { headers: { 'X-API-Key': secretValue } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Pulse ${pathAndQuery} failed: ${res.status} ${body.slice(0, 200)}`);
  }
  return res.json();
}

exports.listPulseProjects = onCall(
  { secrets: [pulseApiKey], region: 'us-central1' },
  async (request) => {
    requireAdminContext(request);
    const json = await callPulse('/api/projects', pulseApiKey.value());
    const projects = (json.projects || []).map((p) => ({
      id: p.id,
      name: p.name,
      tag: p.tag || null,
    }));
    return { projects };
  }
);

// Sum item.totalCost across a BOM, optionally only for items where
// orderDate falls in [from, to] (both inclusive ISO YYYY-MM-DD strings).
// BOM is stored as a single doc at projects/{projectId}/bom/data with a
// top-level `categories` array, each category having an `items` array.
// Each item has `quantity` and `price`; cost = quantity * price.
async function computeMaterialCost(projectId, from, to) {
  const bomSnap = await admin.firestore().collection('projects').doc(projectId).collection('bom').doc('data').get();
  let cumulative = 0;
  let inRange = 0;
  if (bomSnap.exists) {
    const categories = Array.isArray(bomSnap.data().categories) ? bomSnap.data().categories : [];
    for (const cat of categories) {
      const items = Array.isArray(cat.items) ? cat.items : [];
      for (const item of items) {
        const qty = Number(item.quantity) || 0;
        const price = Number(item.price) || 0;
        const cost = qty * price;
        cumulative += cost;
        if (from && to && item.orderDate) {
          const d = String(item.orderDate).slice(0, 10);
          if (d >= from && d <= to) inRange += cost;
        }
      }
    }
  }
  return { cumulative, inRange };
}

// Returns Map<email, hourlyRate>. Reads the engineerRates collection once
// per invocation (small collection — one doc per engineer).
async function loadEngineerRates() {
  const snap = await admin.firestore().collection('engineerRates').get();
  const map = new Map();
  for (const d of snap.docs) {
    const data = d.data();
    if (data.email && Number.isFinite(data.hourlyRate)) {
      map.set(String(data.email).toLowerCase(), Number(data.hourlyRate));
    }
  }
  return map;
}

function resolveRate(email, projectFallback, ratesMap) {
  const r = email ? ratesMap.get(String(email).toLowerCase()) : undefined;
  if (Number.isFinite(r) && r > 0) return { rate: r, source: 'engineer' };
  if (Number.isFinite(projectFallback) && projectFallback > 0) return { rate: projectFallback, source: 'project_fallback' };
  return { rate: 0, source: 'none' };
}

exports.getProjectCosts = onCall(
  { secrets: [pulseApiKey], region: 'us-central1', timeoutSeconds: 60 },
  async (request) => {
    requireAdminContext(request);

    const data = request.data || {};
    const weekStart = String(data.weekStart || '').trim();
    const weekEnd = String(data.weekEnd || '').trim();
    const isoDate = /^\d{4}-\d{2}-\d{2}$/;
    if (!isoDate.test(weekStart) || !isoDate.test(weekEnd)) {
      throw new functions.https.HttpsError('invalid-argument', 'weekStart and weekEnd must be YYYY-MM-DD');
    }

    const [projectsSnap, ratesMap] = await Promise.all([
      admin.firestore().collection('projects').get(),
      loadEngineerRates(),
    ]);

    const results = [];

    for (const projectDoc of projectsSnap.docs) {
      const project = projectDoc.data();
      const projectId = projectDoc.id;
      if (project.status === 'Archived') continue;

      const projectFallbackRate = Number(project.costPerHour) || 0;
      const miscCost = Number(project.miscCost) || 0;
      const poValue = Number(project.poValue) || 0;
      const pulseProjectId = Number(project.pulseProjectId) || null;

      const material = await computeMaterialCost(projectId, weekStart, weekEnd);

      let hoursThisWeek = 0;
      let hoursCumulative = 0;
      let timeCostThisWeek = 0;
      let timeCostCumulative = 0;
      const byPersonMap = new Map(); // email -> aggregate row
      let usingFallbackHours = false;
      const warnings = [];

      if (pulseProjectId) {
        try {
          const [weekJson, lifetimeJson] = await Promise.all([
            callPulse(`/api/projects/${pulseProjectId}/hours-summary?from=${weekStart}&to=${weekEnd}`, pulseApiKey.value()),
            callPulse(`/api/projects/${pulseProjectId}/hours-summary`, pulseApiKey.value()),
          ]);

          for (const p of weekJson.by_person || []) {
            const { rate, source } = resolveRate(p.email, projectFallbackRate, ratesMap);
            const cost = Number(p.hours) * rate;
            hoursThisWeek += Number(p.hours);
            timeCostThisWeek += cost;
            const row = byPersonMap.get(p.email) || { email: p.email, name: p.name, hoursThisWeek: 0, hoursCumulative: 0, costThisWeek: 0, costCumulative: 0, rateUsed: rate, rateSource: source };
            row.hoursThisWeek = Number(p.hours);
            row.costThisWeek = cost;
            byPersonMap.set(p.email, row);
            if (source === 'none') warnings.push(`No rate set for ${p.email}`);
          }

          for (const p of lifetimeJson.by_person || []) {
            const { rate, source } = resolveRate(p.email, projectFallbackRate, ratesMap);
            const cost = Number(p.hours) * rate;
            hoursCumulative += Number(p.hours);
            timeCostCumulative += cost;
            const row = byPersonMap.get(p.email) || { email: p.email, name: p.name, hoursThisWeek: 0, hoursCumulative: 0, costThisWeek: 0, costCumulative: 0, rateUsed: rate, rateSource: source };
            row.hoursCumulative = Number(p.hours);
            row.costCumulative = cost;
            byPersonMap.set(p.email, row);
          }
        } catch (err) {
          logger.error(`Pulse fetch failed for project ${projectId} (pulseProjectId=${pulseProjectId}):`, err);
          warnings.push(`Pulse fetch failed: ${err.message}`);
        }
      } else {
        // Fallback: read existing engineers/weeks subcollection.
        const engineersSnap = await admin.firestore().collection('projects').doc(projectId).collection('engineers').get();
        for (const eng of engineersSnap.docs) {
          const e = eng.data();
          const weeks = e.weeks || {};
          let engHours = 0;
          for (const wk of Object.values(weeks)) {
            engHours += Number(wk.total) || 0;
          }
          hoursCumulative += engHours;
          timeCostCumulative += engHours * projectFallbackRate;
        }
        usingFallbackHours = true;
      }

      const cumulativeTotal = material.cumulative + timeCostCumulative + miscCost;
      const grossProfit = poValue - cumulativeTotal;
      const profitMargin = poValue ? (grossProfit / poValue) * 100 : null;

      results.push({
        projectId,
        projectName: project.projectName || projectId,
        status: project.status,
        pulseProjectId,
        usingFallbackHours,
        thisWeek: {
          materialCost: material.inRange,
          timeHours: hoursThisWeek,
          timeCost: timeCostThisWeek,
          total: material.inRange + timeCostThisWeek,
        },
        cumulative: {
          materialCost: material.cumulative,
          timeHours: hoursCumulative,
          timeCost: timeCostCumulative,
          miscCost,
          total: cumulativeTotal,
          poValue,
          grossProfit,
          profitMargin,
        },
        byPerson: Array.from(byPersonMap.values()).sort((a, b) => b.hoursCumulative - a.hoursCumulative),
        warnings,
      });
    }

    return { range: { from: weekStart, to: weekEnd }, projects: results };
  }
);

// Migration: backfill memberIds/members for all existing projects that lack them.
// Adds all currently approved users to every un-migrated project.
// Call once from Settings as admin. Safe to call multiple times (idempotent per project).
exports.migrateProjectMembership = onCall(async (request) => {
  if (request.auth?.token?.role !== 'admin') {
    throw new functions.https.HttpsError('permission-denied', 'Admin role required.');
  }

  const db = admin.firestore();

  // Find projects without memberIds
  const projectsSnap = await db.collection('projects').get();
  const unmigrated = projectsSnap.docs.filter(d => {
    const data = d.data();
    return !data.memberIds || data.memberIds.length === 0;
  });

  if (unmigrated.length === 0) {
    return { migrated: 0, message: 'All projects already have membership data.' };
  }

  // Collect all approved users (Firebase Auth list, up to 1000)
  const listResult = await admin.auth().listUsers(1000);
  const approvedUsers = listResult.users
    .filter(u => (u.customClaims || {}).status === 'approved')
    .map(u => ({
      userId: u.uid,
      email: u.email || '',
      displayName: u.displayName || u.email || u.uid,
    }));

  const today = new Date().toISOString().split('T')[0];
  const BATCH_SIZE = 500; // Firestore batch limit

  // Write in batches of 500
  for (let i = 0; i < unmigrated.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const slice = unmigrated.slice(i, i + BATCH_SIZE);
    for (const projectDoc of slice) {
      batch.update(projectDoc.ref, {
        memberIds: approvedUsers.map(u => u.userId),
        members: approvedUsers.map(u => ({
          ...u,
          addedAt: today,
          addedBy: 'migration',
        })),
      });
    }
    await batch.commit();
  }

  return {
    migrated: unmigrated.length,
    totalUsers: approvedUsers.length,
    message: `Migrated ${unmigrated.length} project(s) with ${approvedUsers.length} user(s).`,
  };
});

/**
 * One-time migration: move per-project stakeholders subcollection into the project document.
 *
 * For each project:
 *   - Internal stakeholders (userId present) whose email matches a member → set notificationsEnabled=true on the member entry
 *   - Internal stakeholders with no matching member, and all external stakeholders → append to externalRecipients[]
 *   - Leaves the old subcollection in place (harmless; the app no longer reads it)
 *
 * Idempotent: re-running skips projects that have no stakeholders subcollection entries.
 * Must be called by an admin user.
 */
exports.migrateStakeholdersToMembers = onCall(async (request) => {
  requireAdminContext(request);

  const db = admin.firestore();

  const projectsSnap = await db.collection('projects').get();
  const results = { processed: 0, skipped: 0, errors: [] };

  for (const projectDoc of projectsSnap.docs) {
    const projectId = projectDoc.id;
    const projectData = projectDoc.data();

    try {
      const stakeholdersSnap = await db
        .collection('projects').doc(projectId)
        .collection('stakeholders')
        .get();

      if (stakeholdersSnap.empty) {
        results.skipped++;
        continue;
      }

      const existingMembers = projectData.members || [];
      const existingExternal = projectData.externalRecipients || [];
      const existingExternalEmails = new Set(existingExternal.map(r => r.email.toLowerCase()));

      let updatedMembers = existingMembers.map(m => ({ ...m }));
      const newExternalRecipients = [...existingExternal];

      for (const stDoc of stakeholdersSnap.docs) {
        const st = stDoc.data();
        const stEmail = (st.email || '').toLowerCase();
        if (!stEmail) continue;

        const matchingMemberIdx = updatedMembers.findIndex(m => m.email.toLowerCase() === stEmail);

        if (matchingMemberIdx !== -1) {
          // Already a member — propagate notificationsEnabled
          if (updatedMembers[matchingMemberIdx].notificationsEnabled === undefined) {
            updatedMembers[matchingMemberIdx].notificationsEnabled = st.notificationsEnabled !== false;
          }
        } else if (!existingExternalEmails.has(stEmail)) {
          // Not a member and not already in externalRecipients — add as email-only recipient
          newExternalRecipients.push({
            email: st.email,
            name: st.name || st.email,
            notificationsEnabled: st.notificationsEnabled !== false,
          });
          existingExternalEmails.add(stEmail);
        }
      }

      await db.collection('projects').doc(projectId).update({
        members: updatedMembers,
        externalRecipients: newExternalRecipients,
      });

      results.processed++;
      logger.info('Migrated stakeholders for project', { projectId, stakeholderCount: stakeholdersSnap.size });

    } catch (err) {
      logger.error('Failed to migrate stakeholders for project', { projectId, error: err.message });
      results.errors.push({ projectId, error: err.message });
    }
  }

  return {
    ...results,
    message: `Processed ${results.processed} project(s), skipped ${results.skipped} with no stakeholders. Errors: ${results.errors.length}`,
  };
});
