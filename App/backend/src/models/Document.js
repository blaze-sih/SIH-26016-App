/**
 * LRVS — Document Model (Upgraded Storage Architecture)
 * Team BLAZE | SIH26016
 *
 * Implements strict separation:
 * 1. Document file (binary stored via DocumentStorageService)
 * 2. Document metadata (this model)
 * 3. AI extraction data (DocumentExtraction model)
 * 4. Correction history (DocumentCorrection model)
 * 5. Verification status & verified values
 */

'use strict';

const mongoose = require('mongoose');
const {
  DOCUMENT_PROCESSING_STATUS,
  DOCUMENT_SOURCE_TYPES,
  DOCUMENT_STORAGE_PROVIDERS,
} = require('../utils/constants');

const versionSchema = new mongoose.Schema(
  {
    versionNumber: { type: Number, required: true },
    storageKey: { type: String, required: true },
    fileHash: { type: String, required: true },
    fileSize: { type: Number, required: true },
    originalFileName: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: String },
    changeReason: { type: String },
  },
  { _id: false }
);

const verifiedDataSchema = new mongoose.Schema(
  {
    ownerName: { type: String },
    surveyNumber: { type: String },
    village: { type: String },
    district: { type: String },
    landArea: { type: Number },
    unit: { type: String, default: 'Hectare' },
    verifiedAt: { type: Date },
    verifiedBy: { type: String },
    notes: { type: String },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    documentId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    ownerId: {
      type: String,
      required: true,
      index: true,
    },
    landParcelId: {
      type: String,
      index: true,
    },
    acquisitionRequestId: {
      type: String,
      index: true,
    },
    // Backwards-compatible references for existing modules
    landRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LandRecord',
      index: true,
    },
    requestId: {
      type: String,
      index: true,
    },

    documentType: {
      type: String,
      required: [true, 'Document type is required'],
      index: true,
    },

    // ── File storage metadata ──────────────────────────────────────────────────
    originalFileName: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
      required: true,
    },
    storageProvider: {
      type: String,
      enum: Object.values(DOCUMENT_STORAGE_PROVIDERS),
      default: DOCUMENT_STORAGE_PROVIDERS.LOCAL,
    },
    storageKey: {
      type: String,
      required: true,
    },
    fileHash: {
      type: String,
      required: true,
      index: true,
    },

    // Backwards-compatible aliases for existing controllers
    originalName: { type: String },
    storedName: { type: String },
    path: { type: String },
    size: { type: Number },
    hash: { type: String },

    // ── External Source & Versioning ──────────────────────────────────────────
    sourceType: {
      type: String,
      enum: Object.values(DOCUMENT_SOURCE_TYPES),
      default: DOCUMENT_SOURCE_TYPES.USER_UPLOAD,
    },
    externalDocumentId: {
      type: String,
      default: null,
    },
    currentVersion: {
      type: Number,
      default: 1,
    },
    versions: [versionSchema],

    // ── Lifecycles & Workflow Status ──────────────────────────────────────────
    processingStatus: {
      type: String,
      enum: Object.values(DOCUMENT_PROCESSING_STATUS),
      default: DOCUMENT_PROCESSING_STATUS.UPLOADED,
      index: true,
    },
    verificationStatus: {
      type: String,
      enum: ['PENDING', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'],
      default: 'PENDING',
      index: true,
    },
    aiProcessingStatus: {
      type: String,
      enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
      default: 'PENDING',
      index: true,
    },
    aiStatus: {
      type: String,
      default: 'PENDING',
    },

    // ── Connected Extraction & Final Verified Data ────────────────────────────
    currentExtractionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DocumentExtraction',
    },
    verifiedData: verifiedDataSchema,

    // ── Blockchain Hash Registration (Audit Ready) ───────────────────────────
    blockchainTxHash: { type: String },
    blockchainBlockNumber: { type: Number },
    blockchainTimestamp: { type: Date },

    // ── Audit Metadata ────────────────────────────────────────────────────────
    uploadedBy: {
      type: String,
      required: true,
    },
    uploadedByName: {
      type: String,
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
    description: {
      type: String,
      trim: true,
    },

    // ── Soft Delete ───────────────────────────────────────────────────────────
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: { type: Date },
    deletedBy: { type: String },
  },
  {
    timestamps: true,
  }
);

// Synchronize compatibility properties before saving
documentSchema.pre('save', function (next) {
  if (!this.originalName) this.originalName = this.originalFileName;
  if (!this.storedName) this.storedName = this.storageKey ? this.storageKey.split('/').pop() : this.documentId;
  if (!this.path) this.path = this.storageKey;
  if (!this.size) this.size = this.fileSize;
  if (!this.hash) {
    this.hash = (this.fileHash || '').replace(/^sha256:/i, '');
  } else {
    this.hash = this.hash.replace(/^sha256:/i, '');
  }
  if (!this.requestId) this.requestId = this.acquisitionRequestId;
  if (!this.aiStatus) this.aiStatus = this.aiProcessingStatus;
  next();
});

// Indexes for fast lookup
documentSchema.index({ ownerId: 1, landParcelId: 1 });
documentSchema.index({ acquisitionRequestId: 1, processingStatus: 1 });
documentSchema.index({ fileHash: 1, isDeleted: 1 });
documentSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Document', documentSchema);
