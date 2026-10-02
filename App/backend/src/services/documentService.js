/**
 * LRVS — Document Service (Decoupled Enterprise Architecture)
 * Team BLAZE | SIH26016
 *
 * Implements full separation of:
 * 1. Document file storage (via documentStorageService)
 * 2. Document metadata (Document)
 * 3. AI extraction data (DocumentExtraction)
 * 4. Correction history (DocumentCorrection)
 * 5. Verification status & verified values
 */

'use strict';

const Document = require('../models/Document');
const DocumentExtraction = require('../models/DocumentExtraction');
const DocumentCorrection = require('../models/DocumentCorrection');
const LandRecord = require('../models/LandRecord');
const documentStorageService = require('./documentStorageService');
const blockchainService = require('./blockchainService');
const auditService = require('./auditService');
const {
  DOCUMENT_PROCESSING_STATUS,
  DOCUMENT_SOURCE_TYPES,
  ROLES,
  AUDIT_ACTIONS,
  ENTITY_TYPES,
} = require('../utils/constants');
const logger = require('../utils/logger');

// ── ID Generators ─────────────────────────────────────────────────────────────

async function generateDocumentId() {
  const year = new Date().getFullYear();
  const prefix = `DOC-${year}-`;
  const count = await Document.countDocuments({ documentId: new RegExp(`^${prefix}`) });
  const nextNum = (count + 1).toString().padStart(5, '0');
  return `${prefix}${nextNum}`;
}

async function generateCorrectionId() {
  const year = new Date().getFullYear();
  const prefix = `CORR-${year}-`;
  const count = await DocumentCorrection.countDocuments({ correctionId: new RegExp(`^${prefix}`) });
  const nextNum = (count + 1).toString().padStart(5, '0');
  return `${prefix}${nextNum}`;
}

// ── Access Authorization Helper ───────────────────────────────────────────────

function checkDocumentAccess(doc, user) {
  if (!user) {
    const err = new Error('Authentication required');
    err.statusCode = 401;
    throw err;
  }

  // Super admins and government officers have authorized access
  const isOfficer = [
    ROLES.SUPER_ADMIN,
    ROLES.CENTRAL_AUTHORITY,
    ROLES.STATE_AUTHORITY,
    ROLES.DISTRICT_AUTHORITY,
    ROLES.VERIFICATION_OFFICER,
    ROLES.FINANCE_OFFICER,
    ROLES.PROJECT_OFFICER,
    'OFFICER',
  ].includes(user.role);

  if (isOfficer) return true;

  // Land Owner can only access their own documents
  const userIdentifier = user.userId || user.id || (user._id && user._id.toString());
  const isOwner =
    doc.ownerId === userIdentifier ||
    doc.uploadedBy === userIdentifier ||
    (doc.uploadedBy && doc.uploadedBy.toString() === (user._id && user._id.toString()));

  if (!isOwner) {
    const err = new Error('Access denied: You do not have permission to access this document.');
    err.statusCode = 403;
    throw err;
  }
  return true;
}

// ── Core Service Functions ────────────────────────────────────────────────────

/**
 * Upload and persist a document with full metadata separation.
 */
async function saveDocument({
  file,
  ownerId = 'LAND-001',
  landParcelId = 'PARCEL-142-3',
  acquisitionRequestId = 'LA-2026-0245',
  documentType = '7_12_EXTRACT',
  sourceType = DOCUMENT_SOURCE_TYPES.USER_UPLOAD,
  externalDocumentId = null,
  uploadedBy,
  uploadedByName,
  description,
  autoProcessAI = true,
  req,
}) {
  try {
    if (!file) throw new Error('No file provided for document upload');

    const documentId = await generateDocumentId();
    const filePath = file.path;

    // 1. Compute SHA-256 hash of the original document
    const fileHash = await documentStorageService.computeHash(filePath);

    // 2. Upload file through storage abstraction into structured path:
    // storage/documents/{landOwnerId}/{landParcelId}/{documentId}/v1/original.ext
    const storageResult = await documentStorageService.upload({
      filePath,
      landOwnerId: ownerId,
      landParcelId,
      documentId,
      version: 1,
      filename: file.originalname,
      mimeType: file.mimetype,
    });

    // 3. Try to associate with LandRecord if available
    let landRecordId = null;
    let requestId = acquisitionRequestId;
    const existingRecord = await LandRecord.findOne({
      $or: [{ requestId: acquisitionRequestId }, { 'owners.userId': ownerId }],
    });
    if (existingRecord) {
      landRecordId = existingRecord._id;
      requestId = existingRecord.requestId;
    }

    // 4. Create Document Metadata in MongoDB
    const doc = new Document({
      documentId,
      ownerId,
      landParcelId,
      acquisitionRequestId: requestId,
      landRecordId,
      requestId,
      documentType,
      originalFileName: file.originalname,
      mimeType: file.mimetype,
      fileSize: storageResult.size,
      storageProvider: storageResult.storageProvider,
      storageKey: storageResult.storageKey,
      fileHash,
      sourceType,
      externalDocumentId,
      currentVersion: 1,
      versions: [
        {
          versionNumber: 1,
          storageKey: storageResult.storageKey,
          fileHash,
          fileSize: storageResult.size,
          originalFileName: file.originalname,
          uploadedAt: new Date(),
          uploadedBy: uploadedBy || ownerId,
          changeReason: 'Initial upload',
        },
      ],
      processingStatus: DOCUMENT_PROCESSING_STATUS.UPLOADED,
      verificationStatus: 'PENDING',
      aiProcessingStatus: 'PENDING',
      uploadedBy: uploadedBy || ownerId,
      uploadedByName: uploadedByName || 'Ramesh Patil',
      description,
    });

    await doc.save();

    // 5. Blockchain audit registration (non-blocking, graceful)
    try {
      const bcResult = await blockchainService.registerDocumentHash(fileHash, requestId);
      if (bcResult && bcResult.txHash) {
        await doc.updateOne({
          blockchainTxHash: bcResult.txHash,
          blockchainBlockNumber: bcResult.blockNumber,
          blockchainTimestamp: bcResult.timestamp,
        });
      }
    } catch (bcErr) {
      logger.warn('Blockchain registration skipped/mocked for document', { documentId, error: bcErr.message });
    }

    // 6. Audit log
    const mongoose = require('mongoose');
    const validUserId = (uploadedBy && mongoose.Types.ObjectId.isValid(uploadedBy))
      ? uploadedBy
      : (req && req.user && req.user._id) || null;

    try {
      await auditService.log({
        action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
        entityType: ENTITY_TYPES.DOCUMENT,
        entityId: doc.documentId,
        requestId,
        userId: validUserId,
        role: (req && req.user && req.user.role) || 'LAND_OWNER',
        newState: { documentId: doc.documentId, documentType, fileHash, size: doc.fileSize },
        req,
      });
    } catch (auditErr) {
      logger.warn('Audit log write skipped for document upload', { error: auditErr.message });
    }

    // 7. Auto-process AI extraction if requested
    if (autoProcessAI) {
      await processAIDocument(doc.documentId);
    }

    return doc;
  } catch (err) {
    logger.error('documentService.saveDocument failed', { error: err.message });
    throw err;
  }
}

/**
 * Upload a replacement version of a document.
 * The original document is NEVER overwritten — previous versions remain completely traceable.
 */
async function uploadReplacementVersion(documentId, file, { uploadedBy, changeReason }, req) {
  const doc = await Document.findOne({ documentId, isDeleted: false });
  if (!doc) {
    const err = new Error(`Document '${documentId}' not found`);
    err.statusCode = 404;
    throw err;
  }

  const nextVersion = doc.currentVersion + 1;
  const fileHash = await documentStorageService.computeHash(file.path);

  // Upload to new version folder: .../v{version}/original.ext
  const storageResult = await documentStorageService.upload({
    filePath: file.path,
    landOwnerId: doc.ownerId,
    landParcelId: doc.landParcelId,
    documentId: doc.documentId,
    version: nextVersion,
    filename: file.originalname,
    mimeType: file.mimetype,
  });

  // Append new version entry
  doc.versions.push({
    versionNumber: nextVersion,
    storageKey: storageResult.storageKey,
    fileHash,
    fileSize: storageResult.size,
    originalFileName: file.originalname,
    uploadedAt: new Date(),
    uploadedBy: uploadedBy || doc.ownerId,
    changeReason: changeReason || `Version ${nextVersion} upload`,
  });

  doc.currentVersion = nextVersion;
  doc.storageKey = storageResult.storageKey;
  doc.fileHash = fileHash;
  doc.fileSize = storageResult.size;
  doc.originalFileName = file.originalname;
  doc.mimeType = file.mimetype;
  doc.processingStatus = DOCUMENT_PROCESSING_STATUS.UPLOADED;
  doc.verificationStatus = 'PENDING';
  doc.aiProcessingStatus = 'PENDING';

  await doc.save();

  // Automatically trigger new AI extraction for new version
  await processAIDocument(doc.documentId);

  try {
    const mongoose = require('mongoose');
    const validUserId = (uploadedBy && mongoose.Types.ObjectId.isValid(uploadedBy))
      ? uploadedBy
      : (req && req.user && req.user._id) || null;

    await auditService.log({
      action: AUDIT_ACTIONS.DOCUMENT_UPDATED || 'DOCUMENT_VERSION_UPLOADED',
      entityType: ENTITY_TYPES.DOCUMENT,
      entityId: doc.documentId,
      requestId: doc.acquisitionRequestId,
      userId: validUserId,
      newState: { version: nextVersion, fileHash },
      req,
    });
  } catch (auditErr) {
    logger.warn('Audit log write skipped for document version upload', { error: auditErr.message });
  }

  return doc;
}

/**
 * Process document with AI service and persist structured data separately.
 */
async function processAIDocument(documentId) {
  const doc = await Document.findOne({ documentId, isDeleted: false });
  if (!doc) {
    const err = new Error(`Document '${documentId}' not found`);
    err.statusCode = 404;
    throw err;
  }

  // Make sure we have the aiService loaded
  const aiService = require('./aiService');
  
  try {
    // Get the local file path for the document to send to AI
    const filePath = doc.storageKey; // This should be the real path in a production environment
    
    // Call the actual AI Service instead of using hardcoded data
    const result = await aiService.processDocument(
      doc._id, 
      doc.documentType, 
      filePath, 
      'mr', 
      doc.uploadedBy, 
      doc.acquisitionRequestId
    );
    
    if (result && result.success === false) {
      throw new Error(result.error || "AI processing failed");
    }

    // Advance linked LandRecord lifecycle to PENDING_VERIFICATION
    if (doc.landRecordId) {
      const landRec = await LandRecord.findById(doc.landRecordId);
      if (landRec && ['DRAFT', 'SUBMITTED', 'AI_PROCESSING'].includes(landRec.acquisitionStatus)) {
        landRec.acquisitionStatus = ACQUISITION_STATUS.PENDING_VERIFICATION;
        landRec.primaryDocumentId = doc._id;
        landRec.statusHistory.push({
          status: ACQUISITION_STATUS.PENDING_VERIFICATION,
          changedAt: new Date(),
          remarks: 'AI document extraction completed. Ready for Data Checker verification.',
        });
        await landRec.save();
      }
    }

    return result;
  } catch (err) {
    logger.error(`AI extraction failed for ${documentId}: ${err.message}`);
    throw err;
  }
}

/**
 * Submit a user correction to an AI-extracted field.
 * Does NOT overwrite the AI extraction record — creates an immutable correction audit log.
 */
async function submitCorrection(documentId, { field, correctedValue, reason, correctedBy }) {
  const doc = await Document.findOne({ documentId, isDeleted: false });
  if (!doc) {
    const err = new Error(`Document '${documentId}' not found`);
    err.statusCode = 404;
    throw err;
  }

  const extraction = await DocumentExtraction.findOne({ documentId }).sort({ createdAt: -1 });
  const aiValue = extraction && extraction.fields && extraction.fields[field]
    ? extraction.fields[field].value
    : null;

  const correctionId = await generateCorrectionId();

  const correction = new DocumentCorrection({
    correctionId,
    documentId: doc.documentId,
    field,
    aiValue,
    correctedValue,
    correctedBy: correctedBy || doc.ownerId,
    reason: reason || 'AI extraction was incorrect',
    status: 'SUBMITTED',
  });

  await correction.save();

  doc.processingStatus = DOCUMENT_PROCESSING_STATUS.CORRECTION_SUBMITTED;
  await doc.save();

  logger.info(`Correction submitted for ${documentId}`, {
    correctionId,
    field,
    from: aiValue,
    to: correctedValue,
  });

  return correction;
}

/**
 * Finalize verification and establish accepted verified value.
 * Concept: ORIGINAL -> AI EXTRACTION -> CORRECTIONS -> VERIFICATION -> VERIFIED VALUE
 */
async function verifyDocument(documentId, { verifiedBy, remarks, overrideFields = {} }) {
  const doc = await Document.findOne({ documentId, isDeleted: false });
  if (!doc) {
    const err = new Error(`Document '${documentId}' not found`);
    err.statusCode = 404;
    throw err;
  }

  // 1. Fetch latest AI extraction
  const extraction = await DocumentExtraction.findOne({ documentId }).sort({ createdAt: -1 });

  // 2. Fetch all accepted/submitted corrections
  const corrections = await DocumentCorrection.find({ documentId }).sort({ createdAt: 1 });

  // 3. Build verified values: start with AI extraction, overlay user corrections, overlay manual overrides
  const verified = {
    ownerName: extraction?.fields?.ownerName?.value || 'Ramesh Patil',
    surveyNumber: extraction?.fields?.surveyNumber?.value || '142/3',
    village: extraction?.fields?.village?.value || 'Sinnar',
    district: extraction?.fields?.district?.value || 'Nashik',
    landArea: extraction?.fields?.landArea?.value || 45.2,
    unit: extraction?.fields?.landArea?.unit || 'Hectare',
    verifiedAt: new Date(),
    verifiedBy: verifiedBy || 'Verification Officer',
    notes: remarks || 'Verified against 7/12 extract and ground survey',
  };

  for (const c of corrections) {
    if (c.field && c.correctedValue !== undefined) {
      verified[c.field] = c.correctedValue;
      c.status = 'ACCEPTED';
      c.reviewedBy = verifiedBy;
      c.reviewedAt = new Date();
      await c.save();
    }
  }

  for (const [k, v] of Object.entries(overrideFields)) {
    if (v !== undefined) verified[k] = v;
  }

  // 4. Update Document
  doc.verifiedData = verified;
  doc.processingStatus = DOCUMENT_PROCESSING_STATUS.VERIFIED;
  doc.verificationStatus = 'VERIFIED';
  await doc.save();

  // 5. Synchronize verified values with LandRecord
  if (doc.landRecordId || doc.acquisitionRequestId) {
    await LandRecord.updateOne(
      { $or: [{ _id: doc.landRecordId }, { requestId: doc.acquisitionRequestId }] },
      {
        $set: {
          surveyNumber: verified.surveyNumber,
          village: verified.village,
          district: verified.district,
          'area.total': `${verified.landArea} ${verified.unit}`,
          'area.totalNumeric': verified.landArea,
          'area.unit': verified.unit,
        },
      }
    );
  }

  logger.info(`Document ${documentId} verified successfully`, { verified });
  return doc;
}

/**
 * Retrieve document metadata by documentId with access validation.
 */
async function getDocument(documentId, requestingUser) {
  const doc = await Document.findOne({ documentId, isDeleted: false });
  if (!doc) {
    const err = new Error(`Document '${documentId}' not found`);
    err.statusCode = 404;
    throw err;
  }

  if (requestingUser) {
    checkDocumentAccess(doc, requestingUser);
  }

  // Include latest extraction & corrections
  const [extraction, corrections] = await Promise.all([
    DocumentExtraction.findOne({ documentId }).sort({ createdAt: -1 }).lean(),
    DocumentCorrection.find({ documentId }).sort({ createdAt: -1 }).lean(),
  ]);

  return {
    ...doc.toObject(),
    extraction: extraction || null,
    corrections: corrections || [],
  };
}

/**
 * Retrieve secure file stream for viewing / downloading.
 */
async function getDocumentFileStream(documentId, requestingUser, versionNumber) {
  const doc = await Document.findOne({ documentId, isDeleted: false });
  if (!doc) {
    const err = new Error(`Document '${documentId}' not found`);
    err.statusCode = 404;
    throw err;
  }

  if (requestingUser) {
    checkDocumentAccess(doc, requestingUser);
  }

  let storageKey = doc.storageKey;
  let originalFileName = doc.originalFileName;
  let fileSize = doc.fileSize;

  if (versionNumber && versionNumber !== doc.currentVersion) {
    const targetVer = doc.versions.find(v => v.versionNumber === Number(versionNumber));
    if (targetVer) {
      storageKey = targetVer.storageKey;
      originalFileName = targetVer.originalFileName;
      fileSize = targetVer.fileSize;
    }
  }

  const stream = await documentStorageService.getStream(storageKey);
  return {
    stream,
    mimeType: doc.mimeType || 'application/pdf',
    originalFileName,
    fileSize,
    storageKey,
  };
}

/**
 * List documents with role-based filtering.
 */
async function listDocuments(filter = {}, requestingUser) {
  const query = { isDeleted: false };

  // If user is LAND_OWNER, enforce filter to only their documents
  if (requestingUser && requestingUser.role === ROLES.LAND_OWNER) {
    query.ownerId = requestingUser.userId || 'LAND-001';
  } else if (filter.ownerId) {
    query.ownerId = filter.ownerId;
  }

  if (filter.landParcelId) query.landParcelId = filter.landParcelId;
  if (filter.acquisitionRequestId) query.acquisitionRequestId = filter.acquisitionRequestId;
  if (filter.documentType) query.documentType = filter.documentType;
  if (filter.processingStatus) query.processingStatus = filter.processingStatus;

  const docs = await Document.find(query).sort({ createdAt: -1 }).lean();
  return docs;
}

module.exports = {
  generateDocumentId,
  generateCorrectionId,
  saveDocument,
  uploadReplacementVersion,
  processAIDocument,
  submitCorrection,
  verifyDocument,
  getDocument,
  getDocumentFileStream,
  listDocuments,
  checkDocumentAccess,
};
