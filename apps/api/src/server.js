import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import oracledb from "oracledb";

import { createApp } from "./app.js";
import {
  loadOracleConfig,
  loadPort,
  loadPrivateFileConfig,
  loadUploadReceiptConfig,
  loadAuthConfig,
} from "./platform/config.js";
import { createOraclePoolManager } from "./platform/oracle-pool.js";
import { createPreparedPrivateUpload } from "./platform/prepared-private-upload.js";
import { createPrivateFileStorage } from "./platform/private-file-storage.js";
import { createReadinessCheck } from "./platform/readiness.js";
import { createTechnicalImageValidator } from "./platform/technical-image-validator.js";
import { createUploadReceiptSigner } from "./platform/upload-receipt.js";
import { createOpenCommercialOrder } from "./modules/service-orders/open-commercial-order.js";
import { createIdentityService } from "./modules/identity/identity-service.js";
import { createOracleIdentityRepository } from "./modules/identity/oracle-identity-repository.js";
import { createPasswordService } from "./modules/identity/passwords.js";
import { createTokenService } from "./modules/identity/tokens.js";

function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port);
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export function createShutdown({ server, poolManager, logger = console }) {
  let shutdownPromise;
  return function shutdown(signal) {
    if (shutdownPromise !== undefined) return shutdownPromise;

    shutdownPromise = (async () => {
      try {
        await closeServer(server);
      } finally {
        await poolManager.close();
      }
    })().catch((error) => {
      logger.error(`TallerTrack API shutdown failed after ${signal}`);
      process.exitCode = 1;
      throw error;
    });
    return shutdownPromise;
  };
}

export async function startServer({
  environment = process.env,
  driver = oracledb,
  logger = console,
  port = loadPort(environment),
} = {}) {
  const config = loadOracleConfig(environment);
  const authConfig = loadAuthConfig(environment);
  const privateFileConfig = loadPrivateFileConfig(environment);
  const uploadReceiptConfig = loadUploadReceiptConfig(environment);
  const privateFileStorage = createPrivateFileStorage({
    ...privateFileConfig,
    createHash,
  });
  await privateFileStorage.initialize();
  const receiptSigner = createUploadReceiptSigner(uploadReceiptConfig);
  const preparedUpload = createPreparedPrivateUpload({
    storage: privateFileStorage,
    validateTechnicalImage: createTechnicalImageValidator(privateFileConfig),
    receiptSigner,
  });
  const poolManager = createOraclePoolManager({ driver, config });
  await poolManager.initialize();
  const identityService = await createIdentityService({
    repository: createOracleIdentityRepository({ poolManager, schema: config.schema, driver }),
    passwordService: createPasswordService(),
    tokenService: createTokenService({ config: authConfig }),
    authConfig,
  });
  const openCommercialOrder = createOpenCommercialOrder({
    preparedUpload,
    poolManager,
    schema: config.schema,
    maximumFiles: privateFileConfig.maxFilesPerOperation,
    driver,
  });

  let server;
  try {
    const checkReadiness = createReadinessCheck({ poolManager, config });
    server = await listen(createApp({
      checkReadiness,
      identityService,
      preparedUpload,
      openCommercialOrder,
      privateFileConfig,
      logger,
    }), port);
  } catch (error) {
    await poolManager.close();
    throw error;
  }

  const shutdown = createShutdown({ server, poolManager, logger });
  process.once("SIGINT", () => { void shutdown("SIGINT").catch(() => {}); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM").catch(() => {}); });
  logger.log(`TallerTrack API listening on port ${server.address().port}`);
  return Object.freeze({
    server, poolManager, privateFileStorage, preparedUpload, openCommercialOrder,
    identityService, shutdown,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch(() => {
    console.error("TallerTrack API failed to start");
    process.exitCode = 1;
  });
}
