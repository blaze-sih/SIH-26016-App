/**
 * LRVS — Approval Model
 * Team BLAZE | SIH26016
 */

'use strict';

const mongoose = require('mongoose');
const { APPROVAL_ACTION } = require('../utils/constants');

const approvalSchema = new mongoose.Schema(
  {
    requestId: {
      type: String,
      required: true,
      index: true,
    },
    landRecordId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LandRecord',
      required: true,
      index: true,
    },
    verificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Verification',
    },

    // ── Approval Hierarchy ────────────────────────────────────────────────────
    approvalLevel: {
      type: Number,
      default: 1,
      comment: '1=District, 2=State, 3=Central',
    },
    authority: {
      type: String,
      trim: true,
      comment: 'DISTRICT_AUTHORITY / STATE_AUTHORITY / CENTRAL_AUTHORITY',
    },

    // ── Decision ──────────────────────────────────────────────────────────────
    action: {
      type: String,
      enum: Object.values(APPROVAL_ACTION),
      default: APPROVAL_ACTION.PENDING,
      index: true,
    },
    reviewer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    reviewerName: { type: String },
    reviewedAt: { type: Date },
    remarks: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    // ── State transition snapshot ─────────────────────────────────────────────
    previousStatus: { type: String },
    newStatus: { type: String },

    // ── Forward to (when action = FORWARDED) ─────────────────────────────────
    forwardedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    forwardedToAuthority: { type: String },

    // ── Supporting documents ──────────────────────────────────────────────────
    attachments: [
      {
        documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
        description: String,
        _id: false,
      },
    ],

    // ── Blockchain ────────────────────────────────────────────────────────────
    blockchainTxHash: { type: String },
    blockchainBlockNumber: { type: Number },
    blockchainTimestamp: { type: Date },
    approvalHash: { type: String }, // SHA-256 of approval record
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ── Virtuals for backward compatibility ───────────────────────────────────────
approvalSchema.virtual('status')
  .get(function () { return this.action; })
  .set(function (val) { this.action = val; });

approvalSchema.virtual('level')
  .get(function () { return this.approvalLevel; })
  .set(function (val) { this.approvalLevel = val; });

// ── Indexes ───────────────────────────────────────────────────────────────────
approvalSchema.index({ requestId: 1, action: 1 });
approvalSchema.index({ reviewer: 1, action: 1 });
approvalSchema.index({ authority: 1, action: 1 });
approvalSchema.index({ approvalLevel: 1, action: 1 });
approvalSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Approval', approvalSchema);
