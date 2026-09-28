/**
 * LRVS — Verification Controller
 * Team BLAZE | SIH26016
 */

'use strict';

const verificationService = require('../services/verificationService');
const blockchainService = require('../services/blockchainService');
const auditService = require('../services/auditService');
const { success, error, paginated } = require('../utils/apiResponse');
const { AUDIT_ACTIONS, ENTITY_TYPES, PAGINATION } = require('../utils/constants');
const logger = require('../utils/logger');

// ── GET /api/verification/queue ───────────────────────────────────────────────
async function getQueue(req, res, next) {
  try {
    const {
      page = PAGINATION.DEFAULT_PAGE,
      limit = PAGINATION.DEFAULT_LIMIT,
      status,
      documentType,
      search,
      dateFrom,
      dateTo,
      confidence,
    } = req.query;

    const result = await verificationService.getQueue({
      page: Number(page),
      limit: Math.min(Number(limit), PAGINATION.MAX_LIMIT),
      status,
      documentType,
      search,
      dateFrom,
      dateTo,
      confidence,
    });

    return res.status(200).json(
      paginated('Verification queue retrieved.', result.verifications, {
        page: result.page,
        limit: result.limit,
        total: result.total,
      })
    );
  } catch (err) {
    next(err);
  }
}

// ── GET /api/verification/:requestId ─────────────────────────────────────────
async function getVerificationDetail(req, res, next) {
  try {
    const detail = await verificationService.getVerificationDetail(req.params.requestId);
    return res.status(200).json(success('Verification detail retrieved.', detail));
  } catch (err) {
    next(err);
  }
}

// ── POST /api/verification/:requestId/update-field ───────────────────────────
async function updateField(req, res, next) {
  try {
    const { fieldPath, verifiedValue, reason } = req.body;

    const verification = await verificationService.updateField(req.params.requestId, {
      fieldPath,
      verifiedValue,
      reason,
      changedBy: req.user._id,
      changedByName: req.user.name,
    });

    await auditService.log({
      action: AUDIT_ACTIONS.FIELD_CORRECTED,
      entityType: ENTITY_TYPES.VERIFICATION,
      entityId: verification._id.toString(),
      requestId: req.params.requestId,
      userId: req.user._id,
      userEmail: req.user.email,
      role: req.user.role,
      metadata: { fieldPath, reason },
      req,
    });

    return res.status(200).json(
      success('Field updated successfully.', {
        verification: {
          _id: verification._id,
          requestId: verification.requestId,
          status: verification.status,
          fieldChanges: verification.fieldChanges,
          verifiedSnapshot: verification.verifiedSnapshot,
        },
      })
    );
  } catch (err) {
    next(err);
  }
}

// ── POST /api/verification/:requestId/verify ──────────────────────────────────
async function markVerified(req, res, next) {
  try {
    const { remarks } = req.body;

    const verification = await verificationService.markVerified(req.params.requestId, {
      verifiedBy: req.user._id,
      verifiedByName: req.user.name,
      remarks,
    });

    // Register verification hash on blockchain
    try {
      const bcResult = await blockchainService.recordVerification(
        verification.verifiedSnapshotHash,
        req.params.requestId
      );
      await verification.updateOne({
        blockchainTxHash: bcResult.txHash,
        blockchainTimestamp: bcResult.timestamp,
      });
    } catch (bcErr) {
      logger.warn('Blockchain verification recording failed (non-fatal)', { error: bcErr.message });
    }

    await auditService.log({
      action: AUDIT_ACTIONS.VERIFICATION_COMPLETED,
      entityType: ENTITY_TYPES.VERIFICATION,
      entityId: verification._id.toString(),
      requestId: req.params.requestId,
      userId: req.user._id,
      userEmail: req.user.email,
      role: req.user.role,
      newState: {
        status: verification.status,
        verifiedSnapshotHash: verification.verifiedSnapshotHash,
        fieldChangeCount: verification.fieldChanges?.length || 0,
      },
      req,
    });

    // After verification, create Level 1 approval for District Authority
    try {
      const approvalService = require('../services/approvalService');
      const landService = require('../services/landService');
      const landRecord = await landService.getRecord(req.params.requestId);
      await approvalService.createApproval({
        requestId: req.params.requestId,
        landRecordId: landRecord._id,
        verificationId: verification._id,
        authority: 'DISTRICT_AUTHORITY',
        approvalLevel: 1,
      });
      await landService.transitionStatus(
        req.params.requestId,
        ACQUISITION_STATUS.DISTRICT_APPROVAL,
        req.user._id,
        'Verification completed, forwarded to District Authority'
      );
    } catch (approvalErr) {
      logger.error('Failed to create approval after verification', { error: approvalErr.message });
    }

    return res.status(200).json(
      success('Record marked as verified.', {
        verification: {
          _id: verification._id,
          status: verification.status,
          verifiedAt: verification.verifiedAt,
          verifiedSnapshotHash: verification.verifiedSnapshotHash,
          fieldChangeCount: verification.fieldChanges?.length || 0,
        },
      })
    );
  } catch (err) {
    next(err);
  }
}

// ── POST /api/verification/:requestId/incomplete ──────────────────────────────
async function markIncomplete(req, res, next) {
  try {
    const { remarks } = req.body;

    if (!remarks || !remarks.trim()) {
      return res.status(400).json(
        error('Remarks are required when marking incomplete.', { code: 'VALIDATION_ERROR' }, 400)
      );
    }

    const verification = await verificationService.markIncomplete(req.params.requestId, {
      verifiedBy: req.user._id,
      verifiedByName: req.user.name,
      remarks,
    });

    await auditService.log({
      action: AUDIT_ACTIONS.VERIFICATION_MARKED_INCOMPLETE,
      entityType: ENTITY_TYPES.VERIFICATION,
      entityId: verification._id.toString(),
      requestId: req.params.requestId,
      userId: req.user._id,
      userEmail: req.user.email,
      role: req.user.role,
      metadata: { remarks },
      req,
    });

    return res.status(200).json(
      success('Record marked as incomplete. Please re-submit after correction.', {
        verification: {
          _id: verification._id,
          status: verification.status,
          remarks: verification.remarks,
        },
      })
    );
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getQueue,
  getVerificationDetail,
  updateField,
  markVerified,
  markIncomplete,
};
