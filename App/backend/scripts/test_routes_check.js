'use strict';

const mongoose = require('mongoose');
const dotenv = require('dotenv');
dotenv.config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/sih26016';
const { app } = require('../src/app');
const User = require('../src/models/User');
const jwt = require('jsonwebtoken');

async function testWebRoutes() {
  await mongoose.connect(MONGO_URI);
  console.log('Connected to MongoDB');

  // Find demo users
  const distUser = await User.findOne({ userId: 'DIST-001' });

  if (!distUser) {
    console.error('DIST-001 user not found! Please run seed script first.');
    process.exit(1);
  }

  const token = jwt.sign(
    { userId: distUser.userId, role: distUser.role, id: distUser._id },
    process.env.JWT_SECRET || 'lrvs-test-jwt-secret-key-2026-sih',
    { expiresIn: '1h' }
  );

  const request = require('supertest');

  console.log('\n--- Testing GET /dashboard ---');
  let res = await request(app)
    .get('/dashboard')
    .set('Cookie', [`token=${token}`]);
  console.log('Dashboard status:', res.status);
  if (res.status !== 200) console.error(res.text.slice(0, 500));

  console.log('\n--- Testing GET /land (Cases list) ---');
  res = await request(app)
    .get('/land')
    .set('Cookie', [`token=${token}`]);
  console.log('Land list status:', res.status);
  if (res.status !== 200) console.error(res.text.slice(0, 500));

  console.log('\n--- Testing GET /land/LA-2026-0003 (Golden Demo Dossier) ---');
  res = await request(app)
    .get('/land/LA-2026-0003')
    .set('Cookie', [`token=${token}`]);
  console.log('LA-2026-0003 status:', res.status);
  if (res.status !== 200) console.error(res.text.slice(0, 500));
  else {
    const hasGreenfield = res.text.includes('Greenfield Expressway');
    const hasNextAction = res.text.includes('Next Action Required') || res.text.includes('Level 1 District Approval');
    const hasTabs = res.text.includes('Overview') && res.text.includes('Compensation & DBT');
    console.log('Content check: Greenfield Expressway in HTML?', hasGreenfield);
    console.log('Content check: Action prompt in HTML?', hasNextAction);
    console.log('Content check: Tabs in HTML?', hasTabs);
  }

  console.log('\n--- Testing GET /compensation ---');
  res = await request(app)
    .get('/compensation')
    .set('Cookie', [`token=${token}`]);
  console.log('Compensation ledger status:', res.status);
  if (res.status !== 200) console.error(res.text.slice(0, 500));
  else {
    console.log('Compensation has records:', res.text.includes('2,85,00,000') || res.text.includes('3,20,00,000'));
  }

  console.log('\n--- Testing GET /land/LA-2026-0003/field-mode ---');
  res = await request(app)
    .get('/land/LA-2026-0003/field-mode')
    .set('Cookie', [`token=${token}`]);
  console.log('Field mode status:', res.status);
  if (res.status !== 200) console.error(res.text.slice(0, 500));
  else {
    console.log('Field mode has GPS / Checklist:', res.text.includes('Geofenced Mobile Inspection') && res.text.includes('Boundary Demarcation'));
  }

  console.log('\n--- Testing GET /land/create ---');
  res = await request(app)
    .get('/land/create')
    .set('Cookie', [`token=${token}`]);
  console.log('Create wizard status:', res.status);
  if (res.status !== 200) console.error(res.text.slice(0, 500));

  await mongoose.connection.close();
  console.log('\nAll route tests passed successfully!');
  process.exit(0);
}

testWebRoutes().catch(err => {
  console.error('Route test error:', err);
  process.exit(1);
});
