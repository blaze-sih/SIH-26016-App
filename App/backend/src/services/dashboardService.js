/**
 * LRVS — Dashboard Service
 * Team BLAZE | SIH26016
 *
 * MongoDB aggregation-based analytics for the admin dashboard.
 * All queries are read-only and do not mutate any records.
 */

'use strict';

const LandRecord = require('../models/LandRecord');
const Verification = require('../models/Verification');
const Approval = require('../models/Approval');
const Compensation = require('../models/Compensation');
const AuditLog = require('../models/AuditLog');
const { ACQUISITION_STATUS, VERIFICATION_STATUS } = require('../utils/constants');

const S = ACQUISITION_STATUS;

// ── Status groups used across multiple aggregations ───────────────────────────
const PENDING_STATUSES = [
  S.SUBMITTED,
  S.AI_PROCESSING,
  S.AI_PROCESSED,
  S.PENDING_VERIFICATION,
  S.PENDING_APPROVAL,
];

const IN_REVIEW_STATUSES = [S.VERIFICATION_INCOMPLETE, S.PENDING_VERIFICATION];

const POST_APPROVAL_STATUSES = [
  S.COMPENSATION_PAID,
  S.POSSESSION_PENDING,
  S.POSSESSION_COMPLETED,
  S.CLOSED,
];

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build a MongoDB match stage from dashboard filter options.
 * @param {object} filters
 * @returns {object} $match stage expression
 */
function _buildMatchStage(filters = {}) {
  const match = {};

  if (filters.state) match.state = filters.state;
  if (filters.district) match.district = filters.district;
  if (filters.projectId) match.projectId = filters.projectId;

  if (filters.dateFrom || filters.dateTo) {
    match.createdAt = {};
    if (filters.dateFrom) match.createdAt.$gte = new Date(filters.dateFrom);
    if (filters.dateTo) match.createdAt.$lte = new Date(filters.dateTo);
  }

  return match;
}

// ── Service Functions ─────────────────────────────────────────────────────────

/**
 * Aggregate a high-level summary of the land acquisition system.
 *
 * @param {object} [filters={}]
 * @param {string} [filters.state]
 * @param {string} [filters.district]
 * @param {string} [filters.projectId]
 * @param {string|Date} [filters.dateFrom]
 * @param {string|Date} [filters.dateTo]
 * @returns {Promise<object>}
 */
async function getSummary(filters = {}) {
  const match = _buildMatchStage(filters);

  let compMatch = {};
  if (Object.keys(match).length > 0) {
    const matchingIds = await LandRecord.find(match).distinct('_id');
    compMatch = { landRecordId: { $in: matchingIds } };
  }

  const [landAgg, compAgg] = await Promise.all([
    LandRecord.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pendingRequests: {
            $sum: { $cond: [{ $in: ['$acquisitionStatus', PENDING_STATUSES] }, 1, 0] },
          },
          inReview: {
            $sum: { $cond: [{ $in: ['$acquisitionStatus', IN_REVIEW_STATUSES] }, 1, 0] },
          },
          approved: {
            $sum: {
              $cond: [
                {
                  $in: [
                    '$acquisitionStatus',
                    [
                      S.APPROVED,
                      S.COMPENSATION_PENDING,
                      S.COMPENSATION_APPROVED,
                      S.COMPENSATION_PAID,
                      S.POSSESSION_PENDING,
                      S.POSSESSION_COMPLETED,
                      S.CLOSED,
                    ],
                  ],
                },
                1,
                0,
              ],
            },
          },
          rejected: {
            $sum: { $cond: [{ $eq: ['$acquisitionStatus', S.REJECTED] }, 1, 0] },
          },
          possessionCompleted: {
            $sum: {
              $cond: [
                { $in: ['$acquisitionStatus', [S.POSSESSION_COMPLETED, S.CLOSED]] },
                1,
                0,
              ],
            },
          },
          totalLandProposed: {
            $sum: { $ifNull: ['$area.totalNumeric', 0] },
          },
          totalLandAcquired: {
            $sum: {
              $cond: [
                { $in: ['$acquisitionStatus', POST_APPROVAL_STATUSES] },
                { $ifNull: ['$area.totalNumeric', 0] },
                0,
              ],
            },
          },
          affectedFamilies: { $sum: { $ifNull: ['$affectedFamilies', 0] } },
          displacedFamilies: { $sum: { $ifNull: ['$displacedFamilies', 0] } },
        },
      },
    ]),
    Compensation.aggregate([
      ...(Object.keys(compMatch).length > 0 ? [{ $match: compMatch }] : []),
      {
        $facet: {
          compensationAssessed: [
            { $group: { _id: null, total: { $sum: '$assessedAmount' } } },
          ],
          compensationPaid: [
            { $match: { paymentStatus: 'PAID' } },
            { $group: { _id: null, total: { $sum: '$approvedAmount' } } },
          ],
        },
      },
    ]),
  ]);

  const land = landAgg[0] || {
    total: 0,
    pendingRequests: 0,
    inReview: 0,
    approved: 0,
    rejected: 0,
    possessionCompleted: 0,
    totalLandProposed: 0,
    totalLandAcquired: 0,
    affectedFamilies: 0,
    displacedFamilies: 0,
  };

  const facet = compAgg[0] || {};
  const compensationAssessed =
    facet.compensationAssessed && facet.compensationAssessed[0]
      ? facet.compensationAssessed[0].total || 0
      : 0;
  const compensationPaid =
    facet.compensationPaid && facet.compensationPaid[0]
      ? facet.compensationPaid[0].total || 0
      : 0;

  delete land._id;

  return {
    ...land,
    compensationAssessed,
    compensationPaid,
  };
}

/**
 * Aggregate LandRecord statistics grouped by projectId.
 *
 * @returns {Promise<Array<{ projectId: string, projectName: string, total: number, approved: number, pending: number, rejected: number, totalArea: number }>>}
 */
async function getProjectWise() {
  const results = await LandRecord.aggregate([
    {
      $group: {
        _id: '$projectId',
        projectName: { $first: '$projectName' },
        total: { $sum: 1 },
        approved: {
          $sum: { $cond: [{ $eq: ['$acquisitionStatus', S.APPROVED] }, 1, 0] },
        },
        pending: {
          $sum: { $cond: [{ $in: ['$acquisitionStatus', PENDING_STATUSES] }, 1, 0] },
        },
        rejected: {
          $sum: { $cond: [{ $eq: ['$acquisitionStatus', S.REJECTED] }, 1, 0] },
        },
        totalArea: { $sum: { $ifNull: ['$area.totalNumeric', 0] } },
      },
    },
    { $sort: { total: -1 } },
    {
      $project: {
        _id: 0,
        projectId: '$_id',
        projectName: 1,
        total: 1,
        approved: 1,
        pending: 1,
        rejected: 1,
        totalArea: 1,
      },
    },
  ]);

  return results;
}

/**
 * Aggregate LandRecord statistics grouped by state.
 *
 * @returns {Promise<Array<{ state: string, total: number, approved: number, pending: number, rejected: number }>>}
 */
async function getStateWise() {
  const results = await LandRecord.aggregate([
    {
      $group: {
        _id: '$state',
        total: { $sum: 1 },
        approved: {
          $sum: { $cond: [{ $eq: ['$acquisitionStatus', S.APPROVED] }, 1, 0] },
        },
        pending: {
          $sum: { $cond: [{ $in: ['$acquisitionStatus', PENDING_STATUSES] }, 1, 0] },
        },
        rejected: {
          $sum: { $cond: [{ $eq: ['$acquisitionStatus', S.REJECTED] }, 1, 0] },
        },
      },
    },
    { $sort: { total: -1 } },
    {
      $project: {
        _id: 0,
        state: '$_id',
        total: 1,
        approved: 1,
        pending: 1,
        rejected: 1,
      },
    },
  ]);

  return results;
}

/**
 * Aggregate LandRecord statistics grouped by district, optionally filtered by state.
 *
 * @param {string|object} [stateOrFilters]
 * @returns {Promise<Array<{ district: string, total: number, byStatus: object }>>}
 */
async function getDistrictWise(stateOrFilters) {
  const match = {};
  let state = null;
  if (typeof stateOrFilters === 'string') {
    state = stateOrFilters;
  } else if (stateOrFilters && typeof stateOrFilters === 'object') {
    state = stateOrFilters.state || null;
    if (stateOrFilters.district) match.district = stateOrFilters.district;
  }

  if (state && state !== 'All') match.state = state;

  const allStatuses = Object.values(S);

  // Build $group accumulators for each status
  const statusAccumulators = {};
  for (const status of allStatuses) {
    const safeKey = status.replace(/_/g, '').toLowerCase();
    statusAccumulators[safeKey] = {
      $sum: { $cond: [{ $eq: ['$acquisitionStatus', status] }, 1, 0] },
    };
  }

  const results = await LandRecord.aggregate([
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    {
      $group: {
        _id: '$district',
        total: { $sum: 1 },
        ...statusAccumulators,
      },
    },
    { $sort: { total: -1 } },
    {
      $project: {
        _id: 0,
        district: '$_id',
        total: 1,
        byStatus: {
          ...Object.fromEntries(
            allStatuses.map((status) => [
              status,
              `$${status.replace(/_/g, '').toLowerCase()}`,
            ])
          ),
        },
      },
    },
  ]);

  return results;
}

/**
 * Aggregate LandRecord creation / approval / rejection over time.
 *
 * @param {object} opts
 * @param {'month'|'week'} [opts.groupBy='month']
 * @param {string|Date} [opts.dateFrom]
 * @param {string|Date} [opts.dateTo]
 * @returns {Promise<Array<{ period: string, created: number, approved: number, rejected: number }>>}
 */
async function getTimeline({ groupBy = 'month', dateFrom, dateTo } = {}) {
  const match = {};
  if (dateFrom || dateTo) {
    match.createdAt = {};
    if (dateFrom) match.createdAt.$gte = new Date(dateFrom);
    if (dateTo) match.createdAt.$lte = new Date(dateTo);
  }

  // Date truncation expression
  const dateTrunc =
    groupBy === 'week'
      ? {
          $dateToString: {
            format: '%Y-W%V',
            date: '$createdAt',
          },
        }
      : {
          $dateToString: {
            format: '%Y-%m',
            date: '$createdAt',
          },
        };

  const results = await LandRecord.aggregate([
    ...(Object.keys(match).length ? [{ $match: match }] : []),
    {
      $group: {
        _id: dateTrunc,
        created: { $sum: 1 },
        approved: {
          $sum: { $cond: [{ $eq: ['$acquisitionStatus', S.APPROVED] }, 1, 0] },
        },
        rejected: {
          $sum: { $cond: [{ $eq: ['$acquisitionStatus', S.REJECTED] }, 1, 0] },
        },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        period: '$_id',
        created: 1,
        approved: 1,
        rejected: 1,
      },
    },
  ]);

  return results;
}

/**
 * Aggregate verification activity over a date range.
 *
 * @param {object} opts
 * @param {string|Date} [opts.dateFrom]
 * @param {string|Date} [opts.dateTo]
 * @returns {Promise<{
 *   byDate: Array<{ date: string, count: number }>,
 *   totalVerified: number,
 *   totalIncomplete: number,
 *   totalPending: number,
 *   avgFieldChanges: number
 * }>}
 */
async function getVerificationActivity({ dateFrom, dateTo } = {}) {
  const match = {};
  if (dateFrom || dateTo) {
    match.verifiedAt = {};
    if (dateFrom) match.verifiedAt.$gte = new Date(dateFrom);
    if (dateTo) match.verifiedAt.$lte = new Date(dateTo);
  }

  const [byDate, overall] = await Promise.all([
    Verification.aggregate([
      ...(Object.keys(match).length ? [{ $match: match }] : []),
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$verifiedAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: '$_id', count: 1 } },
    ]),
    Verification.aggregate([
      {
        $group: {
          _id: null,
          totalVerified: {
            $sum: {
              $cond: [{ $eq: ['$status', VERIFICATION_STATUS.VERIFIED] }, 1, 0],
            },
          },
          totalIncomplete: {
            $sum: {
              $cond: [{ $eq: ['$status', VERIFICATION_STATUS.INCOMPLETE] }, 1, 0],
            },
          },
          totalPending: {
            $sum: {
              $cond: [{ $eq: ['$status', VERIFICATION_STATUS.PENDING] }, 1, 0],
            },
          },
          avgFieldChanges: { $avg: { $size: { $ifNull: ['$fieldChanges', []] } } },
        },
      },
    ]),
  ]);

  const stats = overall[0] || {
    totalVerified: 0,
    totalIncomplete: 0,
    totalPending: 0,
    avgFieldChanges: 0,
  };
  delete stats._id;

  return {
    byDate,
    ...stats,
    avgFieldChanges: parseFloat((stats.avgFieldChanges || 0).toFixed(2)),
  };
}

/**
 * Aggregate LandRecord distribution by acquisitionStatus.
 *
 * @returns {Promise<{
 *   pending: number,
 *   inReview: number,
 *   approved: number,
 *   rejected: number,
 *   other: number,
 *   distribution: Array<{ status: string, count: number, percentage: number }>
 * }>}
 */
async function getRequestDistribution() {
  const results = await LandRecord.aggregate([
    {
      $group: {
        _id: '$acquisitionStatus',
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
  ]);

  const total = results.reduce((sum, r) => sum + r.count, 0);

  const distribution = results.map((r) => ({
    status: r._id,
    count: r.count,
    percentage: total > 0 ? parseFloat(((r.count / total) * 100).toFixed(2)) : 0,
  }));

  // Compute named buckets
  const countForStatus = (statuses) =>
    results
      .filter((r) => statuses.includes(r._id))
      .reduce((sum, r) => sum + r.count, 0);

  const pending = countForStatus(PENDING_STATUSES);
  const inReview = countForStatus(IN_REVIEW_STATUSES);
  const approved = countForStatus([
    S.APPROVED,
    S.COMPENSATION_PENDING,
    S.COMPENSATION_APPROVED,
    S.COMPENSATION_PAID,
    S.POSSESSION_PENDING,
    S.POSSESSION_COMPLETED,
    S.CLOSED,
  ]);
  const rejected = countForStatus([S.REJECTED]);
  const other = total - pending - approved - rejected;

  return {
    pending,
    inReview,
    approved,
    rejected,
    other: Math.max(0, other),
    distribution,
  };
}

module.exports = {
  getSummary,
  getProjectWise,
  getStateWise,
  getDistrictWise,
  getTimeline,
  getVerificationActivity,
  getRequestDistribution,
};
