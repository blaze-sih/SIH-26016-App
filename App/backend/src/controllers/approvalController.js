/**
 * LRVS — Approval Controller
 * Team BLAZE | SIH26016
 */

'use strict';

const approvalService = require('../services/approvalService');
const blockchainService = require('../services/blockchainService');
const auditService = require('../services/auditService');
const { success, error, paginated } = require('../utils/apiResponse');
const { AUDIT_ACTIONS, ENTITY_TYPES, PAGINATION } = require('../utils/constants');
const logger = require('../utils/logger');

// ── GET /api/approvals/queue ──────────────────────────────────────────────────
async function getQueue(req, res, next) {
  try {
    const {
      page = PAGINATION.DEFAULT_PAGE,
      limit = PAGINATION.DEFAULT_LIMIT,
      action,
      district,
      state,
      search,
    } = req.query;

    const result = await approvalService.getQueue({
      page: Number(page),
      limit: Math.min(Number(limit), PAGINATION.MAX_LIMIT),
      action,
      district,
      state,
      search,
    });

    return res.status(200).json(
      paginated('Approval queue retrieved.', result.approvals, {
        page: result.page,
        limit: result.limit,
        total: result.total,
      })
    );
  } catch (err) {
    next(err);
  }
}

// ── GET /api/approvals/stats ──────────────────────────────────────────────────
async function getStats(req, res, next) {
  try {
    const stats = await approvalService.getApprovalStats();
    return res.status(200).json(success('Approval stats retrieved.', { stats }));
  } catch (err) {
    next(err);
  }
}

// ── GET /api/approvals/:id ────────────────────────────────────────────────────
async function getApproval(req, res, next) {
  try {
    const approval = await approvalService.getApproval(req.params.id);
    return res.status(200).json(success('Approval retrieved.', { approval }));
  } catch (err) {
    next(err);
  }
}

// ── POST /api/approvals/:id/approve ──────────────────────────────────────────
async function approve(req, res, next) {
  try {
    const { remarks } = req.body;
    const approval = await approvalService.approve(req.params.id, {
      reviewer: req.user._id,
      reviewerName: req.user.name,
      reviewerRole: req.user.role,
      remarks,
    });

    // Register approval hash on blockchain
    try {
      const bcResult = await blockchainService.recordApproval(
        approval.approvalHash,
        approval.requestId,
        'APPROVED'
      );
      await approval.updateOne({
        blockchainTxHash: bcResult.txHash,
        blockchainBlockNumber: bcResult.blockNumber,
        blockchainTimestamp: bcResult.timestamp,
      });
    } catch (bcErr) {
      logger.warn('Blockchain approval recording failed (non-fatal)', { error: bcErr.message });
    }

    await auditService.log({
      action: AUDIT_ACTIONS.APPROVAL_GRANTED,
      entityType: ENTITY_TYPES.APPROVAL,
      entityId: approval._id.toString(),
      requestId: approval.requestId,
      userId: req.user._id,
      userEmail: req.user.email,
      role: req.user.role,
      previousState: { status: approval.previousStatus },
      newState: { status: approval.newStatus, approvalHash: approval.approvalHash },
      req,
    });

    logger.info('Approval granted', { approvalId: approval._id, requestId: approval.requestId });

    return res.status(200).json(success('Request approved successfully.', { approval }));
  } catch (err) {
    next(err);
  }
}

// ── POST /api/approvals/:id/reject ────────────────────────────────────────────
async function reject(req, res, next) {
  try {
    const { remarks } = req.body;

    if (!remarks || !remarks.trim()) {
      return res.status(400).json(
        error('Remarks are required when rejecting.', { code: 'VALIDATION_ERROR' }, 400)
      );
    }

    const approval = await approvalService.reject(req.params.id, {
      reviewer: req.user._id,
      reviewerName: req.user.name,
      reviewerRole: req.user.role,
      remarks,
    });

    await auditService.log({
      action: AUDIT_ACTIONS.APPROVAL_REJECTED,
      entityType: ENTITY_TYPES.APPROVAL,
      entityId: approval._id.toString(),
      requestId: approval.requestId,
      userId: req.user._id,
      userEmail: req.user.email,
      role: req.user.role,
      previousState: { status: approval.previousStatus },
      newState: { status: approval.newStatus },
      metadata: { remarks },
      req,
    });

    return res.status(200).json(success('Request rejected.', { approval }));
  } catch (err) {
    next(err);
  }
}

// ── POST /api/approvals/:id/forward ──────────────────────────────────────────
async function forward(req, res, next) {
  try {
    const { forwardedTo, forwardedToAuthority, remarks } = req.body;

    const result = await approvalService.forward(req.params.id, {
      reviewer: req.user._id,
      reviewerName: req.user.name,
      reviewerRole: req.user.role,
      forwardedTo,
      forwardedToAuthority,
      remarks,
    });

    await auditService.log({
      action: AUDIT_ACTIONS.APPROVAL_FORWARDED,
      entityType: ENTITY_TYPES.APPROVAL,
      entityId: req.params.id,
      requestId: result.requestId,
      userId: req.user._id,
      userEmail: req.user.email,
      role: req.user.role,
      metadata: { forwardedToAuthority },
      req,
    });

    return res.status(200).json(success('Request forwarded.', { approval: result }));
  } catch (err) {
    next(err);
  }
}

module.exports = { getQueue, getStats, getApproval, approve, reject, forward };
