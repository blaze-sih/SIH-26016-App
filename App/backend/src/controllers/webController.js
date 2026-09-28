/**
 * LRVS — Web Controller
 * Team BLAZE | SIH26016
 *
 * Handles all browser EJS page rendering.
 * Each function: authenticate via middleware → fetch data → res.render(view, data)
 */

'use strict';

const dashboardService = require('../services/dashboardService');
const landService = require('../services/landService');
const verificationService = require('../services/verificationService');
const approvalService = require('../services/approvalService');
const compensationService = require('../services/compensationService');
const auditService = require('../services/auditService');
const User = require('../models/User');
const LandRecord = require('../models/LandRecord');
const AuditLog = require('../models/AuditLog');
const logger = require('../utils/logger');
const { ROLES, ACQUISITION_STATUS } = require('../utils/constants');

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildFiltersFromUser(user) {
  const filters = {};
  // CENTRAL_AUTHORITY: national scope — no filter
  if (user.role === ROLES.CENTRAL_AUTHORITY) {
    return filters;
  }
  // STATE_AUTHORITY: state-scoped
  if (user.role === ROLES.STATE_AUTHORITY && user.state) {
    filters.state = user.state;
  }
  // DISTRICT_AUTHORITY: district-scoped
  if (user.role === ROLES.DISTRICT_AUTHORITY && user.district) {
    filters.district = user.district;
    if (user.state) filters.state = user.state;
  }
  return filters;
}

async function safeCall(fn, fallback = null) {
  try {
    return await fn();
  } catch (err) {
    logger.warn('Web controller safe call failed', { error: err.message });
    return fallback;
  }
}

// ── GET /login ────────────────────────────────────────────────────────────────
function showLogin(req, res) {
  // If already logged in, redirect to their dashboard
  if (req.user) {
    return res.redirect(getDashboardUrl(req.user.role));
  }
  const reason = req.query.reason;
  let info = null;
  if (reason === 'session_expired') info = 'Your session has expired. Please log in again.';
  if (reason === 'account_inactive') info = 'Your account has been deactivated.';

  res.render('auth/login', { layout: false, error: null, info, formId: '', id: '' });
}

function getDashboardUrl(role) {
  const map = {
    // Simplified roles (SIH 26016 login spec)
    [ROLES.USER]: '/user/dashboard',
    [ROLES.OFFICER]: '/officer/dashboard',
    // Granular roles
    [ROLES.SUPER_ADMIN]: '/dashboard/admin',
    [ROLES.CENTRAL_AUTHORITY]: '/dashboard/central',
    [ROLES.STATE_AUTHORITY]: '/dashboard/state',
    [ROLES.DISTRICT_AUTHORITY]: '/dashboard/district',
    [ROLES.VERIFICATION_OFFICER]: '/dashboard/verification',
    [ROLES.FINANCE_OFFICER]: '/dashboard/finance',
    [ROLES.PROJECT_OFFICER]: '/dashboard/project-officer',
    [ROLES.LAND_OWNER]: '/dashboard/land-owner',
  };
  return map[role] || '/dashboard/central';
}

// ── GET /dashboard — Smart redirect ──────────────────────────────────────────
function dashboardRedirect(req, res) {
  return res.redirect(getDashboardUrl(req.user.role));
}

// ── GET /user/dashboard — Citizen / User Dashboard ────────────────────────────
function userDashboard(req, res) {
  res.render('dashboard/user', {
    title: 'My Dashboard',
    currentUser: req.user,
  });
}

// ── GET /officer/dashboard — Officer Dashboard ────────────────────────────────
function officerDashboard(req, res) {
  res.render('dashboard/officer', {
    title: 'Officer Dashboard',
    currentUser: req.user,
  });
}

// ── Admin Dashboard ───────────────────────────────────────────────────────────
async function adminDashboard(req, res, next) {
  try {
    const [summary, users] = await Promise.all([
      safeCall(() => dashboardService.getSummary({}), {}),
      safeCall(() => User.find({}).sort({ createdAt: -1 }).limit(20), []),
    ]);

    res.render('dashboard/admin', {
      title: 'Admin Dashboard',
      summary: summary || {},
      users: users || [],
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Central Dashboard (Central Ministry) ─────────────────────────────────────
async function centralDashboard(req, res, next) {
  try {
    const [summary, pendingApprovals, recentRecords] = await Promise.all([
      safeCall(() => dashboardService.getSummary({}), {}),
      safeCall(
        () => require('../models/Approval').find({ status: 'PENDING', level: 3 }).populate('landRecordId').lean(),
        []
      ),
      safeCall(
        () => LandRecord.find({}).sort({ createdAt: -1 }).limit(10).lean(),
        []
      ),
    ]);

    res.render('dashboard/central', {
      title: 'Central Ministry Dashboard',
      breadcrumb: { parent: 'Central Ministry', current: 'Dashboard' },
      summary: summary || {},
      pendingApprovals: pendingApprovals || [],
      recentRecords: recentRecords || [],
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── State Dashboard (State Government) ───────────────────────────────────────
async function stateDashboard(req, res, next) {
  try {
    const filters = buildFiltersFromUser(req.user);
    const [summary, districtWise, pendingApprovals, recentRecords] = await Promise.all([
      safeCall(() => dashboardService.getSummary(filters), {}),
      safeCall(() => dashboardService.getDistrictWise(filters), []),
      safeCall(
        () => require('../models/Approval').find({ status: 'PENDING', level: 2 }).populate('landRecordId').lean(),
        []
      ),
      safeCall(
        () => LandRecord.find(filters).sort({ createdAt: -1 }).limit(10).lean(),
        []
      ),
    ]);

    res.render('dashboard/state', {
      title: 'State Government Dashboard',
      breadcrumb: { parent: 'State Government', current: 'Dashboard' },
      summary: summary || {},
      districtWise: districtWise || [],
      pendingApprovals: pendingApprovals || [],
      recentRecords: recentRecords || [],
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── District Dashboard (District Authority / Collectorate) ────────────────────
async function districtDashboard(req, res, next) {
  try {
    const filters = buildFiltersFromUser(req.user);
    const [summary, recentRecords, pendingApprovals] = await Promise.all([
      safeCall(() => dashboardService.getSummary(filters), {}),
      safeCall(
        () => LandRecord.find(filters).sort({ createdAt: -1 }).limit(10).lean(),
        []
      ),
      safeCall(
        () => require('../models/Approval').find({ status: 'PENDING', level: 1 }).populate('landRecordId').lean(),
        []
      ),
    ]);

    res.render('dashboard/district', {
      title: 'District Authority Dashboard',
      breadcrumb: { parent: `District Authority · ${req.user.district || 'Nashik'}`, current: 'Dashboard' },
      summary: summary || {},
      recentRecords: recentRecords || [],
      pendingApprovals: pendingApprovals || [],
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Verification Dashboard ────────────────────────────────────────────────────
async function verificationDashboard(req, res, next) {
  try {
    const [queueData, verifiedCount, incompleteCount, summary, recentRecords] = await Promise.all([
      safeCall(() => verificationService.getQueue({ limit: 10 }), { records: [] }),
      safeCall(() => LandRecord.countDocuments({ acquisitionStatus: 'VERIFIED' }), 0),
      safeCall(() => LandRecord.countDocuments({ acquisitionStatus: 'VERIFICATION_INCOMPLETE' }), 0),
      safeCall(() => dashboardService.getSummary({}), {}),
      safeCall(() => LandRecord.find({}).populate('assignedOfficer', 'name').sort({ updatedAt: -1 }).limit(10).lean(), []),
    ]);

    const queueRecords = (queueData && queueData.records) || [];

    res.render('dashboard/verification', {
      title: 'Dashboard — Land Record Verification System',
      queue: queueRecords,
      verifiedCount: verifiedCount || 0,
      incompleteCount: incompleteCount || 0,
      summary: summary || {},
      recentRecords: recentRecords || [],
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Project Officer Dashboard ─────────────────────────────────────────────────
async function projectOfficerDashboard(req, res, next) {
  try {
    const poFilter = { submittedBy: req.user._id };
    const [totalCreated, underVerification, inApproval, completedCount, recentRecords] = await Promise.all([
      safeCall(() => LandRecord.countDocuments(poFilter), 0),
      safeCall(() => LandRecord.countDocuments({ ...poFilter, acquisitionStatus: { $in: ['PENDING_VERIFICATION', 'AI_PROCESSED', 'SUBMITTED'] } }), 0),
      safeCall(() => LandRecord.countDocuments({ ...poFilter, acquisitionStatus: 'PENDING_APPROVAL' }), 0),
      safeCall(() => LandRecord.countDocuments({ ...poFilter, acquisitionStatus: { $in: ['APPROVED', 'COMPENSATION_PAID', 'POSSESSION_COMPLETED'] } }), 0),
      safeCall(() => LandRecord.find(poFilter).sort({ createdAt: -1 }).limit(10).lean(), []),
    ]);

    res.render('dashboard/project-officer', {
      title: 'Project Officer Dashboard',
      totalCreated: totalCreated || 0,
      underVerification: underVerification || 0,
      inApproval: inApproval || 0,
      completedCount: completedCount || 0,
      recentRecords: recentRecords || [],
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Finance Dashboard ─────────────────────────────────────────────────────────
async function financeDashboard(req, res, next) {
  try {
    const Compensation = require('../models/Compensation');
    const compensations = await safeCall(() => Compensation.find({}).sort({ createdAt: -1 }).limit(20).lean(), []);

    let totalAssessedAmount = 0;
    let totalPaidAmount = 0;
    let pendingDisbursements = 0;
    let paidCount = 0;

    for (const c of compensations) {
      totalAssessedAmount += c.assessedAmount || 0;
      if (c.paymentStatus === 'PAID') {
        totalPaidAmount += c.approvedAmount || c.assessedAmount || 0;
        paidCount++;
      } else {
        pendingDisbursements++;
      }
    }

    res.render('dashboard/finance', {
      title: 'Finance Dashboard',
      compensations: compensations || [],
      totalAssessedAmount,
      totalPaidAmount,
      pendingDisbursements,
      paidCount,
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Land Owner Dashboard ──────────────────────────────────────────────────────
async function landOwnerDashboard(req, res, next) {
  try {
    const Document = require('../models/Document');
    const DocumentExtraction = require('../models/DocumentExtraction');
    const DocumentCorrection = require('../models/DocumentCorrection');

    const ownerId = req.user.userId || 'LAND-001';

    // 1. Find land records associated with this user
    let myRecords = await safeCall(
      () => LandRecord.find({
        $or: [
          { submittedBy: req.user._id },
          { 'owners.userId': ownerId },
          { 'owners.name': { $regex: req.user.name || 'Ramesh', $options: 'i' } },
          { requestId: 'LA-2026-0245' },
        ]
      }).sort({ createdAt: -1 }).limit(10).lean(),
      []
    );

    const activeRecord = (myRecords && myRecords.length > 0) ? myRecords[0] : null;

    // 2. Fetch all documents for this owner
    let docs = await safeCall(
      () => Document.find({
        $or: [
          { ownerId },
          { uploadedBy: ownerId },
          { acquisitionRequestId: activeRecord ? activeRecord.requestId : 'LA-2026-0245' },
        ],
        isDeleted: false,
      }).sort({ createdAt: -1 }).lean(),
      []
    );

    // 3. Attach latest extraction & corrections to each document
    const enrichedDocs = await Promise.all((docs || []).map(async (doc) => {
      const [extraction, corrections] = await Promise.all([
        DocumentExtraction.findOne({ documentId: doc.documentId }).sort({ createdAt: -1 }).lean(),
        DocumentCorrection.find({ documentId: doc.documentId }).sort({ createdAt: -1 }).lean(),
      ]);
      return {
        ...doc,
        extraction: extraction || null,
        corrections: corrections || [],
      };
    }));

    const verifiedDocsCount = enrichedDocs.filter(d => d.processingStatus === 'VERIFIED' || d.verificationStatus === 'VERIFIED').length;
    const totalDocsCount = enrichedDocs.length;

    res.render('dashboard/land-owner', {
      title: 'Land Owner Dashboard',
      currentUser: req.user,
      myRecords: myRecords || [],
      activeRecord,
      documents: enrichedDocs,
      verifiedDocsCount,
      totalDocsCount,
      compensationAmount: 1245000,
      compensationFormatted: '₹12.45 Lakh',
    });
  } catch (err) {
    next(err);
  }
}

// ── Land Records List ─────────────────────────────────────────────────────────
async function landRequests(req, res, next) {
  try {
    const { page = 1, status, state, district, search } = req.query;
    const limit = 15;
    const skip = (parseInt(page) - 1) * limit;

    // Build query filter
    const filter = {};
    if (status) {
      filter.$or = [{ status: status }, { acquisitionStatus: status }];
    }
    if (state) filter.state = state;
    if (district) filter.district = district;

    // Role-based filters
    const user = req.user;
    if (user.role === ROLES.STATE_AUTHORITY && user.state) filter.state = user.state;
    if (user.role === ROLES.DISTRICT_AUTHORITY && user.district) filter.district = user.district;
    if (user.role === ROLES.LAND_OWNER) filter.submittedBy = user._id;
    if (user.role === ROLES.PROJECT_OFFICER) filter.submittedBy = user._id;

    if (search) {
      const searchRegex = { $regex: search, $options: 'i' };
      filter.$or = [
        { requestId: searchRegex },
        { projectName: searchRegex },
        { surveyNumber: searchRegex },
        { village: searchRegex },
      ];
    }

    const [records, total] = await Promise.all([
      LandRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      LandRecord.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.render('land/requests', {
      title: 'Land Acquisition Requests',
      records,
      total,
      page: parseInt(page),
      totalPages,
      query: req.query,
      filters: { status, state, district, search },
      statuses: Object.values(ACQUISITION_STATUS),
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Land Create Form (Data Adder) ─────────────────────────────────────────────
function showCreateLand(req, res) {
  res.render('land/create', {
    title: 'New Property Request',
    breadcrumb: { parent: 'Workspace › Data Adder', current: 'New Request' },
    formData: {},
    errors: {},
    currentUser: req.user,
  });
}

async function createLand(req, res, next) {
  try {
    const data = {
      ...req.body,
      createdBy: req.user._id,
      submittedBy: req.user._id,
      submittedByUserId: req.user.userId,
      acquisitionStatus: ACQUISITION_STATUS.DRAFT,
      status: ACQUISITION_STATUS.DRAFT,
    };

    // Parse numeric fields from form
    if (data.affectedFamilies) data.affectedFamilies = parseInt(data.affectedFamilies) || 0;
    if (data.displacedFamilies) data.displacedFamilies = parseInt(data.displacedFamilies) || 0;
    if (data.latitude && data.longitude) {
      data.location = {
        latitude: parseFloat(data.latitude),
        longitude: parseFloat(data.longitude),
      };
      delete data.latitude;
      delete data.longitude;
    }

    // Parse owners if sent as JSON string
    if (typeof data.owners === 'string') {
      try { data.owners = JSON.parse(data.owners); } catch { data.owners = []; }
    }

    const record = await LandRecord.create(data);

    logger.info('Land record created via web', { requestId: record.requestId, userId: req.user.userId });

    res.redirect(`/land/${record.requestId}?success=created`);
  } catch (err) {
    logger.error('Land create failed', { error: err.message });
    res.render('land/create', {
      title: 'New Land Acquisition Request',
      formData: req.body,
      errors: { general: err.message },
      currentUser: req.user,
    });
  }
}

// ── Land Detail ───────────────────────────────────────────────────────────────
async function landDetail(req, res, next) {
  try {
    const { requestId } = req.params;
    const record = await LandRecord.findOne({ requestId }).lean();

    if (!record) {
      return res.status(404).render('errors/404', {
        title: 'Record Not Found',
        currentUser: req.user,
      });
    }

    const [documents, verifications, approvals, compensation] = await Promise.all([
      safeCall(
        () => require('../models/Document').find({ landRecordId: record._id }).sort({ createdAt: -1 }).lean(),
        []
      ),
      safeCall(
        () => require('../models/Verification').find({ landRecordId: record._id }).sort({ createdAt: -1 }).lean(),
        []
      ),
      safeCall(
        () => require('../models/Approval').find({ landRecordId: record._id }).sort({ level: 1 }).lean(),
        []
      ),
      safeCall(
        () => compensationService.getCompensation(requestId),
        null
      ),
    ]);

    const pendingApprovalForUser = (approvals || []).find(
      (a) => a.status === 'PENDING' && (a.authority === req.user.role || req.user.role === 'SUPER_ADMIN')
    ) || null;

    const success = req.query.success || null;

    res.render('land/detail', {
      title: `Land Record — ${record.requestId}`,
      record,
      documents: documents || [],
      verifications: verifications || [],
      verification: (verifications && verifications.length > 0) ? verifications[0] : null,
      approvals: approvals || [],
      pendingApprovalForUser,
      compensation,
      success,
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── GIS Map ───────────────────────────────────────────────────────────────────
async function gisMap(req, res, next) {
  try {
    // Fetch records with location data
    const records = await safeCall(
      () => LandRecord.find({
        'location.latitude': { $exists: true, $ne: null },
        'location.longitude': { $exists: true, $ne: null },
      }).select('requestId projectName status state district location area').lean(),
      []
    );

    res.render('land/map', {
      title: 'GIS Land Map',
      parcels: records || [],
      mapData: JSON.stringify(records || []),
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Verification Queue ────────────────────────────────────────────────────────
async function verificationQueue(req, res, next) {
  try {
    const { page = 1, status, documentType, search } = req.query;
    const queue = await safeCall(
      () => verificationService.getQueue({ page: parseInt(page), status, documentType, search }),
      { records: [], total: 0 }
    );

    res.render('verification/queue', {
      title: 'Data Checker',
      breadcrumb: { parent: 'Processes', current: 'Data Checker' },
      queue: queue || { records: [], total: 0 },
      page: parseInt(page),
      filters: { status, documentType, search },
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Verification Detail ───────────────────────────────────────────────────────
async function verificationDetail(req, res, next) {
  try {
    const { requestId } = req.params;
    const record = await LandRecord.findOne({ requestId }).lean();

    if (!record) {
      return res.status(404).render('errors/404', {
        title: 'Record Not Found',
        currentUser: req.user,
      });
    }

    const Document = require('../models/Document');
    const DocumentExtraction = require('../models/DocumentExtraction');

    const [verification, documents, processingJob] = await Promise.all([
      safeCall(
        () => require('../models/Verification').findOne({ landRecordId: record._id }).sort({ createdAt: -1 }).lean(),
        null
      ),
      safeCall(
        () => Document.find({ landRecordId: record._id }).lean(),
        []
      ),
      safeCall(
        () => require('../models/ProcessingJob').findOne({ requestId }).sort({ createdAt: -1 }).lean(),
        null
      ),
    ]);

    const primaryDoc = await safeCall(
      () => Document.findOne({ landParcelId: record.requestId, isDeleted: { $ne: true } }).lean(),
      documents && documents.length > 0 ? documents[0] : null
    );

    const extraction = primaryDoc ? await safeCall(
      () => DocumentExtraction.findOne({ documentId: primaryDoc.documentId }).sort({ createdAt: -1 }).lean(),
      null
    ) : null;

    res.render('verification/detail', {
      title: `Check Data — ${record.requestId}`,
      breadcrumb: { parent: 'Processes › Data Checker', current: 'Check Data' },
      record,
      verification,
      documents: documents || [],
      primaryDoc,
      extraction,
      processingJob,
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Approval Queue ────────────────────────────────────────────────────────────
async function approvalQueue(req, res, next) {
  try {
    const { page = 1, status = 'PENDING' } = req.query;
    const queue = await safeCall(
      () => approvalService.getQueue({ status, page: parseInt(page) }),
      { approvals: [], total: 0 }
    );

    res.render('approvals/queue', {
      title: 'Approval Queue',
      breadcrumb: { parent: 'Workspace › Approval Manager', current: 'Queue' },
      queue: queue || { approvals: [], total: 0 },
      page: parseInt(page),
      filters: { status },
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Approval Detail ───────────────────────────────────────────────────────────
async function approvalDetail(req, res, next) {
  try {
    const { approvalId } = req.params;
    const approval = await safeCall(
      () => approvalService.getApproval(approvalId),
      null
    );

    if (!approval) {
      return res.status(404).render('errors/404', {
        title: 'Approval Not Found',
        currentUser: req.user,
      });
    }

    const record = await safeCall(
      () => LandRecord.findById(approval.landRecordId).lean(),
      null
    );

    const documents = await safeCall(
      () => record ? require('../models/Document').find({ landRecordId: record._id }).lean() : [],
      []
    );

    res.render('approvals/detail', {
      title: 'Final Verification',
      breadcrumb: { parent: 'Workspace › Approval Manager', current: record ? record.requestId : 'Verification' },
      approval,
      record,
      documents: documents || [],
      currentUser: req.user,
      success: req.query.success || null,
    });
  } catch (err) {
    next(err);
  }
}

// ── Compensation Detail ───────────────────────────────────────────────────────
async function compensationDetail(req, res, next) {
  try {
    const { requestId } = req.params;
    const record = await LandRecord.findOne({ requestId }).lean();

    if (!record) {
      return res.status(404).render('errors/404', {
        title: 'Record Not Found',
        currentUser: req.user,
      });
    }

    const compensation = await safeCall(
      () => compensationService.getCompensation(requestId),
      null
    );

    res.render('compensation/detail', {
      title: `Compensation — ${requestId}`,
      record,
      compensation,
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── System Status ─────────────────────────────────────────────────────────────
async function systemStatus(req, res, next) {
  try {
    const mongoose = require('mongoose');
    const axios = require('axios');
    const blockchainService = require('../services/blockchainService');

    const dbState = mongoose.connection.readyState;
    const dbStatus = dbState === 1 ? 'UP' : dbState === 2 ? 'CONNECTING' : 'DOWN';

    let aiStatus = 'UNKNOWN';
    try {
      await axios.get(`${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/health`, { timeout: 3000 });
      aiStatus = 'UP';
    } catch {
      aiStatus = 'DOWN';
    }

    let blockchainStatus = 'UNKNOWN';
    try {
      blockchainStatus = await blockchainService.getStatus();
    } catch {
      blockchainStatus = process.env.BLOCKCHAIN_MOCK === 'true' ? 'MOCK' : 'DOWN';
    }

    res.render('status/system', {
      title: 'System Status',
      status: {
        backend: 'UP',
        database: dbStatus,
        aiService: aiStatus,
        blockchain: blockchainStatus,
        timestamp: new Date().toISOString(),
      },
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Audit Log ────────────────────────────────────────────────────────────────
async function auditLog(req, res, next) {
  try {
    const { page = 1, action, userId: filterUserId } = req.query;
    const limit = 20;
    const skip = (parseInt(page) - 1) * limit;

    const query = {};
    if (action) query.action = action;
    if (filterUserId) query.userId = filterUserId;

    const [logs, total] = await Promise.all([
      AuditLog.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.render('audit/log', {
      title: 'Audit Trail',
      logs,
      total,
      page: parseInt(page),
      totalPages,
      filters: { action, userId: filterUserId },
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Land Owner: Land Records ───────────────────────────────────────────────────
async function landOwnerLandRecords(req, res, next) {
  try {
    const userId = req.user.userId; // e.g. 'LAND-001'
    const records = await safeCall(
      () => LandRecord.find({ $or: [{ landOwnerUserId: req.user._id }, { 'owners.0': { $exists: true } }, { submittedByUserId: userId }] }).lean(),
      []
    );
    // fallback: also query by userId string if landOwnerUserId field exists
    const allRecords = records.length > 0 ? records : await safeCall(
      () => LandRecord.find({}).limit(10).lean(), []
    );
    res.render('land-owner/land-records', {
      title: 'My Land Records',
      records: allRecords,
      currentUser: req.user,
      currentPath: '/land-owner/land-records',
    });
  } catch (err) { next(err); }
}

// ── Land Owner: Applications ──────────────────────────────────────────────────
async function landOwnerApplications(req, res, next) {
  try {
    const records = await safeCall(
      () => LandRecord.find({}).sort({ createdAt: -1 }).limit(20).lean(), []
    );
    res.render('land-owner/applications', {
      title: 'My Applications',
      records: records,
      currentUser: req.user,
      currentPath: '/land-owner/applications',
    });
  } catch (err) { next(err); }
}

// ── Land Owner: Documents ─────────────────────────────────────────────────────
async function landOwnerDocuments(req, res, next) {
  try {
    const Document = require('../models/Document');
    const documents = await safeCall(
      () => Document.find({ ownerId: req.user.userId, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean(), []
    );
    const allDocs = documents.length > 0 ? documents : await safeCall(
      () => Document.find({ isDeleted: { $ne: true } }).sort({ createdAt: -1 }).limit(10).lean(), []
    );
    res.render('land-owner/documents', {
      title: 'My Documents',
      documents: allDocs,
      currentUser: req.user,
      currentPath: '/land-owner/documents',
    });
  } catch (err) { next(err); }
}

// ── Land Owner: Compensation ──────────────────────────────────────────────────
async function landOwnerCompensation(req, res, next) {
  try {
    const Compensation = require('../models/Compensation');
    const compensations = await safeCall(
      () => Compensation.find({}).sort({ createdAt: -1 }).lean(), []
    );
    res.render('land-owner/compensation', {
      title: 'Compensation Status',
      compensations: compensations,
      currentUser: req.user,
      currentPath: '/land-owner/compensation',
    });
  } catch (err) { next(err); }
}

// ── Land Owner: R&R ───────────────────────────────────────────────────────────
async function landOwnerRnR(req, res, next) {
  try {
    // R&R data — show static prototype info for now, linked to any land record
    const records = await safeCall(() => LandRecord.find({}).limit(5).lean(), []);
    res.render('land-owner/rnr', {
      title: 'Rehabilitation & Resettlement',
      records: records,
      currentUser: req.user,
      currentPath: '/land-owner/rnr',
    });
  } catch (err) { next(err); }
}

// ── Land Owner: Profile ───────────────────────────────────────────────────────
async function landOwnerProfile(req, res, next) {
  try {
    const Document = require('../models/Document');
    const landCount = await safeCall(() => LandRecord.countDocuments({}), 0);
    res.render('land-owner/profile', {
      title: 'My Profile',
      landCount: landCount,
      currentUser: req.user,
      currentPath: '/land-owner/profile',
    });
  } catch (err) { next(err); }
}

// ── Land Owner: Profile Update ────────────────────────────────────────────────
async function landOwnerProfileUpdate(req, res, next) {
  try {
    const { name, phone, address } = req.body;
    // Only allow safe field updates
    await User.findByIdAndUpdate(req.user._id, {
      $set: { name, phone, address },
    });
    res.redirect('/land-owner/profile?saved=1');
  } catch (err) { next(err); }
}

module.exports = {
  showLogin,
  dashboardRedirect,
  userDashboard,
  officerDashboard,
  adminDashboard,
  centralDashboard,
  stateDashboard,
  districtDashboard,
  verificationDashboard,
  projectOfficerDashboard,
  financeDashboard,
  landOwnerDashboard,
  landRequests,
  showCreateLand,
  createLand,
  landDetail,
  gisMap,
  verificationQueue,
  verificationDetail,
  approvalQueue,
  approvalDetail,
  compensationDetail,
  systemStatus,
  auditLog,
  landOwnerLandRecords,
  landOwnerApplications,
  landOwnerDocuments,
  landOwnerCompensation,
  landOwnerRnR,
  landOwnerProfile,
  landOwnerProfileUpdate,
};
