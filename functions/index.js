// Firestore-triggered wake dispatcher for local worker.
// Watches content_jobs for new work and sends a signed HTTPS wake to the Mac companion.

const crypto = require("crypto");
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const {
  REGION: CONTENT_MANAGER_REGION,
  createUpdateContentMetadataHandler,
  createUpdateContentReportStatusHandler,
} = require("./content_manager_admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const REGION = "northamerica-northeast1";
const ALLOWED_STATUSES = new Set(["pending", "publishing"]);
const DUP_WINDOW_MS = 5 * 60 * 1000;
const recent = new Map();

exports.updateContentMetadata = functions
  .region(CONTENT_MANAGER_REGION)
  .https.onCall(
    createUpdateContentMetadataHandler({
      adminLib: admin,
      functionsLib: functions,
    })
  );

exports.updateContentReportStatus = functions
  .region(CONTENT_MANAGER_REGION)
  .https.onCall(
    createUpdateContentReportStatusHandler({
      adminLib: admin,
      functionsLib: functions,
    })
  );

/**
 * Cleanup dedupe cache.
 */
function pruneRecent(now) {
  for (const [jobId, ts] of recent.entries()) {
    if (now - ts > DUP_WINDOW_MS) {
      recent.delete(jobId);
    }
  }
}

exports.dispatchWake = functions
  .region(REGION)
  .firestore.document("content_jobs/{jobId}")
  .onWrite(async (change, context) => {
    const after = change.after.exists ? change.after.data() : null;
    if (!after) return null;

    const before = change.before.exists ? change.before.data() : null;
    if (before && before.status === after.status) return null;

    const status = after.status;
    if (!ALLOWED_STATUSES.has(status)) return null;
    const endpoint =
      process.env.WAKE_ENDPOINT_URL || functions.config().wake?.endpoint;
    const secret =
      process.env.WAKE_SHARED_SECRET || functions.config().wake?.secret;

    if (!endpoint || !secret) {
      functions.logger.warn("Wake config missing; skipping dispatch", {
        endpoint_set: Boolean(endpoint),
        secret_set: Boolean(secret),
      });
      return null;
    }

    const now = Date.now();
    pruneRecent(now);
    const jobId = context.params.jobId;
    const last = recent.get(jobId);
    if (last && now - last < DUP_WINDOW_MS) {
      functions.logger.debug("Wake skipped (duplicate window)", { jobId });
      return null;
    }

    const payload = {
      jobId,
      status,
      contentType: after.contentType,
      ttsModel: after.ttsModel,
      llmModel: after.llmModel,
    };
    const body = JSON.stringify(payload);
    const signature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wake-Signature": signature,
        },
        body,
      });

      if (!res.ok) {
        throw new Error(`Wake request failed with status ${res.status}`);
      }

      recent.set(jobId, now);
      functions.logger.info("Wake dispatched", {
        jobId,
        status,
        endpoint,
      });
    } catch (err) {
      functions.logger.error("Wake dispatch failed", {
        jobId,
        status,
        error: err.message,
      });
    }

    return null;
  });
