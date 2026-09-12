import express from "express";

import { apiErrorHandler, createIdentityHttp, requestContext } from "./modules/identity/identity-http.js";
import { createReceptionHttp } from "./modules/reception/reception-http.js";

export function createApp({
  checkReadiness = async () => false,
  identityService,
  preparedUpload,
  openCommercialOrder,
  privateFileConfig,
  logger,
} = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(requestContext);

  app.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/health/ready", async (_request, response) => {
    try {
      if (await checkReadiness()) {
        response.status(200).json({ status: "ready" });
        return;
      }
    } catch {
      // Health responses deliberately hide infrastructure details.
    }

    response.status(503).json({ status: "not_ready" });
  });

  if (identityService !== undefined) {
    const identityHttp = createIdentityHttp({ identityService });
    if (preparedUpload !== undefined || openCommercialOrder !== undefined) {
      app.use("/api/v1", createReceptionHttp({
        identityService,
        requireAuthenticated: identityHttp.requireAuthenticated,
        preparedUpload,
        openCommercialOrder,
        privateFileConfig,
      }).router);
    }
    app.use("/api/v1", identityHttp.router);
  }

  app.use((error, request, response, next) => apiErrorHandler(error, request, response, next, logger));

  return app;
}

const app = createApp();

export default app;
