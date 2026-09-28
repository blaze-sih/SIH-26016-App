const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');

// Load env
dotenv.config();

// Connect to DB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/lrvs_demo', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('MongoDB Connected...');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

const User = require('../src/models/User');
const LandRecord = require('../src/models/LandRecord');
const Document = require('../src/models/Document');
const DocumentExtraction = require('../src/models/DocumentExtraction');
const Compensation = require('../src/models/Compensation');
const Approval = require('../src/models/Approval');

const seedData = async () => {
  await connectDB();
  console.log('Starting seed...');

  try {
    const passwordHash = await bcrypt.hash('Pass@1234', 10);

    const usersData = [
      { userId: 'CENTRAL-001', name: 'Central Ministry Official', role: 'CENTRAL_AUTHORITY', email: 'central.demo@lrvs.local', state: 'All', district: 'All' },
      { userId: 'STATE-001', name: 'State Revenue Officer', role: 'STATE_AUTHORITY', email: 'state.demo@lrvs.local', state: 'Maharashtra', district: 'All' },
      { userId: 'DIST-001', name: 'District Collector Nashik', role: 'DISTRICT_AUTHORITY', email: 'district.demo@lrvs.local', state: 'Maharashtra', district: 'Nashik' },
      { userId: 'VERIF-001', name: 'Verification Officer Kumar', role: 'VERIFICATION_OFFICER', email: 'verification.demo@lrvs.local', state: 'Maharashtra', district: 'Nashik' },
      { userId: 'PROJ-001', name: 'Project Officer Sharma', role: 'PROJECT_OFFICER', email: 'approval.demo@lrvs.local', state: 'Maharashtra', district: 'Nashik' },
      { userId: 'FIN-001', name: 'Finance Officer Mehta', role: 'FINANCE_OFFICER', email: 'finance.demo@lrvs.local', state: 'Maharashtra', district: 'Nashik' },
      { userId: 'LAND-001', name: 'Ramesh Patil', role: 'LAND_OWNER', email: 'landowner.demo@lrvs.local', state: 'Maharashtra', district: 'Nashik' },
      { userId: 'SUPER-001', name: 'System Administrator', role: 'SUPER_ADMIN', email: 'admin.demo@lrvs.local', state: 'All', district: 'All' }
    ];

    const users = {};
    for (const u of usersData) {
      let user = await User.findOne({ userId: u.userId });
      if (!user) {
        user = new User({ ...u, password: passwordHash, isActive: true });
        await user.save();
        console.log(`Created user: ${u.userId}`);
      } else {
        user.password = passwordHash;
        await user.save();
        console.log(`Updated user: ${u.userId}`);
      }
      users[u.userId] = user;
    }

    const landRecordsData = [
      {
        requestId: 'LRVS-DEMO-0001',
        surveyNumber: '142/8',
        village: 'Sinnar',
        taluka: 'Sinnar',
        district: 'Nashik',
        state: 'Maharashtra',
        projectName: 'Nashik Ring Road Phase 2',
        projectId: 'NRR-2026',
        acquisitionStatus: 'PENDING_VERIFICATION',
        area: { unit: 'Hectare', total: 2.5, totalNumeric: 2.5 },
        owners: [{ name: 'Ramesh Patil', fatherName: 'Vishwanath Patil', contactNumber: '9876543210' }],
        landOwnerUserId: users['LAND-001']._id,
        submittedBy: users['PROJ-001']._id,
        location: { type: 'Point', coordinates: [73.9, 19.96], latitude: 19.96, longitude: 73.9 }
      },
      {
        requestId: 'LRVS-DEMO-0002',
        surveyNumber: '87/3',
        village: 'Nandur',
        taluka: 'Sinnar',
        district: 'Nashik',
        state: 'Maharashtra',
        projectName: 'Metro Rail Nashik Corridor',
        projectId: 'MRN-2026',
        acquisitionStatus: 'COMPENSATION_PENDING',
        area: { unit: 'Hectare', total: 1.2, totalNumeric: 1.2 },
        owners: [{ name: 'Ramesh Patil', fatherName: 'Vishwanath Patil', contactNumber: '9876543210' }],
        landOwnerUserId: users['LAND-001']._id,
        submittedBy: users['PROJ-001']._id,
        location: { type: 'Point', coordinates: [73.95, 19.94], latitude: 19.94, longitude: 73.95 }
      }
    ];

    const landRecords = {};
    for (const lr of landRecordsData) {
      let record = await LandRecord.findOne({ requestId: lr.requestId });
      if (!record) {
        record = new LandRecord(lr);
        await record.save();
        console.log(`Created land record: ${lr.requestId}`);
      }
      landRecords[lr.requestId] = record;
    }

    const docsData = [
      {
        documentId: 'DOC-DEMO-00001',
        documentType: '7_12_EXTRACT',
        originalFileName: '7_12_Extract_Sinnar_142_8.pdf',
        mimeType: 'application/pdf',
        fileSize: 1024,
        storageProvider: 'LOCAL',
        storageKey: 'documents/LAND-001/LRVS-DEMO-0001/DOC-DEMO-00001/v1/7_12_extract.pdf',
        fileHash: 'dummyhash1',
        processingStatus: 'REVIEW_REQUIRED',
        verificationStatus: 'PENDING',
        ownerId: 'LAND-001',
        landParcelId: 'LRVS-DEMO-0001',
        acquisitionRequestId: 'LRVS-DEMO-0001',
        currentVersion: 1,
        uploadedBy: users['LAND-001']._id.toString(),
        landRecordId: landRecords['LRVS-DEMO-0001']._id
      },
      {
        documentId: 'DOC-DEMO-00002',
        documentType: 'OWNERSHIP_DOCUMENT',
        originalFileName: 'Ownership_Proof_Ramesh_Patil.pdf',
        mimeType: 'application/pdf',
        fileSize: 2048,
        storageProvider: 'LOCAL',
        storageKey: 'documents/LAND-001/LRVS-DEMO-0001/DOC-DEMO-00002/v1/ownership_proof.pdf',
        fileHash: 'dummyhash2',
        processingStatus: 'VERIFIED',
        verificationStatus: 'VERIFIED',
        ownerId: 'LAND-001',
        landParcelId: 'LRVS-DEMO-0001',
        acquisitionRequestId: 'LRVS-DEMO-0001',
        currentVersion: 1,
        uploadedBy: users['LAND-001']._id.toString(),
        landRecordId: landRecords['LRVS-DEMO-0001']._id
      }
    ];

    for (const d of docsData) {
      let doc = await Document.findOne({ documentId: d.documentId });
      if (!doc) {
        doc = new Document(d);
        await doc.save();
        console.log(`Created doc: ${d.documentId}`);
      }
    }

    let extraction = await DocumentExtraction.findOne({ documentId: 'DOC-DEMO-00001' });
    if (!extraction) {
      extraction = new DocumentExtraction({
        documentId: 'DOC-DEMO-00001',
        status: 'COMPLETED',
        modelName: 'lrvs-ai-vision-v2',
        fields: {
          ownerName: { value: 'Ramesh Patil', confidence: 0.97, isLowConfidence: false },
          surveyNumber: { value: '142/3', confidence: 0.61, isLowConfidence: true, suggestedCorrection: '142/8' },
          village: { value: 'Sinnar', confidence: 0.96 },
          district: { value: 'Nashik', confidence: 0.99 },
          landArea: { value: 2.5, unit: 'Hectare', confidence: 0.94 },
          fatherName: { value: 'Vishwanath Patil', confidence: 0.89 }
        }
      });
      await extraction.save();
      console.log(`Created extraction for DOC-DEMO-00001`);
    }

    let comp = await Compensation.findOne({ requestId: 'LRVS-DEMO-0002' });
    if (!comp) {
      comp = new Compensation({
        requestId: 'LRVS-DEMO-0002',
        landRecordId: landRecords['LRVS-DEMO-0002']._id,
        ownerName: 'Ramesh Patil',
        assessedAmount: 1245000,
        approvedAmount: 1245000,
        paymentStatus: 'APPROVED',
        paymentReference: 'RTGS-2026-009872',
        paymentMode: 'RTGS'
      });
      await comp.save();
      console.log(`Created compensation for LRVS-DEMO-0002`);
    }

    let approval = await Approval.findOne({ requestId: 'LRVS-DEMO-0001' });
    if (!approval) {
      approval = new Approval({
        requestId: 'LRVS-DEMO-0001',
        landRecordId: landRecords['LRVS-DEMO-0001']._id,
        approvalLevel: 1,
        action: 'PENDING'
      });
      await approval.save();
      console.log(`Created approval for LRVS-DEMO-0001`);
    }

    console.log('Seed completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error during seeding:', error);
    process.exit(1);
  }
};

seedData();
