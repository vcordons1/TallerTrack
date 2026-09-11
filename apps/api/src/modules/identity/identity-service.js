import { randomBytes } from "node:crypto";

import { createLoginRateLimit } from "./login-rate-limit.js";

const INTERNAL_ROLES = new Set(["ADMINISTRADOR", "RECEPCIONISTA", "MECANICO", "INVENTARIO"]);
const REFRESH_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export class IdentityError extends Error {
  constructor(code, message = "Access denied", options) {
    super(message, options);
    this.name = "IdentityError";
    this.code = code;
  }
}

function normalizeLogin(value) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 150) {
    throw new IdentityError("SOLICITUD_INVALIDA", "Login is invalid");
  }
  return value.trim().normalize("NFKC").toLowerCase();
}

function validatePassword(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 1024) {
    throw new IdentityError("SOLICITUD_INVALIDA", "Password is invalid");
  }
  return value;
}

function validateDevice(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim() === "" || value.length > 150) {
    throw new IdentityError("SOLICITUD_INVALIDA", "Device is invalid");
  }
  return value.trim();
}

function accessProjection(access) {
  return Object.freeze({
    usuarioId: String(access.userId),
    tipoActor: access.type,
    nombreMostrado: access.displayName,
    roles: Object.freeze([...access.roles]),
    clienteId: access.clientId === null ? null : String(access.clientId),
    sesionExpiraEn: access.sessionExpiresAt,
  });
}

export async function createIdentityService({
  repository,
  passwordService,
  tokenService,
  authConfig,
  clock = () => new Date(),
  rateLimit = createLoginRateLimit({
    maximumAttempts: authConfig.loginMaximumAttempts,
    windowSeconds: authConfig.loginWindowSeconds,
    capacity: authConfig.loginBucketCapacity,
  }),
}) {
  const dummyHash = await passwordService.hash(randomBytes(32).toString("base64url"));
  let activeHashVerifications = 0;

  async function verifyPassword(encodedHash, password) {
    if (activeHashVerifications >= authConfig.hashMaximumConcurrency) {
      throw new IdentityError("DEMASIADAS_SOLICITUDES", "Password verification capacity is busy");
    }
    activeHashVerifications += 1;
    try {
      return await passwordService.verify(encodedHash, password).catch(() => false);
    } finally {
      activeHashVerifications -= 1;
    }
  }

  async function issueTokens({ userId, sessionIdentifier, credentialVersion,
    sessionExpiresAt, refreshToken }) {
    const signed = await tokenService.issueAccessToken({ userId, sessionIdentifier, credentialVersion });
    return Object.freeze({
      accessToken: signed.accessToken,
      tokenType: "Bearer",
      accessExpiraEn: signed.accessExpiresAt.toISOString(),
      refreshToken,
      sesionExpiraEn: sessionExpiresAt,
    });
  }

  return Object.freeze({
    async login(input, clientAddress = "unknown") {
      const login = normalizeLogin(input.login);
      const password = validatePassword(input.password);
      const device = validateDevice(input.dispositivo);
      const allowance = rateLimit.consume(clientAddress, login);
      if (!allowance.allowed) {
        const error = new IdentityError("DEMASIADAS_SOLICITUDES", "Too many login attempts");
        error.retryAfterSeconds = allowance.retryAfterSeconds;
        throw error;
      }

      const credential = await repository.findInternalCredential(login);
      const accepted = await verifyPassword(credential?.passwordHash ?? dummyHash, password);
      if (!accepted || credential === null || credential.active !== 1) {
        throw new IdentityError("CREDENCIALES_INVALIDAS", "Invalid credentials");
      }

      const now = clock();
      const sessionIdentifier = tokenService.createSessionIdentifier();
      const refreshToken = tokenService.createRefreshToken();
      const sessionExpiresAt = new Date(now.getTime() + authConfig.sessionTtlSeconds * 1000);
      const refreshExpiresAt = new Date(now.getTime() + authConfig.refreshTtlSeconds * 1000);
      let access;
      try {
        access = await repository.createSession({
          userId: credential.userId,
          credentialVersion: credential.credentialVersion,
          sessionIdentifier,
          sessionExpiresAt,
          device,
          refreshHash: tokenService.hashRefreshToken(refreshToken),
          refreshExpiresAt,
        });
      } catch (error) {
        if (error.code === "CREDENCIALES_INVALIDAS") {
          throw new IdentityError("CREDENCIALES_INVALIDAS", "Invalid credentials", { cause: error });
        }
        throw error;
      }
      rateLimit.clear(clientAddress, login);
      return Object.freeze({
        tokens: await issueTokens({
          userId: credential.userId,
          sessionIdentifier,
          credentialVersion: credential.credentialVersion,
          sessionExpiresAt: access.sessionExpiresAt,
          refreshToken,
        }),
        acceso: accessProjection(access),
      });
    },

    async authenticate(accessToken) {
      let claims;
      try {
        claims = await tokenService.verifyAccessToken(accessToken);
      } catch (error) {
        throw new IdentityError("ACCESO_EXPIRADO", "Access token is invalid", { cause: error });
      }
      const access = await repository.validateSession(claims);
      if (access === null) throw new IdentityError("SESION_INVALIDA", "Session is invalid");
      return Object.freeze({ ...claims, ...access, acceso: accessProjection(access) });
    },

    async refresh(input, correlationId) {
      if (typeof input.refreshToken !== "string" || !REFRESH_TOKEN.test(input.refreshToken)) {
        throw new IdentityError("RENOVACION_INVALIDA", "Refresh token is invalid");
      }
      const successor = tokenService.createRefreshToken();
      const successorExpiresAt = new Date(clock().getTime() + authConfig.refreshTtlSeconds * 1000);
      const result = await repository.rotateRefresh({
        refreshHash: tokenService.hashRefreshToken(input.refreshToken),
        successorHash: tokenService.hashRefreshToken(successor),
        successorExpiresAt,
        correlationId,
      });
      if (result.outcome !== "ROTADA") {
        throw new IdentityError("RENOVACION_INVALIDA", "Refresh token is invalid");
      }
      return issueTokens({
        userId: result.userId,
        sessionIdentifier: result.sessionIdentifier,
        credentialVersion: result.credentialVersion,
        sessionExpiresAt: result.sessionExpiresAt,
        refreshToken: successor,
      });
    },

    async logout(context, correlationId) {
      const revoked = await repository.revokeSession({ ...context, correlationId });
      if (!revoked) throw new IdentityError("SESION_INVALIDA", "Session is invalid");
    },

    accessProjection,
  });
}

export function requireAnyRole(...requiredRoles) {
  if (requiredRoles.length === 0 || requiredRoles.some((role) => !INTERNAL_ROLES.has(role))) {
    throw new TypeError("At least one valid internal role is required");
  }
  return function roleAuthorization(request, _response, next) {
    if (request.auth?.type !== "INTERNO"
      || !requiredRoles.some((role) => request.auth.roles.includes(role))) {
      next(new IdentityError("ACCION_NO_PERMITIDA", "The current role cannot perform this action"));
      return;
    }
    next();
  };
}
