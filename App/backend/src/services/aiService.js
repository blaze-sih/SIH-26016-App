/**
 * LRVS — AI Service Adapter
 * Team BLAZE | SIH26016
 *
 * HTTP adapter for the Python AI microservice.
 * Manages ProcessingJob lifecycle and Document.aiStatus throughout.
 *
 * processDocument() never throws — on failure it returns
 * { success: false, job, error } so callers can decide how to respond.
 */

'use strict';

const axios = require('axios');
const ProcessingJob = require('../models/ProcessingJob');
const Document = require('../models/Document');
const { JOB_STATUS, DOCUMENT_AI_STATUS, CONFIDENCE_SOURCES } = require('../utils/constants');
const { hashObject } = require('../utils/hash');
const logger = require('../utils/logger');

// ── Marathi numeral → Arabic digit mapping ────────────────────────────────────
const MARATHI_DIGIT_MAP = {
  '०': '0',
  '१': '1',
  '२': '2',
  '३': '3',
  '४': '4',
  '५': '5',
  '६': '6',
  '७': '7',
  '८': '8',
  '९': '9',
};

/**
 * Replace Marathi/Devanagari numerals with ASCII Arabic digits.
 * Non-string values are returned unchanged.
 *
 * @param {*} str
 * @returns {string|*}
 */
function marathiToArabic(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/[०१२३४५६७८९]/g, (ch) => MARATHI_DIGIT_MAP[ch] || ch);
}

// ── Confidence map builder ────────────────────────────────────────────────────

/**
 * Build a per-field confidence map from the raw AI service response.
 *
 * If `aiResult.fieldConfidence` is present (AI provided scores), each entry
 * becomes { value, score, source: 'AI_SERVICE', rawValue: null, normalizedValue: null }.
 *
 * Otherwise, each field from `aiResult.extractedData` gets
 * { value, score: null, source: 'NOT_AVAILABLE', rawValue: null, normalizedValue: null }.
 *
 * @param {object} aiResult - Full AI service response object
 * @returns {object} fieldName → confidence entry
 */
function buildConfidenceMap(aiResult) {
  const map = {};

  if (aiResult.fieldConfidence && typeof aiResult.fieldConfidence === 'object') {
    for (const [field, entry] of Object.entries(aiResult.fieldConfidence)) {
      map[field] = {
        value: entry.value !== undefined ? entry.value : null,
        score: entry.score !== undefined ? entry.score : null,
        source: CONFIDENCE_SOURCES.AI_SERVICE,
        rawValue: null,
        normalizedValue: null,
      };
    }
    return map;
  }

  // Fallback: no confidence data from AI
  const extracted = (aiResult && aiResult.extractedData) || {};
  for (const [field, fieldValue] of Object.entries(extracted)) {
    map[field] = {
      value: fieldValue,
      score: null,
      source: CONFIDENCE_SOURCES.NOT_AVAILABLE,
      rawValue: null,
      normalizedValue: null,
    };
  }

  return map;
}

// ── AI response validator ─────────────────────────────────────────────────────

/**
 * Validate the parsed AI JSON response and normalise numeric area values.
 *
 * Checks performed:
 *   - extractedData must exist (hard failure)
 *   - owners must be an array (hard failure)
 *   - area must be an object with unit, total, cultivable, uncultivable (hard failure)
 *   - survey_number should not be empty (warning)
 *   - village_code when present should match /^\d{1,6}$/ (warning)
 *   - area.total when present should be parseable as a number (warning)
 *   - owners array must not contain non-objects (warning per bad entry)
 *
 * Normalisation:
 *   - area.total, area.cultivable, area.uncultivable: Marathi numerals → Arabic
 *     Stores rawValue and normalizedValue within each area sub-field object.
 *
 * @param {object} aiResult
 * @returns {{ isValid: boolean, warnings: object[], normalizedData: object }}
 */
function validateAIResponse(aiResult) {
  const warnings = [];

  // ── Hard checks ───────────────────────────────────────────────────────────
  if (!aiResult || !aiResult.extractedData || typeof aiResult.extractedData !== 'object') {
    return { isValid: false, warnings, normalizedData: {} };
  }

  const data = aiResult.extractedData;

  if (!Array.isArray(data.owners)) {
    return {
      isValid: false,
      warnings: [{ field: 'owners', type: 'VALIDATION_WARNING', message: 'owners must be an array' }],
      normalizedData: {},
    };
  }

  const area = data.area;
  if (
    !area ||
    typeof area !== 'object' ||
    !('unit' in area) ||
    !('total' in area) ||
    !('cultivable' in area) ||
    !('uncultivable' in area)
  ) {
    return {
      isValid: false,
      warnings: [
        {
          field: 'area',
          type: 'VALIDATION_WARNING',
          message: 'area must be an object with unit, total, cultivable, uncultivable',
        },
      ],
      normalizedData: {},
    };
  }

  // ── Soft checks (warnings only) ───────────────────────────────────────────
  if (!data.survey_number || String(data.survey_number).trim() === '') {
    warnings.push({
      field: 'survey_number',
      type: 'VALIDATION_WARNING',
      message: 'survey_number is empty or missing',
    });
  }

  if (data.village_code !== undefined && data.village_code !== null) {
    const villageCodeStr = String(data.village_code).trim();
    if (!/^\d{1,6}$/.test(villageCodeStr)) {
      warnings.push({
        field: 'village_code',
        type: 'VALIDATION_WARNING',
        message: `village_code "${villageCodeStr}" does not match expected pattern /^\\d{1,6}$/`,
      });
    }
  }

  if (area.total !== undefined && area.total !== null) {
    const normalizedTotal = marathiToArabic(String(area.total));
    if (isNaN(parseFloat(normalizedTotal))) {
      warnings.push({
        field: 'area.total',
        type: 'VALIDATION_WARNING',
        message: `area.total "${area.total}" cannot be parsed as a number`,
      });
    }
  }

  data.owners.forEach((owner, idx) => {
    if (typeof owner !== 'object' || owner === null || Array.isArray(owner)) {
      warnings.push({
        field: `owners[${idx}]`,
        type: 'VALIDATION_WARNING',
        message: `owners[${idx}] is not a valid object`,
      });
    }
  });

  // ── Normalise area numeric sub-fields ─────────────────────────────────────
  const normalizedData = JSON.parse(JSON.stringify(data)); // deep clone
  const areaFields = ['total', 'cultivable', 'uncultivable'];
  for (const fieldName of areaFields) {
    const rawVal = area[fieldName];
    if (rawVal !== undefined && rawVal !== null) {
      const normalizedVal = marathiToArabic(String(rawVal));
      // Expand each area field into an object that carries raw + normalized
      if (typeof normalizedData.area[fieldName] !== 'object') {
        normalizedData.area[fieldName] = {
          rawValue: rawVal,
          normalizedValue: normalizedVal,
        };
      } else {
        normalizedData.area[fieldName].rawValue = rawVal;
        normalizedData.area[fieldName].normalizedValue = normalizedVal;
      }
    }
  }

  return { isValid: true, warnings, normalizedData };
}

// ── Core processing function ──────────────────────────────────────────────────

/**
 * Trigger AI extraction for a document, managing the full job lifecycle.
 *
 * @param {string|import('mongoose').Types.ObjectId} documentId - Mongoose _id of the Document
 * @param {string} documentType
 * @param {string} filePath       - Absolute path to the stored file
 * @param {string} [language]     - Language code (default 'mr')
 * @param {*}      [triggeredBy]  - Mongoose ObjectId of the requesting user
 * @param {string} [requestId]    - Acquisition request UUID
 * @returns {Promise<import('mongoose').Document|{ success: false, job: object, error: string }>}
 */
async function processDocument(documentId, documentType, filePath, language, triggeredBy, requestId) {
  // ── Find the Document ───────────────────────────────────────────────────────
  const doc = await Document.findById(documentId);
  if (!doc) {
    const err = new Error(`Document not found: ${documentId}`);
    err.status = 404;
    throw err;
  }

  // ── Create ProcessingJob (QUEUED) ───────────────────────────────────────────
  let job = new ProcessingJob({
    documentId: doc._id,
    documentUUID: doc.documentId,
    requestId: requestId || doc.requestId,
    status: JOB_STATUS.QUEUED,
    progress: 0,
    language: language || 'mr',
    documentType,
    triggeredBy,
  });
  await job.save();

  // Mark document as queued
  doc.aiStatus = DOCUMENT_AI_STATUS.QUEUED;
  await doc.save();

  // ── Transition to PROCESSING ────────────────────────────────────────────────
  const startedAt = new Date();
  job.status = JOB_STATUS.PROCESSING;
  job.startedAt = startedAt;
  job.attempts = (job.attempts || 0) + 1;
  job.lastAttemptAt = startedAt;
  await job.save();

  doc.aiStatus = DOCUMENT_AI_STATUS.PROCESSING;
  await doc.save();

  logger.info('aiService.processDocument: starting AI extraction', {
    jobId: job.jobId,
    documentId: doc.documentId,
    documentType,
    filePath,
    requestId: job.requestId,
    attempt: job.attempts,
  });

  // ── Call AI microservice ────────────────────────────────────────────────────
  try {
    const aiServiceUrl = process.env.AI_SERVICE_URL;
    const timeoutMs = parseInt(process.env.AI_TIMEOUT_MS, 10) || 120000;
    const aiApiKey = process.env.AI_API_KEY;

    const response = await axios.post(
      `${aiServiceUrl}/process-document`,
      {
        documentId: doc.documentId,
        documentType,
        filePath,
        language: language || 'mr',
        schemaVersion: 'v1',
      },
      { 
        timeout: timeoutMs,
        headers: aiApiKey ? { 'X-API-Key': aiApiKey } : {}
      }
    );

    const responseData = response.data;

    // ── Validate & normalise AI response ───────────────────────────────────
    const { isValid, warnings, normalizedData } = validateAIResponse(responseData);

    const aiResultHash = hashObject(normalizedData);
    const processingTimeMs = Date.now() - startedAt.getTime();

    // ── Update ProcessingJob as COMPLETED ──────────────────────────────────
    job.status = JOB_STATUS.COMPLETED;
    job.progress = 100;
    job.completedAt = new Date();
    job.processingTimeMs = processingTimeMs;
    job.aiRawResponse = responseData;
    job.extractedData = normalizedData;
    job.modelName = responseData.model || 'Qwen2.5-VL-7B-Instruct';
    job.modelVersion = 'configured-by-ai-service';
    job.schemaVersion = responseData.schemaVersion || 'v1';
    job.documentType = documentType;
    job.pagesProcessed = responseData.pagesProcessed || null;
    job.fieldConfidence = buildConfidenceMap(responseData);
    job.overallConfidence = responseData.overallConfidence || null;
    job.validationWarnings = warnings;
    job.aiWarnings = responseData.warnings || [];
    job.aiErrors = responseData.errors || [];
    job.aiResultHash = aiResultHash;
    await job.save();

    // ── Update Document ────────────────────────────────────────────────────
    doc.aiStatus = DOCUMENT_AI_STATUS.COMPLETED;
    doc.aiResultId = job._id;
    await doc.save();

    logger.info('aiService.processDocument: AI extraction completed', {
      jobId: job.jobId,
      documentId: doc.documentId,
      processingTimeMs,
      overallConfidence: job.overallConfidence,
      warningCount: warnings.length,
    });

    return job;
  } catch (err) {
    // ── Handle failure — update job & doc, do NOT rethrow ─────────────────
    const errorMessage = err.message || 'Unknown AI service error';

    try {
      job.status = JOB_STATUS.FAILED;
      job.error = errorMessage;
      job.completedAt = new Date();
      job.processingTimeMs = Date.now() - startedAt.getTime();
      await job.save();
    } catch (saveErr) {
      logger.error('aiService.processDocument: could not save failed job', { error: saveErr.message });
    }

    try {
      doc.aiStatus = DOCUMENT_AI_STATUS.FAILED;
      await doc.save();
    } catch (saveErr) {
      logger.error('aiService.processDocument: could not update document aiStatus to FAILED', {
        error: saveErr.message,
      });
    }

    logger.error('aiService.processDocument: AI extraction failed', {
      jobId: job.jobId,
      documentId: doc.documentId,
      error: errorMessage,
      isAxiosTimeout: err.code === 'ECONNABORTED',
      responseStatus: err.response ? err.response.status : null,
    });

    return { success: false, job, error: errorMessage };
  }
}

// ── Job status lookup ─────────────────────────────────────────────────────────

/**
 * Retrieve a ProcessingJob by its UUID jobId field.
 *
 * @param {string} jobId - UUID string stored in ProcessingJob.jobId
 * @returns {Promise<import('mongoose').Document>}
 * @throws {Error} 404 if not found
 */
async function getJobStatus(jobId) {
  const job = await ProcessingJob.findOne({ jobId });
  if (!job) {
    const err = new Error(`ProcessingJob not found: ${jobId}`);
    err.status = 404;
    throw err;
  }
  return job;
}

// ── Retry ─────────────────────────────────────────────────────────────────────

/**
 * Retry the latest FAILED processing job for a document.
 *
 * @param {string|import('mongoose').Types.ObjectId} documentId - Mongoose _id of the Document
 * @param {*} [triggeredBy] - Mongoose ObjectId of the requesting user
 * @returns {Promise<*>} Result of processDocument()
 * @throws {Error} If no failed job is found
 */
async function retryProcessing(documentId, triggeredBy) {
  const latestFailedJob = await ProcessingJob.findOne(
    { documentId, status: JOB_STATUS.FAILED },
    null,
    { sort: { createdAt: -1 } }
  );

  if (!latestFailedJob) {
    const err = new Error(`No failed ProcessingJob found for document: ${documentId}`);
    err.status = 404;
    throw err;
  }

  logger.info('aiService.retryProcessing: retrying failed job', {
    jobId: latestFailedJob.jobId,
    documentId: String(documentId),
    previousAttempts: latestFailedJob.attempts,
  });

  return processDocument(
    documentId,
    latestFailedJob.documentType,
    null, // filePath resolved from document inside processDocument
    latestFailedJob.language,
    triggeredBy,
    latestFailedJob.requestId
  );
}

module.exports = {
  processDocument,
  buildConfidenceMap,
  validateAIResponse,
  getJobStatus,
  retryProcessing,
  // exported for testing
  marathiToArabic,
};
