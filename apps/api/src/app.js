import express from "express";

import { apiErrorHandler, createIdentityHttp, requestContext } from "./modules/identity/identity-http.js";
import { createReceptionHttp } from "./modules/reception/reception-http.js";
import { createOperationalQueryHttp } from "./modules/operational-query-http.js";
import { createFreeDiagnosticHttp } from "./modules/service-orders/free-diagnostic-http.js";
import { createInternalUsersHttp } from "./modules/identity/internal-users-http.js";
import { createCustomerVehicleHttp } from "./modules/customers-vehicles/customer-vehicle-http.js";

export function createApp({
  checkReadiness = async () => false,
  identityService,
  preparedUpload,
  openCommercialOrder,
  privateFileConfig,
  customerVehicleQueries,
  customerVehicleCommands,
  orderQueries,
  cursorCodec,
  freeDiagnosticRepository,
  internalUsers,
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
    if (internalUsers !== undefined) app.use("/api/v1", createInternalUsersHttp({
      requireAuthenticated: identityHttp.requireAuthenticated, repository: internalUsers, cursorCodec,
    }));
    if (customerVehicleCommands !== undefined) {
      app.use("/api/v1", createCustomerVehicleHttp({
        requireAuthenticated: identityHttp.requireAuthenticated,
        queries: customerVehicleQueries,
        commands: customerVehicleCommands,
        cursorCodec,
      }).router);
    }
    if (customerVehicleQueries !== undefined || orderQueries !== undefined) {
      app.use("/api/v1", createOperationalQueryHttp({
        requireAuthenticated: identityHttp.requireAuthenticated,
        customerVehicleQueries,
        orderQueries,
        cursorCodec,
      }).router);
    }
    if (preparedUpload !== undefined || openCommercialOrder !== undefined) {
      app.use("/api/v1", createReceptionHttp({
        identityService,
        requireAuthenticated: identityHttp.requireAuthenticated,
        preparedUpload,
        openCommercialOrder,
        privateFileConfig,
      }).router);
    }
    if (freeDiagnosticRepository !== undefined) {
      app.use("/api/v1", createFreeDiagnosticHttp({
        requireAuthenticated: identityHttp.requireAuthenticated,
        repository: freeDiagnosticRepository,
        cursorCodec,
      }).router);
    }
    app.use("/api/v1", identityHttp.router);
  }

  app.use((error, request, response, next) => apiErrorHandler(error, request, response, next, logger));

  return app;
}

const app = createApp();

export default app;
