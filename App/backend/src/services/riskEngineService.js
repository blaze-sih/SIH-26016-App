/**
 * LRVS — Delay & Risk Prediction Engine (Prototype Mode)
 * Team BLAZE | SIH26016
 *
 * Transparent rule-based decision support system for predicting
 * bottlenecks, document discrepancies, and approval delays.
 */

'use strict';

const { ACQUISITION_STATUS } = require('../utils/constants');

/**
 * Assess delay risk for a land acquisition case.
 *
 * @param {object} record - LandRecord document/object
 * @param {object} [options]
 * @param {object[]} [options.documents] - Associated Document records
 * @param {object} [options.extraction] - DocumentExtraction record
 * @param {object[]} [options.approvals] - Approval records
 * @param {object} [options.compensation] - Compensation record
 * @returns {object} { riskLevel: 'LOW'|'MEDIUM'|'HIGH', riskScore: number, reasons: string[], suggestedAction: string }
 */
function assessCaseRisk(record, { documents = [], extraction = null, approvals = [], compensation = null } = {}) {
  const reasons = [];
  let riskScore = 15; // baseline low risk

  if (!record) {
    return {
      riskLevel: 'LOW',
      riskScore: 0,
      reasons: ['No record loaded'],
      suggestedAction: 'Create or select a valid case',
    };
  }

  const status = record.acquisitionStatus || 'DRAFT';
  const ageDays = record.createdAt
    ? Math.max(1, Math.round((Date.now() - new Date(record.createdAt).getTime()) / (1000 * 60 * 60 * 24)))
    : 1;

  // 1. Check Document & AI Extraction Risks
  if (['SUBMITTED', 'PENDING_VERIFICATION', 'AI_PROCESSED', 'AI_PROCESSING'].includes(status)) {
    if (!documents || documents.length === 0) {
      riskScore += 35;
      reasons.push('No title deed or 7/12 extract uploaded yet');
    }

    if (extraction && extraction.fields) {
      let hasLowConf = false;
      for (const [key, field] of Object.entries(extraction.fields)) {
        if (field && (field.isLowConfidence || (field.confidence && field.confidence < 0.75))) {
          hasLowConf = true;
          reasons.push(`Low AI extraction confidence on ${key} (${Math.round((field.confidence || 0.6) * 100)}%)`);
        }
      }
      if (hasLowConf) {
        riskScore += 25;
      }
    }
  }

  // 2. Check Approval Pipeline Bottlenecks
  if (status === 'DISTRICT_APPROVAL') {
    riskScore += 20;
    reasons.push('District Collectorate scrutiny pending; State approval not yet initiated');
  } else if (status === 'STATE_APPROVAL') {
    riskScore += 25;
    reasons.push('State Revenue Department escalation pending Central submission');
  } else if (status === 'CENTRAL_APPROVAL') {
    riskScore += 20;
    reasons.push('Central Ministry final sanction pending');
  }

  // 3. Compensation & Disbursement Risks
  if (status === 'COMPENSATION_PENDING') {
    riskScore += 25;
    reasons.push('Valuation declared; Finance Officer disbursement sanction pending');
  } else if (status === 'COMPENSATION_APPROVED' && (!compensation || compensation.paymentStatus !== 'PAID')) {
    riskScore += 20;
    reasons.push('Payment release pending for registered land owner');
  }

  // 4. Physical Possession & R&R Risks
  if (status === 'POSSESSION_PENDING') {
    riskScore += 25;
    reasons.push('Ground survey, boundary demarcation & panchnama pending');
  }

  if (record.affectedFamilies > 10 && (!record.rrStatus || record.rrStatus === 'NOT_STARTED')) {
    riskScore += 20;
    reasons.push(`${record.affectedFamilies} affected families identified; R&R plan not yet executed`);
  }

  // 5. Age-based escalation
  if (ageDays > 5 && status !== ACQUISITION_STATUS.CLOSED) {
    riskScore += 15;
    reasons.push(`Case active for ${ageDays} days across multi-tier workflow`);
  }

  // Clamp score
  riskScore = Math.min(95, Math.max(10, riskScore));

  // Closed cases always low risk
  if (status === ACQUISITION_STATUS.CLOSED) {
    return {
      riskLevel: 'LOW',
      riskScore: 5,
      reasons: ['Case successfully closed. All statutory and compensation milestones fulfilled.'],
      suggestedAction: 'Dossier archived for audit and CAG compliance.',
    };
  }

  let riskLevel = 'LOW';
  let suggestedAction = 'Proceed with normal processing according to SOP.';

  if (riskScore >= 60) {
    riskLevel = 'HIGH';
    suggestedAction = reasons.some(r => r.includes('confidence'))
      ? 'Perform immediate human verification of survey numbers and cadastral boundaries.'
      : 'Expedite pending authority decision to prevent schedule slippage.';
  } else if (riskScore >= 35) {
    riskLevel = 'MEDIUM';
    if (status === 'DISTRICT_APPROVAL') {
      suggestedAction = 'District Authority should review survey number 142/8 and forward to State Authority today.';
    } else if (status === 'PENDING_VERIFICATION') {
      suggestedAction = 'Verification Officer review recommended within 24 hours.';
    } else if (status === 'COMPENSATION_PENDING' || status === 'COMPENSATION_APPROVED') {
      suggestedAction = 'Finance Officer should process direct bank transfer / sandbox release.';
    } else {
      suggestedAction = 'Review pending checklist items to advance case to next stage.';
    }
  }

  return {
    riskLevel,
    riskScore,
    reasons: reasons.length > 0 ? reasons : ['Workflow progressing within normal statutory SLA intervals'],
    suggestedAction,
  };
}

module.exports = {
  assessCaseRisk,
};
