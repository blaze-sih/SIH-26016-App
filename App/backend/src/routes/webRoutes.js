/**
 * LRVS — Web Browser Routes
 * Team BLAZE | SIH26016
 *
 * All EJS browser routes. Authentication via HTTP-only cookie.
 * Role-based access enforced per route.
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticateUser, optionalAuth } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');
const { login, logout } = require('../controllers/authController');
const web = require('../controllers/webController');

const {
  SUPER_ADMIN,
  CENTRAL_AUTHORITY,
  STATE_AUTHORITY,
  DISTRICT_AUTHORITY,
  VERIFICATION_OFFICER,
  FINANCE_OFFICER,
  PROJECT_OFFICER,
  LAND_OWNER,
  VIEWER,
} = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  CENTRAL_AUTHORITY: 'CENTRAL_AUTHORITY',
  STATE_AUTHORITY: 'STATE_AUTHORITY',
  DISTRICT_AUTHORITY: 'DISTRICT_AUTHORITY',
  VERIFICATION_OFFICER: 'VERIFICATION_OFFICER',
  FINANCE_OFFICER: 'FINANCE_OFFICER',
  PROJECT_OFFICER: 'PROJECT_OFFICER',
  LAND_OWNER: 'LAND_OWNER',
  VIEWER: 'VIEWER',
};

const AUTHORITY_ROLES = [SUPER_ADMIN, CENTRAL_AUTHORITY, STATE_AUTHORITY, DISTRICT_AUTHORITY];
const OFFICER_ROLES = [...AUTHORITY_ROLES, VERIFICATION_OFFICER, FINANCE_OFFICER, PROJECT_OFFICER];
const ALL_ROLES = [...OFFICER_ROLES, LAND_OWNER, VIEWER];

// ── Auth ──────────────────────────────────────────────────────────────────────

// GET /login — Show login page
router.get('/login', optionalAuth, web.showLogin);

// POST /login — Process login (ID + Password)
router.post('/login', login);

// POST /logout — Logout and clear cookie
router.post('/logout', optionalAuth, logout);
router.post('/auth/logout', optionalAuth, logout);

// GET / — Root redirect
router.get('/', authenticateUser, web.dashboardRedirect);

// ── Dashboard Routes ──────────────────────────────────────────────────────────

// GET /dashboard — Smart redirect based on role
router.get('/dashboard', authenticateUser, web.dashboardRedirect);

// GET /user/dashboard — Citizen / User dashboard
router.get(
  '/user/dashboard',
  authenticateUser,
  authorizeRoles('USER', 'SUPER_ADMIN'),
  web.userDashboard
);

// GET /officer/dashboard — Officer dashboard
router.get(
  '/officer/dashboard',
  authenticateUser,
  authorizeRoles('OFFICER', 'SUPER_ADMIN'),
  web.officerDashboard
);

// GET /dashboard/admin
router.get(
  '/dashboard/admin',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN),
  web.adminDashboard
);

// GET /dashboard/central
router.get(
  '/dashboard/central',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, CENTRAL_AUTHORITY, VIEWER),
  web.centralDashboard
);

// GET /dashboard/state
router.get(
  '/dashboard/state',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, CENTRAL_AUTHORITY, STATE_AUTHORITY),
  web.stateDashboard
);

// GET /dashboard/district
router.get(
  '/dashboard/district',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, CENTRAL_AUTHORITY, STATE_AUTHORITY, DISTRICT_AUTHORITY),
  web.districtDashboard
);

// GET /dashboard/verification
router.get(
  '/dashboard/verification',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, VERIFICATION_OFFICER),
  web.verificationDashboard
);

// GET /dashboard/project-officer
router.get(
  '/dashboard/project-officer',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, PROJECT_OFFICER),
  web.projectOfficerDashboard
);

// GET /dashboard/finance
router.get(
  '/dashboard/finance',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, FINANCE_OFFICER),
  web.financeDashboard
);

// GET /dashboard/land-owner
router.get(
  '/dashboard/land-owner',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, LAND_OWNER),
  web.landOwnerDashboard
);

// ── Land Routes ───────────────────────────────────────────────────────────────

// GET /land/requests — List all land records (with filters)
router.get(
  '/land/requests',
  authenticateUser,
  authorizeRoles(...ALL_ROLES),
  web.landRequests
);

// GET /land/create — Show create form
router.get(
  '/land/create',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, DISTRICT_AUTHORITY, PROJECT_OFFICER),
  web.showCreateLand
);

// POST /land/create — Submit new land record
router.post(
  '/land/create',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, DISTRICT_AUTHORITY, PROJECT_OFFICER),
  web.createLand
);

// GET /land/:requestId — View land record detail
router.get(
  '/land/:requestId',
  authenticateUser,
  authorizeRoles(...ALL_ROLES),
  web.landDetail
);

// ── GIS Map ───────────────────────────────────────────────────────────────────

// GET /map — GIS Map view
router.get(
  '/map',
  authenticateUser,
  authorizeRoles(...OFFICER_ROLES),
  web.gisMap
);

// ── Verification Routes ───────────────────────────────────────────────────────

// GET /verification/queue — Verification queue
router.get(
  '/verification/queue',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, VERIFICATION_OFFICER, DISTRICT_AUTHORITY),
  web.verificationQueue
);

// GET /verification/:requestId — Verification detail/workbench
router.get(
  '/verification/:requestId',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, VERIFICATION_OFFICER, DISTRICT_AUTHORITY),
  web.verificationDetail
);

// ── Approval Routes ───────────────────────────────────────────────────────────

// GET /approvals/queue — Approval queue
router.get(
  '/approvals/queue',
  authenticateUser,
  authorizeRoles(...AUTHORITY_ROLES),
  web.approvalQueue
);

// GET /approvals/:approvalId — Approval detail
router.get(
  '/approvals/:approvalId',
  authenticateUser,
  authorizeRoles(...AUTHORITY_ROLES),
  web.approvalDetail
);

// ── Compensation Routes ───────────────────────────────────────────────────────

// GET /compensation/:requestId — Compensation detail
router.get(
  '/compensation/:requestId',
  authenticateUser,
  authorizeRoles(SUPER_ADMIN, FINANCE_OFFICER, LAND_OWNER, ...AUTHORITY_ROLES),
  web.compensationDetail
);

// ── System & Audit ────────────────────────────────────────────────────────────

// GET /system/status — System status page
router.get(
  '/system/status',
  authenticateUser,
  authorizeRoles(...OFFICER_ROLES),
  web.systemStatus
);

// GET /audit — Audit trail
router.get(
  '/audit',
  authenticateUser,
  authorizeRoles(...OFFICER_ROLES),
  web.auditLog
);

// ── Land Owner Portal Routes ───────────────────────────────────────────────────

// GET /land-owner/land-records
router.get('/land-owner/land-records', authenticateUser, authorizeRoles(LAND_OWNER, SUPER_ADMIN), web.landOwnerLandRecords);

// GET /land-owner/applications  
router.get('/land-owner/applications', authenticateUser, authorizeRoles(LAND_OWNER, SUPER_ADMIN), web.landOwnerApplications);

// GET /land-owner/documents
router.get('/land-owner/documents', authenticateUser, authorizeRoles(LAND_OWNER, SUPER_ADMIN), web.landOwnerDocuments);

// GET /land-owner/compensation
router.get('/land-owner/compensation', authenticateUser, authorizeRoles(LAND_OWNER, SUPER_ADMIN), web.landOwnerCompensation);

// GET /land-owner/rnr
router.get('/land-owner/rnr', authenticateUser, authorizeRoles(LAND_OWNER, SUPER_ADMIN), web.landOwnerRnR);

// GET /land-owner/profile
router.get('/land-owner/profile', authenticateUser, authorizeRoles(LAND_OWNER, SUPER_ADMIN), web.landOwnerProfile);

// POST /land-owner/profile (update safe fields)
router.post('/land-owner/profile', authenticateUser, authorizeRoles(LAND_OWNER, SUPER_ADMIN), web.landOwnerProfileUpdate);

module.exports = router;
