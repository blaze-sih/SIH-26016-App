/**
 * LRVS — Approval Service
 * Team BLAZE | SIH26016
 *
 * Manages the multi-level approval workflow for land acquisition records.
 * Coordinates between Approval records, LandRecord status transitions,
 * and approval hash integrity.
 */

'use strict';

const Approval = require('../models/Approval');
const LandRecord = require('../models/LandRecord');
const Verification = require('../models/Verification');
const { APPROVAL_ACTION, ACQUISITION_STATUS } = require('../utils/constants');
const { assertValidTransition } = require('../utils/statusTransitions');
const { hashObject } = require('../utils/hash');
const logger = require('../utils/logger');

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build a case-insensitive regex filter for string fields.
 * @param {string} term
 * @param {string[]} fields
 * @returns {object[]}
 */
function _buildSearchOr(term, fields) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escaped, 'i');
  return fields.map((f) => ({ [f]: regex }));
}

// ── Service Functions ─────────────────────────────────────────────────────────

/**
 * Get the pending approval queue with optional filters and pagination.
 *
 * @param {object} opts
 * @param {number} [opts.page=1]
 * @param {number} [opts.limit=10]
 * @param {string} [opts.action]       Override the default PENDING filter
 * @param {string} [opts.district]     Post-populate filter by district
 * @param {string} [opts.state]        Post-populate filter by state
 * @param {string} [opts.search]       Free-text search on requestId
 * @returns {Promise<{ approvals: object[], total: number, page: number, limit: number }>}
 */
async function getQueue({ page = 1, limit = 10, action, district, state, search, authority, approvalLevel } = {}) {
  try {
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    const filter = {
      action: action || APPROVAL_ACTION.PENDING,
    };

    if (authority) {
      filter.authority = authority;
    }
    if (approvalLevel) {
      filter.approvalLevel = Number(approvalLevel);
    }

    if (search && search.trim()) {
      filter.$or = _buildSearchOr(search.trim(), ['requestId']);
    }

    const [approvals, total] = await Promise.all([
      Approval.find(filter)
        .populate({
          path: 'landRecordId',
          select:
            'requestId district village surveyNumber acquisitionStatus owners state projectId projectName',
        })
        .populate({
          path: 'verificationId',
          select: 'status verifiedBy verifiedByName verifiedAt',
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean({ virtuals: true }),
      Approval.countDocuments(filter),
    ]);

    // Post-populate client-side filtering by district / state
    let filtered = approvals;
    if (district) {
      filtered = filtered.filter(
        (a) =>
          a.landRecordId &&
          typeof a.landRecordId.district === 'string' &&
          a.landRecordId.district.toLowerCase() === district.toLowerCase()
      );
    }
    if (state) {
      filtered = filtered.filter(
        (a) =>
          a.landRecordId &&
          typeof a.landRecordId.state === 'string' &&
          a.landRecordId.state.toLowerCase() === state.toLowerCase()
      );
    }

    logger.debug('[approvalService.getQueue] queried', { page: pageNum, limit: limitNum, total });

    return { approvals: filtered, total, page: pageNum, limit: limitNum };
  } catch (err) {
    logger.error('[approvalService.getQueue] Error', { error: err.message });
    throw err;
  }
}

/**
 * Fetch a single Approval document by its _id with full populations.
 *
 * @param {string} approvalId  MongoDB ObjectId string
 * @returns {Promise<object>}
 * @throws {{ statusCode: 404 }} if not found
 */
async function getApproval(approvalId) {
  try {
    const approval = await Approval.findById(approvalId)
      .populate('landRecordId')
      .populate('verificationId')
      .populate('reviewer', 'name email role')
      .populate('forwardedTo', 'name email role')
      .lean({ virtuals: true });

    if (!approval) {
      const err = new Error(`Approval not found: ${approvalId}`);
      err.statusCode = 404;
      err.code = 'APPROVAL_NOT_FOUND';
      throw err;
    }

    return approval;
  } catch (err) {
    logger.error('[approvalService.getApproval] Error', { approvalId, error: err.message });
    throw err;
  }
}

/**
 * Fetch the most recent Approval for a given requestId.
 *
 * @param {string} requestId
 * @returns {Promise<object|null>}
 */
async function getApprovalByRequestId(requestId) {
  try {
    const approval = await Approval.findOne({ requestId })
      .sort({ createdAt: -1 })
      .populate({
        path: 'landRecordId',
        select: 'requestId district village surveyNumber acquisitionStatus owners',
      })
      .lean({ virtuals: true });

    return approval;
  } catch (err) {
    logger.error('[approvalService.getApprovalByRequestId] Error', {
      requestId,
      error: err.message,
    });
    throw err;
  }
}

/**
 * Create a new Approval entry (called after verification is completed).
 *
 * @param {object} opts
 * @param {string} opts.requestId
 * @param {mongoose.Types.ObjectId|string} opts.landRecordId
 * @param {mongoose.Types.ObjectId|string} [opts.verificationId]
 * @param {string} [opts.authority]       e.g. 'DISTRICT_AUTHORITY'
 * @param {number} [opts.approvalLevel]   1=District, 2=State, 3=Central
 * @returns {Promise<object>}
 */
async function createApproval({ requestId, landRecordId, verificationId, authority, approvalLevel }) {
  try {
    const approval = new Approval({
      requestId,
      landRecordId,
      verificationId: verificationId || undefined,
      authority: authority || 'DISTRICT_AUTHORITY',
      approvalLevel: approvalLevel || 1,
      action: APPROVAL_ACTION.PENDING,
    });

    await approval.save();

    logger.info('[approvalService.createApproval] Approval created', {
      approvalId: approval._id,
      requestId,
      authority,
      approvalLevel,
    });

    return approval.toObject({ virtuals: true });
  } catch (err) {
    logger.error('[approvalService.createApproval] Error', { requestId, error: err.message });
    throw err;
  }
}

/**
 * Approve a pending approval and transition the associated LandRecord to APPROVED.
 *
 * @param {string} approvalId
 * @param {object} opts
 * @param {string|mongoose.Types.ObjectId} opts.reviewer
 * @param {string} opts.reviewerName
 * @param {string} [opts.remarks]
 * @returns {Promise<object>}
 */
async function approve(approvalId, { reviewer, reviewerName, reviewerRole, remarks } = {}) {
  try {
    const approval = await Approval.findById(approvalId);
    if (!approval) {
      const err = new Error(`Approval not found: ${approvalId}`);
      err.statusCode = 404;
      err.code = 'APPROVAL_NOT_FOUND';
      throw err;
    }

    if (approval.action !== APPROVAL_ACTION.PENDING) {
      const err = new Error(
        `Approval ${approvalId} is not PENDING (current action: ${approval.action})`
      );
      err.statusCode = 409;
      err.code = 'APPROVAL_NOT_PENDING';
      throw err;
    }

    // Enforce Authority Authorization (P0 requirement 2)
    const allowedRoleForLevel = {
      1: 'DISTRICT_AUTHORITY',
      2: 'STATE_AUTHORITY',
      3: 'CENTRAL_AUTHORITY',
    };
    const requiredRole = allowedRoleForLevel[approval.approvalLevel] || approval.authority;

    if (reviewerRole && reviewerRole !== 'SUPER_ADMIN' && reviewerRole !== requiredRole) {
      const err = new Error(
        `Unauthorized: Role ${reviewerRole} cannot act on ${requiredRole} approval (Level ${approval.approvalLevel}).`
      );
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const landRecord = await LandRecord.findById(approval.landRecordId);
    if (!landRecord) {
      const err = new Error(`LandRecord not found for approval ${approvalId}`);
      err.statusCode = 404;
      err.code = 'LAND_RECORD_NOT_FOUND';
      throw err;
    }

    // Determine next status and forwarding chain
    let newStatus;
    let nextAuthority = null;
    let nextLevel = null;

    if (approval.approvalLevel === 1) {
      // District Approval -> transitions to STATE_APPROVAL, forwards to State
      newStatus = ACQUISITION_STATUS.STATE_APPROVAL;
      nextAuthority = 'STATE_AUTHORITY';
      nextLevel = 2;
    } else if (approval.approvalLevel === 2) {
      // State Approval -> transitions to CENTRAL_APPROVAL, forwards to Central
      newStatus = ACQUISITION_STATUS.CENTRAL_APPROVAL;
      nextAuthority = 'CENTRAL_AUTHORITY';
      nextLevel = 3;
    } else {
      // Central Approval (Level 3) -> Final APPROVED
      newStatus = ACQUISITION_STATUS.APPROVED;
    }

    const previousStatus = landRecord.acquisitionStatus;
    assertValidTransition(previousStatus, newStatus);

    const now = new Date();
    const approvalHash = hashObject({
      approvalId: approval._id.toString(),
      requestId: approval.requestId,
      action: APPROVAL_ACTION.APPROVED,
      level: approval.approvalLevel,
      timestamp: now.toISOString(),
    });

    approval.action = APPROVAL_ACTION.APPROVED;
    approval.reviewer = reviewer;
    approval.reviewerName = reviewerName;
    approval.reviewedAt = now;
    approval.remarks = remarks || (approval.approvalLevel === 3 ? 'Final central approval granted' : `Approved at Level ${approval.approvalLevel} and forwarded to ${nextAuthority}`);
    approval.previousStatus = previousStatus;
    approval.newStatus = newStatus;
    approval.approvalHash = approvalHash;

    landRecord.acquisitionStatus = newStatus;
    landRecord.currentAuthority = nextAuthority || 'CENTRAL_MINISTRY';
    if (newStatus === ACQUISITION_STATUS.APPROVED) {
      landRecord.compensationStatus = 'PENDING';
    }

    landRecord.statusHistory.push({
      status: newStatus,
      changedBy: reviewer,
      changedAt: now,
      remarks: remarks || `Approved by ${approval.authority}`,
    });

    await Promise.all([approval.save(), landRecord.save()]);

    // Automatically create next level approval if not final
    if (nextAuthority && nextLevel) {
      await createApproval({
        requestId: approval.requestId,
        landRecordId: approval.landRecordId,
        verificationId: approval.verificationId,
        authority: nextAuthority,
        approvalLevel: nextLevel,
      });
    }

    logger.info('[approvalService.approve] Approval processed', {
      approvalId,
      level: approval.approvalLevel,
      requestId: approval.requestId,
      reviewer,
      previousStatus,
      newStatus,
    });

    return approval.toObject({ virtuals: true });
  } catch (err) {
    logger.error('[approvalService.approve] Error', { approvalId, error: err.message });
    throw err;
  }
}

/**
 * Reject a pending approval and transition the associated LandRecord to REJECTED.
 * Remarks are mandatory for rejections.
 */
async function reject(approvalId, { reviewer, reviewerName, reviewerRole, remarks } = {}) {
  try {
    if (!remarks || !remarks.trim()) {
      const err = new Error('Remarks are required when rejecting an approval.');
      err.statusCode = 400;
      err.code = 'REMARKS_REQUIRED';
      throw err;
    }

    const approval = await Approval.findById(approvalId);
    if (!approval) {
      const err = new Error(`Approval not found: ${approvalId}`);
      err.statusCode = 404;
      err.code = 'APPROVAL_NOT_FOUND';
      throw err;
    }

    if (approval.action !== APPROVAL_ACTION.PENDING) {
      const err = new Error(
        `Approval ${approvalId} is not PENDING (current action: ${approval.action})`
      );
      err.statusCode = 409;
      err.code = 'APPROVAL_NOT_PENDING';
      throw err;
    }

    const allowedRoleForLevel = {
      1: 'DISTRICT_AUTHORITY',
      2: 'STATE_AUTHORITY',
      3: 'CENTRAL_AUTHORITY',
    };
    const requiredRole = allowedRoleForLevel[approval.approvalLevel] || approval.authority;

    if (reviewerRole && reviewerRole !== 'SUPER_ADMIN' && reviewerRole !== requiredRole) {
      const err = new Error(
        `Unauthorized: Role ${reviewerRole} cannot reject ${requiredRole} approval (Level ${approval.approvalLevel}).`
      );
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const landRecord = await LandRecord.findById(approval.landRecordId);
    if (!landRecord) {
      const err = new Error(`LandRecord not found for approval ${approvalId}`);
      err.statusCode = 404;
      err.code = 'LAND_RECORD_NOT_FOUND';
      throw err;
    }

    const previousStatus = landRecord.acquisitionStatus;
    const newStatus = ACQUISITION_STATUS.REJECTED;

    assertValidTransition(previousStatus, newStatus);

    const now = new Date();
    const approvalHash = hashObject({
      approvalId: approval._id.toString(),
      requestId: approval.requestId,
      action: APPROVAL_ACTION.REJECTED,
      timestamp: now.toISOString(),
    });

    approval.action = APPROVAL_ACTION.REJECTED;
    approval.reviewer = reviewer;
    approval.reviewerName = reviewerName;
    approval.reviewedAt = now;
    approval.remarks = remarks.trim();
    approval.previousStatus = previousStatus;
    approval.newStatus = newStatus;
    approval.approvalHash = approvalHash;

    landRecord.acquisitionStatus = newStatus;
    landRecord.statusHistory.push({
      status: newStatus,
      changedBy: reviewer,
      changedAt: now,
      remarks: remarks.trim(),
    });

    await Promise.all([approval.save(), landRecord.save()]);

    logger.info('[approvalService.reject] Approval rejected', {
      approvalId,
      requestId: approval.requestId,
      reviewer,
      previousStatus,
      newStatus,
    });

    return approval.toObject({ virtuals: true });
  } catch (err) {
    logger.error('[approvalService.reject] Error', { approvalId, error: err.message });
    throw err;
  }
}

/**
 * Forward an approval to a higher authority and create a new Approval for that level.
 */
async function forward(approvalId, { reviewer, reviewerName, reviewerRole, forwardedTo, forwardedToAuthority, remarks } = {}) {
  try {
    const approval = await Approval.findById(approvalId);
    if (!approval) {
      const err = new Error(`Approval not found: ${approvalId}`);
      err.statusCode = 404;
      err.code = 'APPROVAL_NOT_FOUND';
      throw err;
    }

    if (approval.action !== APPROVAL_ACTION.PENDING) {
      const err = new Error(
        `Approval ${approvalId} is not PENDING (current action: ${approval.action})`
      );
      err.statusCode = 409;
      err.code = 'APPROVAL_NOT_PENDING';
      throw err;
    }

    const allowedRoleForLevel = {
      1: 'DISTRICT_AUTHORITY',
      2: 'STATE_AUTHORITY',
      3: 'CENTRAL_AUTHORITY',
    };
    const requiredRole = allowedRoleForLevel[approval.approvalLevel] || approval.authority;

    if (reviewerRole && reviewerRole !== 'SUPER_ADMIN' && reviewerRole !== requiredRole) {
      const err = new Error(
        `Unauthorized: Role ${reviewerRole} cannot act on ${requiredRole} approval (Level ${approval.approvalLevel}).`
      );
      err.statusCode = 403;
      err.code = 'FORBIDDEN';
      throw err;
    }

    const landRecord = await LandRecord.findById(approval.landRecordId);
    if (!landRecord) {
      const err = new Error(`LandRecord not found for approval ${approvalId}`);
      err.statusCode = 404;
      err.code = 'LAND_RECORD_NOT_FOUND';
      throw err;
    }

    const targetAuthority = forwardedToAuthority || (approval.approvalLevel === 1 ? 'STATE_AUTHORITY' : 'CENTRAL_AUTHORITY');
    const targetLevel = (approval.approvalLevel || 1) + 1;
    const newStatus = targetLevel === 2 ? ACQUISITION_STATUS.STATE_APPROVAL : ACQUISITION_STATUS.CENTRAL_APPROVAL;

    const previousStatus = landRecord.acquisitionStatus;
    assertValidTransition(previousStatus, newStatus);

    const now = new Date();
    approval.action = APPROVAL_ACTION.FORWARDED;
    approval.reviewer = reviewer;
    approval.reviewerName = reviewerName;
    approval.reviewedAt = now;
    approval.remarks = remarks || `Forwarded to ${targetAuthority}`;
    approval.forwardedTo = forwardedTo;
    approval.forwardedToAuthority = targetAuthority;
    approval.previousStatus = previousStatus;
    approval.newStatus = newStatus;

    landRecord.acquisitionStatus = newStatus;
    landRecord.currentAuthority = targetAuthority;
    landRecord.statusHistory.push({
      status: newStatus,
      changedBy: reviewer,
      changedAt: now,
      remarks: remarks || `Forwarded to ${targetAuthority}`,
    });

    await Promise.all([approval.save(), landRecord.save()]);

    const nextApproval = await createApproval({
      requestId: approval.requestId,
      landRecordId: approval.landRecordId,
      verificationId: approval.verificationId,
      authority: targetAuthority,
      approvalLevel: targetLevel,
    });

    logger.info('[approvalService.forward] Approval forwarded', {
      approvalId,
      requestId: approval.requestId,
      targetAuthority,
      newApprovalId: nextApproval._id,
    });

    return nextApproval;
  } catch (err) {
    logger.error('[approvalService.forward] Error', { approvalId, error: err.message });
    throw err;
  }
}

/**
 * Aggregate approval counts grouped by action.
 *
 * @returns {Promise<{ pending: number, approved: number, rejected: number, forwarded: number, total: number }>}
 */
async function getApprovalStats() {
  try {
    const results = await Approval.aggregate([
      {
        $group: {
          _id: '$action',
          count: { $sum: 1 },
        },
      },
    ]);

    const stats = { pending: 0, approved: 0, rejected: 0, forwarded: 0, total: 0 };

    for (const row of results) {
      const key = (row._id || '').toLowerCase();
      if (key in stats) {
        stats[key] = row.count;
      }
      stats.total += row.count;
    }

    logger.debug('[approvalService.getApprovalStats] Stats computed', stats);
    return stats;
  } catch (err) {
    logger.error('[approvalService.getApprovalStats] Error', { error: err.message });
    throw err;
  }
}

module.exports = {
  getQueue,
  getApproval,
  getApprovalByRequestId,
  createApproval,
  approve,
  reject,
  forward,
  getApprovalStats,
};
