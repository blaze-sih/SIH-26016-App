/**
 * LRVS — LandRecord Model
 * Team BLAZE | SIH26016
 *
 * Central land parcel and acquisition workflow record.
 */

'use strict';

const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');
const { ACQUISITION_STATUS } = require('../utils/constants');

// ── Owner sub-schema ──────────────────────────────────────────────────────────
const ownerSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true },
    fatherName: { type: String, trim: true },
    address: { type: String, trim: true },
    share: { type: String, trim: true }, // e.g. "1/2", "50%"
    contactNumber: { type: String, trim: true },
    aadhaarNumber: { type: String, trim: true, select: false },
    // Preserved raw Marathi from AI
    rawName: { type: String },
  },
  { _id: false }
);

// ── Area sub-schema ───────────────────────────────────────────────────────────
const areaSchema = new mongoose.Schema(
  {
    unit: { type: String, default: 'Hectare' },
    total: { type: String },
    cultivable: { type: String },
    uncultivable: { type: String },
    // Normalized numeric values (where available)
    totalNumeric: { type: Number },
    cultivableNumeric: { type: Number },
    uncultivableNumeric: { type: Number },
  },
  { _id: false }
);

// ── GIS coordinates sub-schema ────────────────────────────────────────────────
const coordinatesSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: undefined }, // [longitude, latitude]
    latitude: { type: Number },
    longitude: { type: Number },
  },
  { _id: false }
);

// ── Main schema ───────────────────────────────────────────────────────────────
const landRecordSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      default: () => `LRVS-${Date.now()}-${uuidv4().slice(0, 8).toUpperCase()}`,
      unique: true,
      index: true,
    },
    projectId: {
      type: String,
      trim: true,
      index: true,
    },
    projectName: {
      type: String,
      trim: true,
    },

    // ── Registration & Survey ─────────────────────────────────────────────────
    registrationNumber: {
      type: String,
      trim: true,
      index: true,
    },
    surveyNumber: {
      type: String,
      trim: true,
      index: true,
    },
    subDivision: {
      type: String,
      trim: true,
    },
    khataNumber: {
      type: String,
      trim: true,
    },

    // ── Administrative Location ───────────────────────────────────────────────
    state: {
      type: String,
      trim: true,
      index: true,
    },
    district: {
      type: String,
      trim: true,
      index: true,
    },
    taluka: {
      type: String,
      trim: true,
    },
    village: {
      type: String,
      trim: true,
    },
    villageCode: {
      type: String,
      trim: true,
    },

    // ── Ownership ─────────────────────────────────────────────────────────────
    owners: [ownerSchema],
    occupancyClass: {
      type: String,
      trim: true,
    },

    // ── Land Details ──────────────────────────────────────────────────────────
    area: areaSchema,
    assessment: { type: String, trim: true },
    encumbrances: { type: String, default: null },
    lastMutationNumber: { type: String, trim: true },
    landType: { type: String, trim: true },
    landUse: { type: String, trim: true },

    // ── Acquisition ───────────────────────────────────────────────────────────
    acquisitionPurpose: { type: String, trim: true },
    acquisitionAuthority: { type: String, trim: true },
    proposedAcquisitionDate: { type: Date },

    // ── GIS ───────────────────────────────────────────────────────────────────
    location: coordinatesSchema,

    // ── Workflow Status ───────────────────────────────────────────────────────
    acquisitionStatus: {
      type: String,
      enum: Object.values(ACQUISITION_STATUS),
      default: ACQUISITION_STATUS.DRAFT,
      index: true,
    },
    compensationStatus: {
      type: String,
      default: null,
    },
    // ── Notifications (Section 13) ──────────────────────────────────────────
    notificationNumber: { type: String, trim: true },
    notificationDate: { type: Date },
    notificationType: { type: String, trim: true },
    notificationStatus: { type: String, default: 'Issued' },

    // ── Award Details (Section 14) ───────────────────────────────────────────
    awardNumber: { type: String, trim: true },
    awardDate: { type: Date },
    awardAmount: { type: Number, min: 0 },
    awardStatus: { type: String, default: 'Declared' },

    // ── Possession Details (Section 15) ──────────────────────────────────────
    possessionStatus: {
      type: String,
      enum: ['NOT_STARTED', 'IN_PROGRESS', 'POSSESSION_PENDING', 'POSSESSION_COMPLETED'],
      default: 'NOT_STARTED',
    },
    possessionDate: { type: Date },
    possessionOfficer: { type: String, trim: true },
    possessionOfficerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    possessionEvidenceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
    possessionRemarks: { type: String, trim: true },

    // ── R&R Details (Section 16) ─────────────────────────────────────────────
    rrStatus: {
      type: String,
      enum: ['NOT_STARTED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED'],
      default: 'NOT_STARTED',
      comment: 'Rehabilitation & Resettlement status',
    },
    rehabilitationStatus: {
      type: String,
      enum: ['NOT_STARTED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED'],
      default: 'NOT_STARTED',
    },
    resettlementStatus: {
      type: String,
      enum: ['NOT_STARTED', 'IN_PROGRESS', 'PARTIALLY_COMPLETED', 'COMPLETED'],
      default: 'NOT_STARTED',
    },
    benefitsProvided: [{ type: String }],
    pendingActions: [{ type: String }],
    affectedFamilies: { type: Number, default: 0 },
    displacedFamilies: { type: Number, default: 0 },

    // ── Assignment & Submission ──────────────────────────────────────────────
    currentAuthority: {
      type: String,
      trim: true,
    },
    assignedOfficer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    assignedOfficerName: {
      type: String,
      trim: true,
    },
    submittedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    submittedByUserId: {
      type: String,
      trim: true,
    },
    landOwnerUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },

    // ── References ────────────────────────────────────────────────────────────
    primaryDocumentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Document',
    },

    // ── Audit ─────────────────────────────────────────────────────────────────
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // ── Integrity ─────────────────────────────────────────────────────────────
    blockchainHash: {
      type: String,
    },
    blockchainTxHash: {
      type: String,
    },
    blockchainBlockNumber: {
      type: Number,
    },
    blockchainNetwork: {
      type: String,
    },
    blockchainTimestamp: {
      type: Date,
    },

    // ── Status History ────────────────────────────────────────────────────────
    statusHistory: [
      {
        status: String,
        changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        changedAt: { type: Date, default: Date.now },
        remarks: String,
        _id: false,
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Indexes ───────────────────────────────────────────────────────────────────
landRecordSchema.index({ acquisitionStatus: 1, district: 1 });
landRecordSchema.index({ createdBy: 1, acquisitionStatus: 1 });
landRecordSchema.index({ 'location.coordinates': '2dsphere' });
landRecordSchema.index({ projectId: 1, acquisitionStatus: 1 });
landRecordSchema.index({ state: 1, acquisitionStatus: 1 });
landRecordSchema.index({ createdAt: -1 });

// ── Virtual: primary owner name ───────────────────────────────────────────────
landRecordSchema.virtual('primaryOwnerName').get(function () {
  if (this.owners && this.owners.length > 0) {
    return this.owners[0].name || this.owners[0].rawName || null;
  }
  return null;
});

// ── Virtual: status alias for acquisitionStatus ───────────────────────────────
landRecordSchema.virtual('status')
  .get(function () {
    return this.acquisitionStatus;
  })
  .set(function (val) {
    this.acquisitionStatus = val;
  });

module.exports = mongoose.model('LandRecord', landRecordSchema);
