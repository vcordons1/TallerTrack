import express from "express";

export function createApp({ checkReadiness = async () => false } = {}) {
  const app = express();

  app.disable("x-powered-by");

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

  return app;
}

const app = createApp();

export default app;
