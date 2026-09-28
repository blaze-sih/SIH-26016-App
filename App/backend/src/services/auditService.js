/**
 * LRVS — Audit Trail Service
 * Team BLAZE | SIH26016
 *
 * Provides append-only audit logging across the application.
 * The `log()` function NEVER throws — it catches its own errors so that
 * a failed audit write never disrupts the caller's main flow.
 */

'use strict';

const AuditLog = require('../models/AuditLog');
const { AUDIT_ACTIONS, ENTITY_TYPES } = require('../utils/constants');
const logger = require('../utils/logger');

/**
 * Write one audit log entry.
 *
 * @param {object} params
 * @param {string} params.action        - One of AUDIT_ACTIONS values
 * @param {string} params.entityType    - One of ENTITY_TYPES values
 * @param {string} params.entityId      - Mongoose _id or UUID string of the entity
 * @param {string} [params.requestId]   - Acquisition request UUID
 * @param {*}      [params.userId]      - Mongoose ObjectId of the acting user
 * @param {string} [params.userEmail]   - Email of the acting user
 * @param {string} [params.role]        - Role of the acting user
 * @param {*}      [params.previousState] - State before the action (snapshot)
 * @param {*}      [params.newState]      - State after the action (snapshot)
 * @param {object} [params.metadata]    - Any additional context
 * @param {object} [params.req]         - Express request object (for IP / UA)
 * @returns {Promise<object|null>} Saved AuditLog document, or null on failure
 */
async function log({
  action,
  entityType,
  entityId,
  targetType,
  targetId,
  requestId,
  userId,
  userEmail,
  role,
  userRole,
  previousState = null,
  newState = null,
  metadata = {},
  details,
  req,
} = {}) {
  try {
    const ipAddress = req ? (req.ip || null) : null;
    const userAgent = req ? (req.headers && req.headers['user-agent']) || null : null;

    const resolvedEntityType = entityType || targetType || 'LAND_RECORD';
    const resolvedEntityId = String(entityId || targetId || 'system');
    const resolvedRole = role || userRole || null;
    const resolvedMetadata = metadata && Object.keys(metadata).length > 0 ? metadata : (details || {});

    const auditLog = new AuditLog({
      action,
      entityType: resolvedEntityType,
      entityId: resolvedEntityId,
      requestId,
      userId,
      userEmail,
      role: resolvedRole,
      previousState,
      newState,
      metadata: resolvedMetadata,
      ipAddress,
      userAgent,
      timestamp: new Date(),
    });

    await auditLog.save();

    logger.debug('Audit log written', {
      action,
      entityType,
      entityId: String(entityId),
      requestId,
    });

    return auditLog;
  } catch (err) {
    // Audit must never break the main request flow — log and swallow.
    logger.error('auditService.log: failed to write audit record', {
      action,
      entityType,
      entityId: String(entityId),
      requestId,
      error: err.message,
    });
    return null;
  }
}

/**
 * Retrieve paginated audit logs for a given acquisition request.
 *
 * @param {string} requestId
 * @param {object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.limit=20]
 * @returns {Promise<{ logs: object[], total: number, page: number, limit: number }>}
 */
async function getAuditTrail(requestId, { page = 1, limit = 20 } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (safePage - 1) * safeLimit;

  const [logs, total] = await Promise.all([
    AuditLog.find({ requestId })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    AuditLog.countDocuments({ requestId }),
  ]);

  return {
    logs,
    total,
    page: safePage,
    limit: safeLimit,
  };
}

/**
 * Retrieve the full chronological history of all audit entries for one entity.
 *
 * @param {string} entityType - One of ENTITY_TYPES values
 * @param {string} entityId   - The entity identifier
 * @returns {Promise<object[]>}
 */
async function getEntityHistory(entityType, entityId) {
  const logs = await AuditLog.find({
    entityType,
    entityId: String(entityId),
  })
    .sort({ timestamp: 1 })
    .lean();

  return logs;
}

module.exports = {
  log,
  getAuditTrail,
  getEntityHistory,
  // Re-export constants for convenience
  AUDIT_ACTIONS,
  ENTITY_TYPES,
};
