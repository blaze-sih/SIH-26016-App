/**
 * LRVS — Full Comprehensive Demonstration Seed Script
 * Team BLAZE | SIH26016
 *
 * Seeds:
 * 1. All 8 Evaluation Role Users (CENTRAL-001, STATE-001, DIST-001, VERIF-001, PROJ-001, FIN-001, LAND-001, SUPER-001)
 * 2. 5 Canonical Demonstration Cases covering all lifecycle milestones
 * 3. Golden Demo Case: LA-2026-0003 (Greenfield Expressway, Nashik Sinnar, Survey 142/8, Ramesh Patil)
 *    - Includes AI OCR flag (142/3 @ 61% confidence corrected to 142/8)
 *    - Includes Level 1 District Authority approval queue entry
 *    - Includes valuation assessment (₹2.85 Crore with 100% solatium)
 *    - Includes audit trail entries
 */

'use strict';

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sih26016';

const User = require('../src/models/User');
const LandRecord = require('../src/models/LandRecord');
const Document = require('../src/models/Document');
const DocumentExtraction = require('../src/models/DocumentExtraction');
const Compensation = require('../src/models/Compensation');
const Approval = require('../src/models/Approval');
const Verification = require('../src/models/Verification');
const AuditLog = require('../src/models/AuditLog');
const auditService = require('../src/services/auditService');

async function seedDatabase() {
  console.log(`Connecting to MongoDB at: ${MONGO_URI}`);
  await mongoose.connect(MONGO_URI);
  console.log('MongoDB connection established.');

  const passwordHash = await bcrypt.hash('Pass@1234', 10);

  // 1. Seed Users
  const usersToSeed = [
    {
      userId: 'CENTRAL-001',
      name: 'Dr. Alok Verma, Joint Secretary',
      role: 'CENTRAL_AUTHORITY',
      email: 'central.demo@lrvs.local',
      state: 'All',
      district: 'All',
      department: 'Ministry of Land Resources & Highways',
      phone: '9811001122',
      password: passwordHash,
      isActive: true,
    },
    {
      userId: 'STATE-001',
      name: 'Sunita Patil, IAS, Principal Secretary',
      role: 'STATE_AUTHORITY',
      email: 'state.demo@lrvs.local',
      state: 'Maharashtra',
      district: 'All',
      department: 'Revenue & Forest Department, Maharashtra',
      phone: '9822002233',
      password: passwordHash,
      isActive: true,
    },
    {
      userId: 'DIST-001',
      name: 'Jalaj Sharma, IAS, District Collector',
      role: 'DISTRICT_AUTHORITY',
      email: 'district.demo@lrvs.local',
      state: 'Maharashtra',
      district: 'Nashik',
      department: 'District Collectorate Nashik',
      phone: '9823003344',
      password: passwordHash,
      isActive: true,
    },
    {
      userId: 'VERIF-001',
      name: 'Manoj Kumar, Scrutiny Officer',
      role: 'VERIFICATION_OFFICER',
      email: 'verification.demo@lrvs.local',
      state: 'Maharashtra',
      district: 'Nashik',
      department: 'Land Records & Cadastral Verification Cell',
      phone: '9824004455',
      password: passwordHash,
      isActive: true,
    },
    {
      userId: 'PROJ-001',
      name: 'Pravin Sharma, Executive Engineer',
      role: 'PROJECT_OFFICER',
      email: 'approval.demo@lrvs.local',
      state: 'Maharashtra',
      district: 'Nashik',
      department: 'National Highways & Infrastructure Authority',
      phone: '9825005566',
      password: passwordHash,
      isActive: true,
    },
    {
      userId: 'FIN-001',
      name: 'Rajesh Mehta, Chief Accounts Officer',
      role: 'FINANCE_OFFICER',
      email: 'finance.demo@lrvs.local',
      state: 'Maharashtra',
      district: 'Nashik',
      department: 'Finance & Compensation Disbursement Division',
      phone: '9826006677',
      password: passwordHash,
      isActive: true,
    },
    {
      userId: 'LAND-001',
      name: 'Ramesh Patil',
      role: 'LAND_OWNER',
      email: 'landowner.demo@lrvs.local',
      state: 'Maharashtra',
      district: 'Nashik',
      address: 'House No. 42, Sinnar Gaothan, Nashik, Maharashtra - 422103',
      phone: '9822012345',
      password: passwordHash,
      isActive: true,
    },
    {
      userId: 'SUPER-001',
      name: 'System Administrator',
      role: 'SUPER_ADMIN',
      email: 'admin.demo@lrvs.local',
      state: 'All',
      district: 'All',
      department: 'National Land Portal HQ',
      phone: '9800000000',
      password: passwordHash,
      isActive: true,
    },
  ];

  const userMap = {};
  for (const u of usersToSeed) {
    const user = await User.findOneAndUpdate(
      { userId: u.userId },
      { $set: u },
      { upsert: true, new: true }
    );
    userMap[u.userId] = user;
    console.log(`✓ User synced: [${u.role}] ${u.userId} (${u.name})`);
  }

  // 2. Clean up existing demo records to ensure deterministic state
  const demoRequestIds = ['LA-2026-0001', 'LA-2026-0002', 'LA-2026-0003', 'LA-2026-0004', 'LA-2026-0005', 'LRVS-DEMO-0001', 'LRVS-DEMO-0002'];
  const oldLandRecs = await LandRecord.find({ requestId: { $in: demoRequestIds } });
  const oldIds = oldLandRecs.map(r => r._id);

  await Approval.deleteMany({ landRecordId: { $in: oldIds } });
  await Compensation.deleteMany({ landRecordId: { $in: oldIds } });
  await Verification.deleteMany({ landRecordId: { $in: oldIds } });
  await Document.deleteMany({ landRecordId: { $in: oldIds } });
  await mongoose.connection.collection('auditlogs').deleteMany({ requestId: { $in: demoRequestIds } });
  await LandRecord.deleteMany({ requestId: { $in: demoRequestIds } });

  console.log('✓ Cleaned legacy demo records for fresh seeding');

  // ── CASE 1: LA-2026-0001 (Draft / Initial Proposal) ────────────────────────
  const case1 = await LandRecord.create({
    requestId: 'LA-2026-0001',
    projectName: 'Nagpur-Goa Shaktipeeth Expressway',
    projectId: 'NGS-2026-SEC4',
    surveyNumber: '55/2',
    subDivision: 'B',
    khataNumber: 'KH-1029',
    state: 'Maharashtra',
    district: 'Pune',
    taluka: 'Baramati',
    village: 'Baramati',
    area: { total: 12.4, totalNumeric: 12.4, unit: 'Ha' },
    landType: 'Agricultural',
    occupancyClass: 'Bhogvatdar Class 1',
    acquisitionPurpose: '4-Lane Expressway Spur Construction',
    landOwner: 'Sunil Deshmukh',
    owners: [{ name: 'Sunil Deshmukh', fatherName: 'Vasant Deshmukh', share: '1/1', contactNumber: '9822114477' }],
    location: { type: 'Point', coordinates: [74.5812, 18.1512], latitude: 18.1512, longitude: 74.5812 },
    affectedFamilies: 2,
    displacedFamilies: 0,
    acquisitionStatus: 'SUBMITTED',
    status: 'SUBMITTED',
    createdBy: userMap['PROJ-001']._id,
    submittedBy: userMap['PROJ-001']._id,
    submittedByUserId: 'PROJ-001',
    createdAt: new Date(Date.now() - 6 * 24 * 3600 * 1000),
  });
  console.log('✓ Case 1 seeded: LA-2026-0001 (Stage: SUBMITTED)');

  // ── CASE 2: LA-2026-0002 (State Review / Level 2) ──────────────────────────
  const case2 = await LandRecord.create({
    requestId: 'LA-2026-0002',
    projectName: 'Pune Outer Ring Road Project',
    projectId: 'PORR-2026-PH1',
    surveyNumber: '78/1A',
    subDivision: '1',
    khataNumber: 'KH-3910',
    state: 'Maharashtra',
    district: 'Pune',
    taluka: 'Haveli',
    village: 'Haveli',
    area: { total: 28.6, totalNumeric: 28.6, unit: 'Ha' },
    landType: 'Agricultural',
    occupancyClass: 'Bhogvatdar Class 1',
    acquisitionPurpose: 'Ring Road Bypass Corridor',
    landOwner: 'Anil Kulkarni',
    owners: [{ name: 'Anil Kulkarni', fatherName: 'Dattatray Kulkarni', share: '1/1', contactNumber: '9822336699' }],
    location: { type: 'Point', coordinates: [73.8567, 18.5204], latitude: 18.5204, longitude: 73.8567 },
    affectedFamilies: 3,
    displacedFamilies: 0,
    acquisitionStatus: 'STATE_APPROVAL',
    status: 'STATE_APPROVAL',
    createdBy: userMap['PROJ-001']._id,
    submittedBy: userMap['PROJ-001']._id,
    submittedByUserId: 'PROJ-001',
    createdAt: new Date(Date.now() - 4 * 24 * 3600 * 1000),
  });

  // Level 1 (District) Approved
  await Approval.create({
    requestId: case2.requestId,
    landRecordId: case2._id,
    authority: 'DISTRICT_AUTHORITY',
    approvalLevel: 1,
    action: 'FORWARDED',
    status: 'FORWARDED',
    reviewerId: userMap['DIST-001']._id,
    reviewerRole: 'DISTRICT_AUTHORITY',
    remarks: 'District scrutiny complete. Demarcations verified. Forwarded to State.',
    reviewedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
  });

  // Level 2 (State) Pending
  await Approval.create({
    requestId: case2.requestId,
    landRecordId: case2._id,
    authority: 'STATE_AUTHORITY',
    approvalLevel: 2,
    action: 'PENDING',
    status: 'PENDING',
    remarks: 'Awaiting State Principal Secretary endorsement for Central submission.',
  });
  console.log('✓ Case 2 seeded: LA-2026-0002 (Stage: STATE_APPROVAL)');

  // ── CASE 3: LA-2026-0003 (GOLDEN DEMO CASE) ────────────────────────────────
  const case3 = await LandRecord.create({
    requestId: 'LA-2026-0003',
    projectName: 'Greenfield Expressway',
    projectId: 'GFE-2026-MH-01',
    surveyNumber: '142/8',
    subDivision: 'A',
    khataNumber: 'KH-8821',
    state: 'Maharashtra',
    district: 'Nashik',
    taluka: 'Sinnar',
    village: 'Sinnar',
    area: { total: 45.2, totalNumeric: 45.2, unit: 'Ha' },
    landType: 'Agricultural',
    occupancyClass: 'Bhogvatdar Class 1',
    acquisitionPurpose: 'Greenfield National Highway 4-Lane Expansion',
    landOwner: 'Ramesh Patil',
    owners: [{
      name: 'Ramesh Patil',
      fatherName: 'Tukaram Patil',
      share: '1/1',
      contactNumber: '9822012345',
      userId: 'LAND-001',
    }],
    landOwnerUserId: userMap['LAND-001']._id,
    createdBy: userMap['PROJ-001']._id,
    submittedBy: userMap['PROJ-001']._id,
    submittedByUserId: 'PROJ-001',
    location: { type: 'Point', coordinates: [73.9921, 19.8512], latitude: 19.8512, longitude: 73.9921 },
    affectedFamilies: 1,
    displacedFamilies: 0,
    acquisitionStatus: 'DISTRICT_APPROVAL',
    status: 'DISTRICT_APPROVAL',
    notificationNumber: 'NOTIF/2026/LA-0003',
    notificationDate: new Date(Date.now() - 3 * 24 * 3600 * 1000),
    notificationType: 'SECTION_11',
    notificationStatus: 'ISSUED',
    awardNumber: 'AWD/NSK/2026-442',
    awardDate: new Date(Date.now() - 2 * 24 * 3600 * 1000),
    awardAmount: 28500000,
    awardStatus: 'DECLARED',
    possessionStatus: 'POSSESSION_PENDING',
    rrStatus: 'IN_PROGRESS',
    rehabilitationStatus: 'IN_PROGRESS',
    resettlementStatus: 'COMPLETED',
    benefitsProvided: ['Statutory solatium and direct farmer rehabilitation package'],
    createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
  });

  // Attach Document: 7/12 Satbara Extract
  const doc3 = await Document.create({
    documentId: 'DOC-2026-0003',
    landRecordId: case3._id,
    landParcelId: case3.requestId,
    acquisitionRequestId: case3.requestId,
    documentType: '712_EXTRACT',
    fileName: '7_12_Extract_142_8_Nashik.pdf',
    originalFileName: '7_12_Extract_Nashik_Sinnar_142_8.pdf',
    originalName: '7_12_Extract_Nashik_Sinnar_142_8.pdf',
    storedName: '7_12_Extract_142_8_Nashik.pdf',
    fileSize: 1845200,
    mimeType: 'application/pdf',
    fileHash: 'sha256:7b5d92e8c201f308d98d28e7e1262d168536fa2c1a84f39185a86d5e71829104',
    hash: '7b5d92e8c201f308d98d28e7e1262d168536fa2c1a84f39185a86d5e71829104',
    uploadedBy: 'PROJ-001',
    ownerId: 'LAND-001',
    storageProvider: 'local',
    storageKey: 'storage/documents/7_12_Extract_142_8_Nashik.pdf',
    processingStatus: 'VERIFIED',
    verificationStatus: 'VERIFIED',
  });

  // Attach Document Extraction with the 142/3 flag @ 61% confidence
  await DocumentExtraction.create({
    documentId: doc3.documentId,
    extractedData: {
      surveyNumber: '142/3',
      ownerName: 'रमेश तुकाराम पाटील',
      area: '45.2 हेक्टर',
      village: 'सिन्नर',
      district: 'नाशिक',
    },
    fields: {
      surveyNumber: {
        value: '142/3',
        confidence: 0.61,
        isLowConfidence: true,
        sourceText: 'सर्व्हे क्र. १४२/३',
        suggestedCorrection: '142/8',
      },
      ownerName: {
        value: 'रमेश तुकाराम पाटील',
        confidence: 0.96,
        sourceText: 'खातेदार: रमेश तुकाराम पाटील',
      },
      area: {
        value: '45.2 हेक्टर',
        confidence: 0.94,
        sourceText: 'क्षेत्र: ४५.२ हेक्टर',
      },
      village: {
        value: 'सिन्नर',
        confidence: 0.98,
        sourceText: 'गाव: सिन्नर',
      },
      district: {
        value: 'नाशिक',
        confidence: 0.99,
        sourceText: 'जिल्हा: नाशिक',
      },
    },
    confidenceScores: {
      surveyNumber: 0.61,
      ownerName: 0.96,
      area: 0.94,
      village: 0.98,
      district: 0.99,
    },
    overallConfidence: 0.896,
    needsReview: true,
  });

  // Attach Verification record
  await Verification.create({
    requestId: case3.requestId,
    landRecordId: case3._id,
    documentId: doc3._id,
    aiSnapshot: {
      surveyNumber: '142/3',
      ownerName: 'रमेश तुकाराम पाटील',
      area: '45.2 हेक्टर',
      village: 'सिन्नर',
      district: 'नाशिक',
    },
    verifiedBy: userMap['VERIF-001']._id,
    verificationStatus: 'VERIFIED',
    decision: 'VERIFIED',
    status: 'VERIFIED',
    notes: 'Cross-checked 7/12 scan: OCR flagged 142/3 at 61% confidence due to low ink contrast; human officer verified survey number is 142/8. Area 45.2 Ha and Ramesh Patil ownership confirmed.',
    verifiedAt: new Date(Date.now() - 2 * 24 * 3600 * 1000),
  });

  // Attach Level 1 Approval in pending state for District Collector
  await Approval.create({
    requestId: case3.requestId,
    landRecordId: case3._id,
    authority: 'DISTRICT_AUTHORITY',
    approvalLevel: 1,
    action: 'PENDING',
    status: 'PENDING',
    remarks: 'Dispatched from Data Checker. Awaiting District Collector review & forwarding to State.',
  });

  // Attach Compensation Assessment (₹2.85 Crore)
  await Compensation.create({
    requestId: case3.requestId,
    landRecordId: case3._id,
    assessedAmount: 28500000,
    approvedAmount: 28500000,
    currency: 'INR',
    paymentStatus: 'ASSESSED',
    status: 'ASSESSED',
    assessedBy: userMap['FIN-001']._id,
    valuationBreakdown: {
      marketValue: 14250000,
      solatium: 14250000,
      assets: 0,
      ratePerSqMeter: 315,
    },
    remarks: 'RFCTLARR 2013 Valuation: Base Land Market Value ₹1,42,50,000 + 100% Solatium ₹1,42,50,000 = ₹2,85,00,000.',
  });

  // Attach Audit Log trail
  await auditService.log({
    action: 'LAND_RECORD_CREATED',
    entityType: 'LAND_RECORD',
    entityId: String(case3._id),
    requestId: 'LA-2026-0003',
    userId: userMap['PROJ-001']._id,
    userEmail: userMap['PROJ-001'].email,
    role: 'PROJECT_OFFICER',
    metadata: { projectName: 'Greenfield Expressway', surveyNumber: '142/8', area: '45.2 Ha' },
  });

  await auditService.log({
    action: 'AI_PROCESS_COMPLETED',
    entityType: 'DOCUMENT',
    entityId: String(doc3._id),
    requestId: 'LA-2026-0003',
    userId: userMap['PROJ-001']._id,
    userEmail: 'ai-engine@lrvs.gov.in',
    role: 'SYSTEM',
    metadata: { flaggedField: 'surveyNumber', ocrValue: '142/3', confidence: 0.61 },
  });

  await auditService.log({
    action: 'VERIFICATION_COMPLETED',
    entityType: 'LAND_RECORD',
    entityId: String(case3._id),
    requestId: 'LA-2026-0003',
    userId: userMap['VERIF-001']._id,
    userEmail: userMap['VERIF-001'].email,
    role: 'VERIFICATION_OFFICER',
    metadata: { correctedFrom: '142/3', correctedTo: '142/8', remarks: 'Verified against physical 7/12 extract' },
  });
  console.log('✓ Golden Demo Case seeded: LA-2026-0003 (Stage: DISTRICT_APPROVAL)');

  // ── CASE 4: LA-2026-0004 (Compensation Paid / Possession Pending) ───────────
  const case4 = await LandRecord.create({
    requestId: 'LA-2026-0004',
    projectName: 'Samruddhi Mahamarg Expressway Extension',
    projectId: 'SME-2026-NSK',
    surveyNumber: '204/5',
    subDivision: 'C',
    khataNumber: 'KH-5512',
    state: 'Maharashtra',
    district: 'Nashik',
    taluka: 'Igatpuri',
    village: 'Igatpuri',
    area: { total: 31.0, totalNumeric: 31.0, unit: 'Ha' },
    landType: 'Agricultural',
    occupancyClass: 'Bhogvatdar Class 1',
    acquisitionPurpose: 'Expressway Interchange Toll Plaza',
    landOwner: 'Kisan Shinde',
    owners: [{ name: 'Kisan Shinde', fatherName: 'Maruti Shinde', share: '1/1', contactNumber: '9822778899' }],
    location: { type: 'Point', coordinates: [73.5583, 19.6967], latitude: 19.6967, longitude: 73.5583 },
    affectedFamilies: 2,
    displacedFamilies: 0,
    acquisitionStatus: 'COMPENSATION_PAID',
    status: 'COMPENSATION_PAID',
    createdBy: userMap['PROJ-001']._id,
    submittedBy: userMap['PROJ-001']._id,
    submittedByUserId: 'PROJ-001',
    notificationNumber: 'NOTIF/2026/LA-0004',
    notificationDate: new Date(Date.now() - 15 * 24 * 3600 * 1000),
    notificationStatus: 'ISSUED',
    awardNumber: 'AWD/NSK/2026-108',
    awardDate: new Date(Date.now() - 10 * 24 * 3600 * 1000),
    awardAmount: 19500000,
    awardStatus: 'DECLARED',
    possessionStatus: 'POSSESSION_PENDING',
    rrStatus: 'IN_PROGRESS',
    createdAt: new Date(Date.now() - 20 * 24 * 3600 * 1000),
  });

  await Compensation.create({
    requestId: case4.requestId,
    landRecordId: case4._id,
    assessedAmount: 19500000,
    approvedAmount: 19500000,
    currency: 'INR',
    paymentStatus: 'PAID',
    status: 'PAID',
    assessedBy: userMap['FIN-001']._id,
    disbursedBy: userMap['FIN-001']._id,
    paidAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
    disbursedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000),
    blockchainTxHash: '0x8b3941a5fe09d57a9f82cf0d4948a27d14e05b3819e917d23f46f88219c4391a',
    transactionReference: 'PFMS-SANDBOX-77192841',
    remarks: 'Direct Benefit Transfer completed via PFMS Sandbox to Kisan Shinde SBI A/c 30992144882.',
  });
  console.log('✓ Case 4 seeded: LA-2026-0004 (Stage: COMPENSATION_PAID)');

  // ── CASE 5: LA-2026-0005 (Closed Case / Immutable Archive) ─────────────────
  const case5 = await LandRecord.create({
    requestId: 'LA-2026-0005',
    projectName: 'Delhi-Mumbai Industrial Corridor (DMIC)',
    projectId: 'DMIC-AUR-PH2',
    surveyNumber: '91/4',
    subDivision: 'A',
    khataNumber: 'KH-9901',
    state: 'Maharashtra',
    district: 'Aurangabad',
    taluka: 'Aurangabad',
    village: 'Shendra',
    area: { total: 50.0, totalNumeric: 50.0, unit: 'Ha' },
    landType: 'Commercial',
    occupancyClass: 'Bhogvatdar Class 1',
    acquisitionPurpose: 'Industrial Smart City Logistics Hub',
    landOwner: 'Ganesh Jadhav',
    owners: [{ name: 'Ganesh Jadhav', fatherName: 'Ramdas Jadhav', share: '1/1', contactNumber: '9822445566' }],
    location: { type: 'Point', coordinates: [75.4611, 19.8762], latitude: 19.8762, longitude: 75.4611 },
    affectedFamilies: 4,
    displacedFamilies: 0,
    acquisitionStatus: 'CLOSED',
    status: 'CLOSED',
    createdBy: userMap['PROJ-001']._id,
    submittedBy: userMap['PROJ-001']._id,
    submittedByUserId: 'PROJ-001',
    notificationNumber: 'NOTIF/2025/LA-0091',
    notificationDate: new Date(Date.now() - 60 * 24 * 3600 * 1000),
    notificationStatus: 'ISSUED',
    awardNumber: 'AWD/AUR/2025-771',
    awardDate: new Date(Date.now() - 40 * 24 * 3600 * 1000),
    awardAmount: 32000000,
    awardStatus: 'DECLARED',
    possessionStatus: 'POSSESSION_COMPLETED',
    possessionDate: new Date(Date.now() - 20 * 24 * 3600 * 1000),
    possessionOfficer: 'Executive Engineer DMIC Shendra',
    possessionRemarks: 'Boundary pillars cemented, panchnama signed in presence of Talathi, handed over to industrial authority.',
    rrStatus: 'COMPLETED',
    rehabilitationStatus: 'COMPLETED',
    resettlementStatus: 'COMPLETED',
    benefitsProvided: ['One-time resettlement grant and employment assistance certificate'],
    createdAt: new Date(Date.now() - 90 * 24 * 3600 * 1000),
  });

  await Compensation.create({
    requestId: case5.requestId,
    landRecordId: case5._id,
    assessedAmount: 32000000,
    approvedAmount: 32000000,
    currency: 'INR',
    paymentStatus: 'PAID',
    status: 'PAID',
    assessedBy: userMap['FIN-001']._id,
    disbursedBy: userMap['FIN-001']._id,
    paidAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    blockchainTxHash: '0x1c947ff8231a47881c62e5b7218349bb8920194a283b7492c10928374a81b290',
    transactionReference: 'PFMS-SANDBOX-99104812',
    remarks: 'Disbursed in full. Case closed and locked.',
  });

  await auditService.log({
    action: 'CASE_CLOSED',
    entityType: 'LAND_RECORD',
    entityId: String(case5._id),
    requestId: 'LA-2026-0005',
    userId: userMap['CENTRAL-001']._id,
    userEmail: userMap['CENTRAL-001'].email,
    role: 'CENTRAL_AUTHORITY',
    metadata: { remarks: 'All statutory acquisition, compensation, and handover stages fully satisfied.' },
  });
  console.log('✓ Case 5 seeded: LA-2026-0005 (Stage: CLOSED)');

  console.log('\n======================================================');
  console.log(' DATABASE SEEDING COMPLETED SUCCESSFULLY');
  console.log('======================================================');
  console.log('Evaluator Demo Accounts (Password: Pass@1234):');
  console.log(' • CENTRAL-001 (Central Ministry)');
  console.log(' • STATE-001   (State Revenue Authority)');
  console.log(' • DIST-001    (District Collector Nashik)');
  console.log(' • VERIF-001   (Verification Scrutiny Officer)');
  console.log(' • PROJ-001    (Project Officer / Engineer)');
  console.log(' • FIN-001     (Finance Officer)');
  console.log(' • LAND-001    (Land Owner - Ramesh Patil)');
  console.log(' • SUPER-001   (System Administrator)');
  console.log('\nGolden Demo Case URL:');
  console.log(' http://localhost:9000/land/LA-2026-0003');
  console.log('======================================================\n');

  process.exit(0);
}

seedDatabase().catch((err) => {
  console.error('Fatal seeding error:', err);
  process.exit(1);
});
