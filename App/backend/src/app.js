/**
 * LRVS Backend — Application Entry Point
 * Team BLAZE | SIH26016
 */

'use strict';

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const morgan = require('morgan');
const path = require('path');
const cookieParser = require('cookie-parser');

const logger = require('./utils/logger');
const { success, error } = require('./utils/apiResponse');
const errorMiddleware = require('./middleware/errorMiddleware');

// ── Route imports ────────────────────────────────────────────────────────────
const authRoutes = require('./routes/authRoutes');
const landRoutes = require('./routes/landRoutes');
const documentRoutes = require('./routes/documentRoutes');
const verificationRoutes = require('./routes/verificationRoutes');
const approvalRoutes = require('./routes/approvalRoutes');
const compensationRoutes = require('./routes/compensationRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const webRoutes = require('./routes/webRoutes');

// ── Services for system status ─────────────────────────────────────────────
const blockchainService = require('./services/blockchainService');

const app = express();

// ── Security middleware ──────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          'cdn.tailwindcss.com',
          'unpkg.com',
          'cdn.jsdelivr.net',
          'maps.googleapis.com',
          'maps.gstatic.com',
        ],
        scriptSrcAttr: ["'unsafe-inline'"],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          'cdn.tailwindcss.com',
          'unpkg.com',
          'cdn.jsdelivr.net',
          'fonts.googleapis.com',
          'maps.googleapis.com',
        ],
        fontSrc: ["'self'", 'fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https:', '*.tile.openstreetmap.org', '*.basemaps.cartocdn.com', 'maps.googleapis.com', 'maps.gstatic.com', '*.googleapis.com'],
        connectSrc: ["'self'", 'maps.googleapis.com', '*.googleapis.com', 'data:'],
        frameSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

const allowedOrigin = process.env.CORS_ORIGIN;
app.use(
  cors({
    origin: allowedOrigin && allowedOrigin !== '*' ? allowedOrigin : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});
app.use('/api/', limiter);

// ── Body parsers ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Cookie parser (required for browser auth) ─────────────────────────────
app.use(cookieParser());

// ── EJS view engine & Layouts ────────────────────────────────────────────────
const expressLayouts = require('express-ejs-layouts');
app.use(expressLayouts);
app.set('layout', 'layouts/layout');
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── View locals middleware ──────────────────────────────────────────────────
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.query = req.query;
  res.locals.currentUser = res.locals.currentUser || null;
  res.locals.googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY || '';
  res.locals.successMessage = req.query.success || null;
  res.locals.errorMessage = req.query.error || null;
  res.locals.flash = {
    success: req.query.success || null,
    error: req.query.error || null,
    info: req.query.info || null,
  };
  next();
});

// ── Static files (CSS, JS, images) ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── HTTP request logging ─────────────────────────────────────────────────────
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req) => req.url === '/api/health',
  })
);

// ── Secure document downloads (Section 7: No public static /uploads) ────────
// All document downloads must pass through authenticated authorization.
// Direct /uploads access is blocked; documents stream via /api/documents/:documentId/file.
app.use('/uploads', (_req, res) => {
  return res.status(403).json(error('Direct access to uploads directory is forbidden. Use authenticated document endpoints.', { code: 'FORBIDDEN' }, 403));
});

// ── Health endpoint ──────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus =
    dbState === 1 ? 'UP' : dbState === 2 ? 'CONNECTING' : 'DOWN';

  res.status(200).json(
    success('LRVS backend is running', {
      service: 'lrvs-backend',
      version: '1.0.0',
      team: 'Team BLAZE',
      problemStatement: 'SIH26016',
      timestamp: new Date().toISOString(),
      database: dbStatus,
    })
  );
});

// ── System status endpoint ──────────────────────────────────────────────────
app.get('/api/system/status', async (_req, res) => {
  const dbState = mongoose.connection.readyState;
  const dbStatus = dbState === 1 ? 'UP' : 'DOWN';

  let aiStatus = 'UNKNOWN';
  try {
    const axios = require('axios');
    await axios.get(`${process.env.AI_SERVICE_URL || 'http://localhost:8000'}/health`, {
      timeout: 3000,
    });
    aiStatus = 'UP';
  } catch {
    aiStatus = 'DOWN';
  }

  let blockchainStatus = 'UNKNOWN';
  try {
    const bcStatus = await blockchainService.getStatus();
    blockchainStatus = bcStatus;
  } catch {
    blockchainStatus = process.env.BLOCKCHAIN_MOCK === 'true' ? 'MOCK' : 'DOWN';
  }

  const fs = require('fs');
  const uploadDir = path.join(
    __dirname,
    '../../',
    process.env.UPLOAD_DIR || 'uploads'
  );
  const storageStatus = fs.existsSync(uploadDir) ? 'UP' : 'DEGRADED';

  const statusCode =
    dbStatus === 'DOWN' ? 503 : aiStatus === 'DOWN' ? 207 : 200;

  res.status(statusCode).json(
    success('System status', {
      backend: 'UP',
      database: dbStatus,
      aiService: aiStatus,
      blockchain: blockchainStatus,
      storage: storageStatus,
      timestamp: new Date().toISOString(),
    })
  );
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/land', landRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/verification', verificationRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/compensation', compensationRoutes);
app.use('/api/dashboard', dashboardRoutes);

// ── Browser / EJS Web Routes (MUST come after API routes) ───────────────────
app.use('/', webRoutes);

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  const accept = req.headers['accept'] || '';
  if (accept.includes('text/html')) {
    return res.status(404).render('errors/404', {
      title: 'Page Not Found',
      currentUser: res.locals.currentUser || null,
    });
  }
  res.status(404).json(
    error('Route not found', { code: 'NOT_FOUND', details: { path: req.path } }, 404)
  );
});

// ── Centralized error middleware ─────────────────────────────────────────────
app.use(errorMiddleware);

// ── Database connection & server start ───────────────────────────────────────
const PORT = process.env.PORT || 9000;

async function connectWithRetry() {
  const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sih26016';
  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });
    logger.info('✅ MongoDB connected', { uri: (process.env.MONGO_URI || process.env.MONGODB_URI) ? 'Configured (Atlas)' : 'Default local' });
  } catch (err) {
    logger.warn('⚠️ MongoDB connection attempt failed, will retry in 5s...', { error: err.message });
    setTimeout(connectWithRetry, 5000);
  }
}

async function startServer() {
  try {
    const fs = require('fs');
    const uploadDir = path.join(
      __dirname,
      '../../',
      process.env.UPLOAD_DIR || 'uploads'
    );
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const documentsDir = path.join(uploadDir, 'documents');
    if (!fs.existsSync(documentsDir)) {
      fs.mkdirSync(documentsDir, { recursive: true });
    }

    const HOST = '0.0.0.0';
    const server = app.listen(PORT, HOST, () => {
      logger.info(`🚀 LRVS Backend running on http://${HOST}:${PORT}`, {
        port: PORT,
        host: HOST,
        env: process.env.NODE_ENV,
        health: `/api/health`,
        web: `/login`,
      });
    });

    // Initiate MongoDB connection with automatic retry
    connectWithRetry();

    // Graceful shutdown
    process.on('SIGTERM', () => {
      logger.info('SIGTERM received. Gracefully shutting down...');
      server.close(async () => {
        await mongoose.connection.close();
        logger.info('Server and DB connection closed.');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      logger.info('SIGINT received. Shutting down...');
      server.close(async () => {
        await mongoose.connection.close();
        process.exit(0);
      });
    });

    return server;
  } catch (err) {
    logger.error('❌ Failed to start server', { error: err.message });
    process.exit(1);
  }
}

// Only start server if this is the main module (not during testing)
if (require.main === module) {
  startServer();
}

module.exports = { app, startServer };
