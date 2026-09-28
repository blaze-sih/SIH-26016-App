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
        () => require('../models/Approval').find({ $or: [{ action: 'PENDING', approvalLevel: 3 }, { status: 'PENDING', level: 3 }] }).populate('landRecordId').lean(),
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
        () => require('../models/Approval').find({ $or: [{ action: 'PENDING', approvalLevel: 2 }, { status: 'PENDING', level: 2 }] }).populate('landRecordId').lean(),
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
        () => require('../models/Approval').find({ $or: [{ action: 'PENDING', approvalLevel: 1 }, { status: 'PENDING', level: 1 }] }).populate('landRecordId').lean(),
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

    const conditions = [];

    if (status) {
      conditions.push({ $or: [{ status }, { acquisitionStatus: status }] });
    }

    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      conditions.push({
        $or: [
          { requestId: searchRegex },
          { projectName: searchRegex },
          { surveyNumber: searchRegex },
          { village: searchRegex },
          { landOwner: searchRegex },
          { 'owners.name': searchRegex },
          { district: searchRegex },
        ],
      });
    }

    // Role-based filters
    const user = req.user;
    if (user.role === ROLES.STATE_AUTHORITY && user.state) {
      conditions.push({ state: user.state });
    }
    if (user.role === ROLES.DISTRICT_AUTHORITY && user.district) {
      conditions.push({ district: user.district });
    }
    if (user.role === ROLES.LAND_OWNER) {
      conditions.push({
        $or: [
          { submittedBy: user._id },
          { landOwnerUserId: user._id },
          { submittedByUserId: user.userId },
          { 'owners.userId': user.userId },
          { 'owners.name': { $regex: user.name || 'Owner', $options: 'i' } },
        ],
      });
    }

    if (state && (!user.state || user.role === ROLES.CENTRAL_AUTHORITY || user.role === ROLES.SUPER_ADMIN)) {
      conditions.push({ state });
    }
    if (district && (!user.district || user.role === ROLES.STATE_AUTHORITY || user.role === ROLES.CENTRAL_AUTHORITY || user.role === ROLES.SUPER_ADMIN)) {
      conditions.push({ district });
    }

    const filter = conditions.length > 0 ? { $and: conditions } : {};

    const [records, total] = await Promise.all([
      LandRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      LandRecord.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

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

// ── Case Next Action Helper ──────────────────────────────────────────────────
function computeCaseNextAction(record, user, pendingApprovalForUser, compensation) {
  const status = record.acquisitionStatus || record.status || 'DRAFT';
  const role = user.role;

  switch (status) {
    case 'DRAFT':
    case 'SUBMITTED':
      return {
        title: 'Document Upload & AI Extraction Required',
        description: 'Upload 7/12 Satbara extract or title deed to initiate automated AI extraction and field validation.',
        roleAllowed: ['PROJECT_OFFICER', 'DISTRICT_AUTHORITY', 'SUPER_ADMIN'],
        canAct: ['PROJECT_OFFICER', 'DISTRICT_AUTHORITY', 'SUPER_ADMIN'].includes(role),
        actionType: 'upload',
        actionLabel: 'Upload Document / Run AI',
        actionUrl: `/verification/${record.requestId}`,
      };
    case 'AI_PROCESSING':
      return {
        title: 'AI Processing in Progress',
        description: 'Document text recognition and multi-language normalization currently running in prototype mode.',
        roleAllowed: ['ALL'],
        canAct: false,
        actionType: 'wait',
        actionLabel: 'Processing...',
        actionUrl: `/land/${record.requestId}`,
      };
    case 'AI_PROCESSED':
    case 'PENDING_VERIFICATION':
    case 'AI_FAILED':
    case 'EXTRACTION_FAILED':
      return {
        title: 'Officer Field & Attribute Scrutiny Required',
        description: 'Verification officer must cross-examine extracted survey number 142/3 with 142/8 on 7/12 extract and approve.',
        roleAllowed: ['VERIFICATION_OFFICER', 'DISTRICT_AUTHORITY', 'SUPER_ADMIN'],
        canAct: ['VERIFICATION_OFFICER', 'DISTRICT_AUTHORITY', 'SUPER_ADMIN'].includes(role),
        actionType: 'verify',
        actionLabel: 'Open Verification Workbench',
        actionUrl: `/verification/${record.requestId}`,
      };
    case 'DISTRICT_APPROVAL':
    case 'PENDING_APPROVAL':
      return {
        title: 'Level 1: District Authority Review Required',
        description: 'District Collector scrutiny of acquisition boundaries, ownership title, and gazette proposal.',
        roleAllowed: ['DISTRICT_AUTHORITY', 'SUPER_ADMIN'],
        canAct: ['DISTRICT_AUTHORITY', 'SUPER_ADMIN'].includes(role),
        actionType: 'approval',
        actionLabel: 'Review & Forward to State (L1)',
        actionUrl: pendingApprovalForUser ? `/approvals/${pendingApprovalForUser._id}` : `/land/${record.requestId}#approvals-section`,
      };
    case 'STATE_APPROVAL':
      return {
        title: 'Level 2: State Revenue Authority Endorsement',
        description: 'State Revenue Department review for inter-district road connectivity and alignment sanction.',
        roleAllowed: ['STATE_AUTHORITY', 'SUPER_ADMIN'],
        canAct: ['STATE_AUTHORITY', 'SUPER_ADMIN'].includes(role),
        actionType: 'approval',
        actionLabel: 'Review & Forward to Central (L2)',
        actionUrl: pendingApprovalForUser ? `/approvals/${pendingApprovalForUser._id}` : `/land/${record.requestId}#approvals-section`,
      };
    case 'CENTRAL_APPROVAL':
      return {
        title: 'Level 3: Central Ministry Final Sanction',
        description: 'Central Ministry granting final administrative approval and clearance under national highway scheme.',
        roleAllowed: ['CENTRAL_AUTHORITY', 'SUPER_ADMIN'],
        canAct: ['CENTRAL_AUTHORITY', 'SUPER_ADMIN'].includes(role),
        actionType: 'approval',
        actionLabel: 'Grant Central Sanction (L3)',
        actionUrl: pendingApprovalForUser ? `/approvals/${pendingApprovalForUser._id}` : `/land/${record.requestId}#approvals-section`,
      };
    case 'APPROVED':
      return {
        title: 'Statutory Gazette Notification & Valuation',
        description: 'Central approval granted. Issue Section 4/11 preliminary notification and initiate compensation assessment.',
        roleAllowed: ['DISTRICT_AUTHORITY', 'FINANCE_OFFICER', 'SUPER_ADMIN'],
        canAct: ['DISTRICT_AUTHORITY', 'FINANCE_OFFICER', 'SUPER_ADMIN'].includes(role),
        actionType: 'notification',
        actionLabel: 'Publish Section 11 Notification',
        actionUrl: `/land/${record.requestId}#notification-section`,
      };
    case 'NOTIFICATION_ISSUED':
      return {
        title: 'Pass Section 23 Land Acquisition Award',
        description: 'Gazette notification published. Declare final compensation award determining market value + 100% solatium.',
        roleAllowed: ['DISTRICT_AUTHORITY', 'FINANCE_OFFICER', 'SUPER_ADMIN'],
        canAct: ['DISTRICT_AUTHORITY', 'FINANCE_OFFICER', 'SUPER_ADMIN'].includes(role),
        actionType: 'award',
        actionLabel: 'Declare Land Award',
        actionUrl: `/land/${record.requestId}#award-section`,
      };
    case 'AWARD_DECLARED':
    case 'COMPENSATION_PENDING':
    case 'COMPENSATION_APPROVED':
      return {
        title: 'Disburse Compensation to Beneficiary',
        description: 'Execute instant direct bank transfer / PFMS payout to registered land owner Ramesh Patil.',
        roleAllowed: ['FINANCE_OFFICER', 'DISTRICT_AUTHORITY', 'SUPER_ADMIN'],
        canAct: ['FINANCE_OFFICER', 'DISTRICT_AUTHORITY', 'SUPER_ADMIN'].includes(role),
        actionType: 'disburse',
        actionLabel: 'Execute Payment Payout',
        actionUrl: `/land/${record.requestId}#compensation-section`,
      };
    case 'COMPENSATION_PAID':
    case 'POSSESSION_PENDING':
      return {
        title: 'Execute Physical Possession & Demarcation',
        description: 'Compensation settled. Execute panchnama, record site takeover, and sign possession certificate.',
        roleAllowed: ['DISTRICT_AUTHORITY', 'PROJECT_OFFICER', 'SUPER_ADMIN'],
        canAct: ['DISTRICT_AUTHORITY', 'PROJECT_OFFICER', 'SUPER_ADMIN'].includes(role),
        actionType: 'possession',
        actionLabel: 'Record Land Possession',
        actionUrl: `/land/${record.requestId}#possession-section`,
      };
    case 'POSSESSION_COMPLETED':
    case 'RR_IN_PROGRESS':
      return {
        title: 'Rehabilitation & Resettlement (R&R) Scrutiny',
        description: 'Verify alternate housing, family livelihood grants, and final case closure.',
        roleAllowed: ['DISTRICT_AUTHORITY', 'SUPER_ADMIN'],
        canAct: ['DISTRICT_AUTHORITY', 'SUPER_ADMIN'].includes(role),
        actionType: 'rnr_close',
        actionLabel: 'Review R&R / Close Case',
        actionUrl: `/land/${record.requestId}#rnr-section`,
      };
    case 'CLOSED':
      return {
        title: 'Case Successfully Closed',
        description: 'End-to-end acquisition completed. Immutable audit trail and blockchain digest archived.',
        roleAllowed: ['ALL'],
        canAct: false,
        actionType: 'none',
        actionLabel: 'Archived',
        actionUrl: `/land/${record.requestId}`,
      };
    default:
      return {
        title: 'In Progress',
        description: 'Review case dossier and proceed according to standard protocol.',
        roleAllowed: ['ALL'],
        canAct: true,
        actionType: 'review',
        actionLabel: 'Review Dossier',
        actionUrl: `/land/${record.requestId}`,
      };
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

    // Ensure requestId
    if (!data.requestId || !data.requestId.trim()) {
      data.requestId = `LA-2026-${Math.floor(1000 + Math.random() * 9000)}`;
    }

    // Set owner name
    if (data.landOwner && (!data.owners || data.owners.length === 0)) {
      data.owners = [{
        name: data.landOwner,
        fatherName: data.fatherName || 'Tukaram Patil',
        share: '1/1',
        contactNumber: data.contactNumber || '9822012345',
      }];
    }

    if (data.areaTotal) {
      data.area = {
        total: parseFloat(data.areaTotal) || 1,
        unit: data.areaUnit || 'Ha',
      };
    }

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

    // Initial audit log
    await auditService.log({
      action: 'LAND_RECORD_CREATED',
      userId: req.user._id,
      userRole: req.user.role,
      targetId: record._id,
      targetType: 'LandRecord',
      requestId: record.requestId,
      details: { projectName: record.projectName, surveyNumber: record.surveyNumber },
    });

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

    const Document = require('../models/Document');
    const DocumentExtraction = require('../models/DocumentExtraction');
    const Approval = require('../models/Approval');
    const Verification = require('../models/Verification');
    const riskEngine = require('../services/riskEngineService');

    const [documents, verifications, approvals, compensation, auditLogs] = await Promise.all([
      safeCall(() => Document.find({ landRecordId: record._id, isDeleted: { $ne: true } }).sort({ createdAt: -1 }).lean(), []),
      safeCall(() => Verification.find({ landRecordId: record._id }).sort({ createdAt: -1 }).lean(), []),
      safeCall(() => Approval.find({ landRecordId: record._id }).sort({ approvalLevel: 1, level: 1 }).lean(), []),
      safeCall(() => compensationService.getCompensation(requestId), null),
      safeCall(() => AuditLog.find({ requestId }).sort({ timestamp: -1 }).limit(30).lean(), []),
    ]);

    const primaryDoc = (documents && documents.length > 0) ? documents[0] : null;
    const extraction = primaryDoc ? await safeCall(
      () => DocumentExtraction.findOne({ documentId: primaryDoc.documentId }).sort({ createdAt: -1 }).lean(),
      null
    ) : null;

    const riskAssessment = riskEngine.assessCaseRisk(record, {
      documents: documents || [],
      extraction,
      approvals: approvals || [],
      compensation,
    });

    const pendingApprovalForUser = (approvals || []).find((a) => {
      const isPending = a.action === 'PENDING' || a.status === 'PENDING';
      if (!isPending) return false;
      if (req.user.role === ROLES.SUPER_ADMIN) return true;
      if (req.user.role === ROLES.DISTRICT_AUTHORITY && (a.approvalLevel === 1 || a.authority === 'DISTRICT_AUTHORITY')) return true;
      if (req.user.role === ROLES.STATE_AUTHORITY && (a.approvalLevel === 2 || a.authority === 'STATE_AUTHORITY')) return true;
      if (req.user.role === ROLES.CENTRAL_AUTHORITY && (a.approvalLevel === 3 || a.authority === 'CENTRAL_AUTHORITY')) return true;
      return false;
    }) || null;

    const nextAction = computeCaseNextAction(record, req.user, pendingApprovalForUser, compensation);

    const success = req.query.success || null;
    const errorMsg = req.query.error || null;

    res.render('land/detail', {
      title: `Land Record — ${record.requestId}`,
      record,
      documents: documents || [],
      primaryDoc,
      extraction,
      verifications: verifications || [],
      verification: (verifications && verifications.length > 0) ? verifications[0] : null,
      approvals: approvals || [],
      pendingApprovalForUser,
      compensation,
      auditLogs: auditLogs || [],
      riskAssessment,
      nextAction,
      success,
      errorMsg,
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

// ── General User Profile ───────────────────────────────────────────────────────
async function userProfile(req, res, next) {
  try {
    const landCount = await safeCall(() => LandRecord.countDocuments({}), 0);
    res.render('land-owner/profile', {
      title: 'User Profile & Settings',
      currentUser: req.user,
      landCount,
      currentPath: '/profile',
    });
  } catch (err) {
    next(err);
  }
}

// ── Action: Approval (Approve / Forward / Reject from case detail) ─────────────
async function postApprovalAction(req, res, next) {
  try {
    const { requestId } = req.params;
    const { action, approvalId, remarks } = req.body;
    let targetApprovalId = approvalId;

    if (!targetApprovalId) {
      const record = await LandRecord.findOne({ requestId });
      if (!record) return res.status(404).send('Record not found');
      const Approval = require('../models/Approval');
      const pending = await Approval.findOne({
        landRecordId: record._id,
        $or: [{ action: 'PENDING' }, { status: 'PENDING' }],
      }).sort({ approvalLevel: 1 });
      if (pending) targetApprovalId = pending._id;
    }

    if (!targetApprovalId) {
      return res.redirect(`/land/${requestId}?error=${encodeURIComponent('No pending approval found for this record')}`);
    }

    if (action === 'approve') {
      await approvalService.approve(targetApprovalId, req.user._id, remarks || 'Approved after statutory scrutiny', req.user.role);
    } else if (action === 'forward') {
      await approvalService.forward(targetApprovalId, req.user._id, remarks || 'Forwarded to next tier authority with endorsement', req.user.role);
    } else if (action === 'reject') {
      await approvalService.reject(targetApprovalId, req.user._id, remarks || 'Returned with objections', req.user.role);
    }

    res.redirect(`/land/${requestId}?success=approval_updated`);
  } catch (err) {
    logger.error('Web approval action failed', { error: err.message });
    res.redirect(`/land/${req.params.requestId}?error=${encodeURIComponent(err.message)}`);
  }
}

// ── Action: Verification & Attribute Correction ──────────────────────────────
async function postVerifyAction(req, res, next) {
  try {
    const { requestId } = req.params;
    const record = await LandRecord.findOne({ requestId });
    if (!record) return res.status(404).send('Record not found');

    const { surveyNumber, area, landOwner, village, district, state, remarks } = req.body;
    if (surveyNumber) record.surveyNumber = surveyNumber.trim();
    if (village) record.village = village.trim();
    if (district) record.district = district.trim();
    if (state) record.state = state.trim();
    if (landOwner) {
      record.landOwner = landOwner.trim();
      if (record.owners && record.owners.length > 0) {
        record.owners[0].name = landOwner.trim();
      }
    }
    if (area) {
      if (!record.area) record.area = { total: parseFloat(area) || 0, unit: 'Ha' };
      else record.area.total = parseFloat(area) || record.area.total;
    }

    record.acquisitionStatus = ACQUISITION_STATUS.DISTRICT_APPROVAL;
    record.status = ACQUISITION_STATUS.DISTRICT_APPROVAL;
    await record.save();

    // Mark verification record
    const Verification = require('../models/Verification');
    const Document = require('../models/Document');
    const primaryDoc = await Document.findOne({ landRecordId: record._id });
    await Verification.findOneAndUpdate(
      { landRecordId: record._id },
      {
        $setOnInsert: {
          requestId: record.requestId,
          documentId: primaryDoc ? primaryDoc._id : record._id,
          aiSnapshot: { surveyNumber: record.surveyNumber, area: record.area?.total || 45.2 },
        },
        $set: {
          verifiedBy: req.user._id,
          verificationStatus: 'VERIFIED',
          decision: 'VERIFIED',
          status: 'VERIFIED',
          notes: remarks || 'Verified and reconciled survey number and boundaries against 7/12 extract',
          verifiedAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    // Create District Authority Approval (Level 1)
    const Approval = require('../models/Approval');
    await Approval.create({
      requestId: record.requestId,
      landRecordId: record._id,
      authority: 'DISTRICT_AUTHORITY',
      approvalLevel: 1,
      action: 'PENDING',
      status: 'PENDING',
      remarks: 'Automated dispatch after verification officer sign-off',
    });

    await auditService.log({
      action: 'VERIFIED',
      userId: req.user._id,
      userRole: req.user.role,
      targetId: record._id,
      targetType: 'LandRecord',
      requestId: record.requestId,
      details: { remarks, surveyNumber: record.surveyNumber },
    });

    res.redirect(`/land/${requestId}?success=verified`);
  } catch (err) {
    logger.error('Web verify action failed', { error: err.message });
    res.redirect(`/land/${req.params.requestId}?error=${encodeURIComponent(err.message)}`);
  }
}

// ── Action: Issue Gazette Notification (Section 4/11) ────────────────────────
async function postIssueNotification(req, res, next) {
  try {
    const { requestId } = req.params;
    const { notificationNumber, notificationDate, notificationType } = req.body;
    const record = await LandRecord.findOne({ requestId });
    if (!record) return res.status(404).send('Record not found');

    record.notificationNumber = notificationNumber || `NOTIF/2026/LA-${Math.floor(1000 + Math.random() * 9000)}`;
    record.notificationDate = notificationDate ? new Date(notificationDate) : new Date();
    record.notificationType = notificationType || 'SECTION_11';
    record.notificationStatus = 'ISSUED';
    record.acquisitionStatus = ACQUISITION_STATUS.NOTIFICATION_ISSUED;
    record.status = ACQUISITION_STATUS.NOTIFICATION_ISSUED;
    await record.save();

    await auditService.log({
      action: 'NOTIFICATION_ISSUED',
      userId: req.user._id,
      userRole: req.user.role,
      targetId: record._id,
      targetType: 'LandRecord',
      requestId: record.requestId,
      details: { notificationNumber: record.notificationNumber, type: record.notificationType },
    });

    res.redirect(`/land/${requestId}?success=notification_issued`);
  } catch (err) {
    logger.error('Web notification action failed', { error: err.message });
    res.redirect(`/land/${req.params.requestId}?error=${encodeURIComponent(err.message)}`);
  }
}

// ── Action: Declare Land Acquisition Award (Section 23) ───────────────────────
async function postDeclareAward(req, res, next) {
  try {
    const { requestId } = req.params;
    const { awardNumber, awardDate, awardAmount } = req.body;
    const record = await LandRecord.findOne({ requestId });
    if (!record) return res.status(404).send('Record not found');

    record.awardNumber = awardNumber || `AWD/NSK/2026-${Math.floor(100 + Math.random() * 900)}`;
    record.awardDate = awardDate ? new Date(awardDate) : new Date();
    record.awardAmount = parseFloat(awardAmount) || 28500000;
    record.awardStatus = 'DECLARED';
    record.acquisitionStatus = ACQUISITION_STATUS.AWARD_DECLARED;
    record.status = ACQUISITION_STATUS.AWARD_DECLARED;
    await record.save();

    // Create or update Compensation record
    const Compensation = require('../models/Compensation');
    await Compensation.findOneAndUpdate(
      { landRecordId: record._id },
      {
        landRecordId: record._id,
        assessedAmount: record.awardAmount,
        approvedAmount: record.awardAmount,
        currency: 'INR',
        paymentStatus: 'PENDING',
        status: 'ASSESSED',
        assessedBy: req.user._id,
        remarks: `Award declared under Section 23: ₹${(record.awardAmount).toLocaleString('en-IN')}`,
      },
      { upsert: true, new: true }
    );

    await auditService.log({
      action: 'AWARD_DECLARED',
      userId: req.user._id,
      userRole: req.user.role,
      targetId: record._id,
      targetType: 'LandRecord',
      requestId: record.requestId,
      details: { awardNumber: record.awardNumber, amount: record.awardAmount },
    });

    res.redirect(`/land/${requestId}?success=award_declared`);
  } catch (err) {
    logger.error('Web award action failed', { error: err.message });
    res.redirect(`/land/${req.params.requestId}?error=${encodeURIComponent(err.message)}`);
  }
}

// ── Action: Assess Compensation Valuation ────────────────────────────────────
async function postAssessCompensation(req, res, next) {
  try {
    const { requestId } = req.params;
    const { baseRatePerSqMeter, solatiumMultiplier, additionalAssetsValue, remarks } = req.body;
    const record = await LandRecord.findOne({ requestId });
    if (!record) return res.status(404).send('Record not found');

    const areaTotal = record.area?.total || 1;
    const areaUnit = record.area?.unit || 'Ha';
    const areaSqM = areaUnit === 'Ha' ? areaTotal * 10000 : (areaUnit === 'Acre' ? areaTotal * 4046.86 : areaTotal);
    const rate = parseFloat(baseRatePerSqMeter) || 500;
    const marketValue = Math.round(areaSqM * rate);
    const solatium = Math.round(marketValue * (parseFloat(solatiumMultiplier) || 1.0));
    const assets = parseFloat(additionalAssetsValue) || 0;
    const totalAmount = marketValue + solatium + assets;

    const Compensation = require('../models/Compensation');
    await Compensation.findOneAndUpdate(
      { landRecordId: record._id },
      {
        landRecordId: record._id,
        assessedAmount: totalAmount,
        approvedAmount: totalAmount,
        currency: 'INR',
        paymentStatus: 'PENDING',
        status: 'ASSESSED',
        assessedBy: req.user._id,
        valuationBreakdown: {
          marketValue,
          solatium,
          assets,
          ratePerSqMeter: rate,
        },
        remarks: remarks || `Valuation assessed: Base ₹${marketValue.toLocaleString('en-IN')} + 100% Solatium ₹${solatium.toLocaleString('en-IN')}`,
      },
      { upsert: true, new: true }
    );

    record.awardAmount = totalAmount;
    record.acquisitionStatus = ACQUISITION_STATUS.COMPENSATION_PENDING;
    record.status = ACQUISITION_STATUS.COMPENSATION_PENDING;
    await record.save();

    res.redirect(`/land/${requestId}?success=compensation_assessed`);
  } catch (err) {
    logger.error('Web compensation assess failed', { error: err.message });
    res.redirect(`/land/${req.params.requestId}?error=${encodeURIComponent(err.message)}`);
  }
}

// ── Action: Disburse Compensation (Sandbox Payment) ───────────────────────────
async function postDisburseCompensation(req, res, next) {
  try {
    const { requestId } = req.params;
    const record = await LandRecord.findOne({ requestId });
    if (!record) return res.status(404).send('Record not found');

    const Compensation = require('../models/Compensation');
    let comp = await Compensation.findOne({ landRecordId: record._id });
    if (!comp) {
      comp = await Compensation.create({
        landRecordId: record._id,
        assessedAmount: record.awardAmount || 28500000,
        approvedAmount: record.awardAmount || 28500000,
        currency: 'INR',
        paymentStatus: 'PENDING',
        status: 'ASSESSED',
      });
    }

    const txHash = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    comp.paymentStatus = 'PAID';
    comp.status = 'PAID';
    comp.paidAt = new Date();
    comp.disbursedAt = new Date();
    comp.disbursedBy = req.user._id;
    comp.blockchainTxHash = txHash;
    comp.transactionReference = `PFMS-SANDBOX-${Date.now().toString().slice(-8)}`;
    await comp.save();

    record.acquisitionStatus = ACQUISITION_STATUS.COMPENSATION_PAID;
    record.status = ACQUISITION_STATUS.COMPENSATION_PAID;
    await record.save();

    await auditService.log({
      action: 'COMPENSATION_DISBURSED',
      userId: req.user._id,
      userRole: req.user.role,
      targetId: record._id,
      targetType: 'LandRecord',
      requestId: record.requestId,
      details: { amount: comp.approvedAmount || comp.assessedAmount, txHash, ref: comp.transactionReference },
    });

    res.redirect(`/land/${requestId}?success=compensation_paid`);
  } catch (err) {
    logger.error('Web disburse failed', { error: err.message });
    res.redirect(`/land/${req.params.requestId}?error=${encodeURIComponent(err.message)}`);
  }
}

// ── Action: Record Physical Possession & Panchnama ───────────────────────────
async function postUpdatePossession(req, res, next) {
  try {
    const { requestId } = req.params;
    const { possessionStatus, possessionDate, officerName, remarks } = req.body;
    const record = await LandRecord.findOne({ requestId });
    if (!record) return res.status(404).send('Record not found');

    record.possessionStatus = possessionStatus || 'COMPLETED';
    record.possessionDate = possessionDate ? new Date(possessionDate) : new Date();
    record.possessionOfficer = officerName || req.user.name || 'Executive Engineer / Tehsildar';
    record.possessionOfficerId = req.user.userId || req.user._id.toString();
    record.possessionRemarks = remarks || 'Physical possession taken, panchnama executed with boundary demarcation stones installed';

    if (record.possessionStatus === 'COMPLETED') {
      record.acquisitionStatus = ACQUISITION_STATUS.POSSESSION_COMPLETED;
      record.status = ACQUISITION_STATUS.POSSESSION_COMPLETED;
    } else {
      record.acquisitionStatus = ACQUISITION_STATUS.POSSESSION_PENDING;
      record.status = ACQUISITION_STATUS.POSSESSION_PENDING;
    }
    await record.save();

    await auditService.log({
      action: 'POSSESSION_RECORDED',
      userId: req.user._id,
      userRole: req.user.role,
      targetId: record._id,
      targetType: 'LandRecord',
      requestId: record.requestId,
      details: { status: record.possessionStatus, officer: record.possessionOfficer },
    });

    res.redirect(`/land/${requestId}?success=possession_updated`);
  } catch (err) {
    logger.error('Web possession update failed', { error: err.message });
    res.redirect(`/land/${req.params.requestId}?error=${encodeURIComponent(err.message)}`);
  }
}

// ── Action: Update R&R Status ────────────────────────────────────────────────
async function postUpdateRnR(req, res, next) {
  try {
    const { requestId } = req.params;
    const { rrStatus, rehabilitationStatus, resettlementStatus, benefitsProvided, pendingActions, affectedFamilies, displacedFamilies } = req.body;
    const record = await LandRecord.findOne({ requestId });
    if (!record) return res.status(404).send('Record not found');

    record.rrStatus = rrStatus || 'IN_PROGRESS';
    if (rehabilitationStatus) record.rehabilitationStatus = rehabilitationStatus;
    if (resettlementStatus) record.resettlementStatus = resettlementStatus;
    if (benefitsProvided) record.benefitsProvided = benefitsProvided;
    if (pendingActions) record.pendingActions = pendingActions;
    if (affectedFamilies) record.affectedFamilies = parseInt(affectedFamilies) || record.affectedFamilies;
    if (displacedFamilies) record.displacedFamilies = parseInt(displacedFamilies) || record.displacedFamilies;

    if (record.rrStatus === 'COMPLETED') {
      record.acquisitionStatus = ACQUISITION_STATUS.RR_COMPLETED;
      record.status = ACQUISITION_STATUS.RR_COMPLETED;
    } else {
      record.acquisitionStatus = ACQUISITION_STATUS.RR_IN_PROGRESS;
      record.status = ACQUISITION_STATUS.RR_IN_PROGRESS;
    }
    await record.save();

    await auditService.log({
      action: 'RR_STATUS_UPDATED',
      userId: req.user._id,
      userRole: req.user.role,
      targetId: record._id,
      targetType: 'LandRecord',
      requestId: record.requestId,
      details: { rrStatus: record.rrStatus, rehabilitationStatus: record.rehabilitationStatus },
    });

    res.redirect(`/land/${requestId}?success=rnr_updated`);
  } catch (err) {
    logger.error('Web RnR update failed', { error: err.message });
    res.redirect(`/land/${req.params.requestId}?error=${encodeURIComponent(err.message)}`);
  }
}

// ── Action: Close Case ───────────────────────────────────────────────────────
async function postCloseCase(req, res, next) {
  try {
    const { requestId } = req.params;
    const { closingRemarks } = req.body;
    const record = await LandRecord.findOne({ requestId });
    if (!record) return res.status(404).send('Record not found');

    record.acquisitionStatus = ACQUISITION_STATUS.CLOSED;
    record.status = ACQUISITION_STATUS.CLOSED;
    await record.save();

    await auditService.log({
      action: 'CASE_CLOSED',
      userId: req.user._id,
      userRole: req.user.role,
      targetId: record._id,
      targetType: 'LandRecord',
      requestId: record.requestId,
      details: { remarks: closingRemarks || 'All statutory acquisition, compensation, and handover stages fully satisfied.' },
    });

    res.redirect(`/land/${requestId}?success=case_closed`);
  } catch (err) {
    logger.error('Web close case failed', { error: err.message });
    res.redirect(`/land/${req.params.requestId}?error=${encodeURIComponent(err.message)}`);
  }
}

// ── Compensation List View ───────────────────────────────────────────────────
async function compensationList(req, res, next) {
  try {
    const Compensation = require('../models/Compensation');
    const { status, search } = req.query;
    const filter = {};
    if (status) filter.paymentStatus = status;

    const compensations = await safeCall(
      () => Compensation.find(filter).populate('landRecordId').sort({ createdAt: -1 }).lean(),
      []
    );

    let totalAssessed = 0;
    let totalPaid = 0;
    let paidCount = 0;
    let pendingCount = 0;

    for (const c of compensations) {
      totalAssessed += (c.approvedAmount || c.assessedAmount || 0);
      if (c.paymentStatus === 'PAID') {
        totalPaid += (c.approvedAmount || c.assessedAmount || 0);
        paidCount++;
      } else {
        pendingCount++;
      }
    }

    res.render('compensation/list', {
      title: 'Compensation Management',
      compensations,
      totalAssessed,
      totalPaid,
      paidCount,
      pendingCount,
      filters: { status, search },
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

// ── Mobile Field Survey Mode ─────────────────────────────────────────────────
async function fieldMode(req, res, next) {
  try {
    const { requestId } = req.params;
    const record = await LandRecord.findOne({ requestId }).lean();
    if (!record) return res.status(404).render('errors/404', { title: 'Record Not Found', currentUser: req.user });

    res.render('land/field-mode', {
      title: `Field Survey Mode — ${record.requestId}`,
      record,
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
}

async function submitFieldMode(req, res, next) {
  try {
    const { requestId } = req.params;
    const record = await LandRecord.findOne({ requestId });
    if (!record) return res.status(404).send('Record not found');

    const { latitude, longitude, boundaryVerified, encroachmentFound, fieldNotes } = req.body;
    if (latitude && longitude) {
      record.location = { latitude: parseFloat(latitude), longitude: parseFloat(longitude) };
    }
    record.possessionRemarks = `[Field Verification Completed] Notes: ${fieldNotes || 'Boundaries physically reconciled'}. Boundary Verified: ${boundaryVerified === 'on' || boundaryVerified === 'true'}. Encroachment: ${encroachmentFound === 'on' || encroachmentFound === 'true' ? 'Detected' : 'None'}.`;
    await record.save();

    await auditService.log({
      action: 'FIELD_SURVEY_RECORDED',
      userId: req.user._id,
      userRole: req.user.role,
      targetId: record._id,
      targetType: 'LandRecord',
      requestId: record.requestId,
      details: { latitude, longitude, boundaryVerified, encroachmentFound },
    });

    res.redirect(`/land/${requestId}?success=field_survey_saved`);
  } catch (err) {
    next(err);
  }
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
  compensationList,
  systemStatus,
  auditLog,
  landOwnerLandRecords,
  landOwnerApplications,
  landOwnerDocuments,
  landOwnerCompensation,
  landOwnerRnR,
  landOwnerProfile,
  landOwnerProfileUpdate,
  userProfile,
  postApprovalAction,
  postVerifyAction,
  postIssueNotification,
  postDeclareAward,
  postAssessCompensation,
  postDisburseCompensation,
  postUpdatePossession,
  postUpdateRnR,
  postCloseCase,
  fieldMode,
  submitFieldMode,
};
