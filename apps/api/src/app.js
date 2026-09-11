import express from "express";

import { apiErrorHandler, createIdentityHttp, requestContext } from "./modules/identity/identity-http.js";

export function createApp({ checkReadiness = async () => false, identityService } = {}) {
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
    app.use("/api/v1", createIdentityHttp({ identityService }).router);
  }

  app.use(apiErrorHandler);

  return app;
}

const app = createApp();

export default app;
