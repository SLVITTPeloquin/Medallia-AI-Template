import express from "express";
import { config, assertEnvironmentGuards } from "./config.js";
import { webhookRouter } from "./routes/webhook.js";
import { adminRouter } from "./routes/admin.js";

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(webhookRouter);
app.use(adminRouter);
app.use("/admin", express.static("public/admin"));

app.use((error, _req, res, _next) => {
  console.error("[error]", error);
  res.status(500).json({
    error: "server_error",
    message: error.message
  });
});

assertEnvironmentGuards();

app.listen(config.port, () => {
  console.log(`[startup] medallia-ai-template listening on :${config.port}`);
  console.log(`[startup] app_env=${config.appEnv} node_env=${config.nodeEnv}`);
});
