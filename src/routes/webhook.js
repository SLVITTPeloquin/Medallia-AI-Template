import express from "express";
import { config } from "../config.js";
import {
  normalizeEmailEvent,
  normalizeSmsEvent,
  processInboundConversation
} from "../orchestrator.js";
import { buildReviewItem, upsertReviewItem } from "../services/review-store.js";

export const webhookRouter = express.Router();

function sandboxOnly(req, res, next) {
  if (config.enforceSandboxOnly && config.appEnv !== "sandbox") {
    return res.status(403).json({
      error: "sandbox_only",
      message: "This inbound preview pipeline is restricted to sandbox environment"
    });
  }

  return next();
}

function handleInbound(normalize) {
  return async (req, res) => {
    try {
      const envelope = normalize(req.body || {});
      const result = await processInboundConversation(envelope);
      const source = envelope.channel === "sms" ? "zingle" : "email";
      await upsertReviewItem(
        buildReviewItem({
          source,
          envelope,
          normalized: req.body || {},
          result,
          receivedAt: req.body.created_at || req.body.received_at || new Date().toISOString()
        })
      );
      return res.status(200).json(result);
    } catch (error) {
      const status = error.message.startsWith("Expected normalized") ? 400 : 500;
      return res.status(status).json({
        error: status === 400 ? "invalid_payload" : "pipeline_error",
        message: error.message
      });
    }
  };
}

webhookRouter.get("/health", (_req, res) => {
  res.json({ ok: true, app_env: config.appEnv });
});

webhookRouter.post("/webhooks/zingle/message", sandboxOnly, handleInbound(normalizeSmsEvent));
webhookRouter.post("/webhooks/zingle/sms", sandboxOnly, handleInbound(normalizeSmsEvent));
webhookRouter.post("/webhooks/zingle/email", sandboxOnly, handleInbound(normalizeEmailEvent));
