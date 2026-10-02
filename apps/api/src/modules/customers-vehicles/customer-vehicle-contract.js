import { OperationalQueryError, positiveId } from "../../platform/operational-query-contract.js";

// Input DTOs of C02/C04/C05 and V02/V04/V06/V07 (API contract §3.1 and §4.2).
// Only type/length limits defined by the contract are enforced here. Contact, plate
// and VIN formats remain open under G-05: no regex may reject a legitimate value.

const VERSION = /^[1-9][0-9]{0,9}$/;
const PROFILE_FIELDS = Object.freeze({ nombre: 200, telefono: 30, email: 254, direccion: 500, nit: 30 });
const VEHICLE_TEXT_FIELDS = Object.freeze({ tipoVehiculo: 20, placa: 20, vin: 40, marca: 80, modelo: 80, color: 50 });
const VEHICLE_REQUIRED = Object.freeze(["tipoVehiculo", "marca", "modelo"]);
// Provisional G-05 normalization: trim + uppercase so case alone cannot duplicate an identifier.
const UPPERCASE_IDENTIFIERS = new Set(["placa", "vin"]);

function invalid(path, message) {
  const error = new OperationalQueryError("SOLICITUD_INVALIDA", message);
  error.fields = [{ path, code: "SOLICITUD_INVALIDA", message }];
  throw error;
}

function exactObject(value, path, required, optional = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid(path || "/", "Se esperaba un objeto.");
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) invalid(`${path}/${key}`, "Campo no permitido.");
  for (const key of required) if (!Object.hasOwn(value, key)) invalid(`${path}/${key}`, "Campo obligatorio.");
  return value;
}

function text(value, maximum, path, { nullable = false, uppercase = false } = {}) {
  if (value === null && nullable) return null;
  if (typeof value !== "string") invalid(path, "Debe ser texto.");
  let normalized = value.trim();
  if (uppercase) normalized = normalized.toUpperCase();
  if (normalized === "") invalid(path, "No puede quedar vacío.");
  if ([...normalized].length > maximum) invalid(path, `Máximo ${maximum} caracteres.`);
  return normalized;
}

function year(value, path) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 9999) invalid(path, "Año entre 1 y 9999.");
  return value;
}

export function parseVersion(value, path = "/versionEsperada") {
  if (typeof value !== "string" || !VERSION.test(value)) invalid(path, "Versión inválida.");
  return value;
}

function id(value, path) {
  try { return positiveId(value); } catch { return invalid(path, "Identificador inválido."); }
}

export function parseProfile(body) {
  exactObject(body, "", ["nombre"], ["telefono", "email", "direccion", "nit"]);
  return Object.fromEntries(Object.entries(PROFILE_FIELDS).map(([field, maximum]) =>
    [field, field === "nombre" ? text(body.nombre, maximum, "/nombre")
      : body[field] === undefined ? null : text(body[field], maximum, `/${field}`, { nullable: true })]));
}

function vehicleField(field, value, path) {
  if (field === "anio") return year(value, path);
  return text(value, VEHICLE_TEXT_FIELDS[field], path, {
    nullable: !VEHICLE_REQUIRED.includes(field), uppercase: UPPERCASE_IDENTIFIERS.has(field),
  });
}

export function parseVehicle(value, path = "/vehiculo") {
  exactObject(value, path, VEHICLE_REQUIRED, ["placa", "vin", "anio", "color"]);
  const vehicle = {};
  for (const field of ["tipoVehiculo", "placa", "vin", "marca", "modelo", "anio", "color"]) {
    vehicle[field] = value[field] === undefined ? null : vehicleField(field, value[field], `${path}/${field}`);
  }
  return vehicle;
}

function changes(body, fields, parseField) {
  exactObject(body, "", ["versionEsperada", "cambios"]);
  const version = parseVersion(body.versionEsperada);
  exactObject(body.cambios, "/cambios", [], fields);
  const entries = Object.entries(body.cambios);
  if (entries.length === 0) invalid("/cambios", "Indica al menos un cambio.");
  return { version, changes: Object.fromEntries(entries.map(([field, value]) =>
    [field, parseField(field, value, `/cambios/${field}`)])) };
}

export function parseProfileChanges(body) {
  return changes(body, Object.keys(PROFILE_FIELDS), (field, value, path) =>
    text(value, PROFILE_FIELDS[field], path, { nullable: field !== "nombre" }));
}

export function parseVehicleChanges(body) {
  return changes(body, ["tipoVehiculo", "placa", "vin", "marca", "modelo", "anio", "color"], vehicleField);
}

export function parseVehicleRegistration(body) {
  exactObject(body, "", ["vehiculo", "propietarioId", "motivoPropiedad"]);
  return {
    vehicle: parseVehicle(body.vehiculo),
    ownerId: id(body.propietarioId, "/propietarioId"),
    reason: text(body.motivoPropiedad, 1000, "/motivoPropiedad"),
  };
}

export function parseTransfer(body) {
  exactObject(body, "", ["propiedadEsperadaId", "propietarioEsperadoId", "nuevoPropietarioId", "motivo"]);
  return {
    expectedPropertyId: id(body.propiedadEsperadaId, "/propiedadEsperadaId"),
    expectedOwnerId: id(body.propietarioEsperadoId, "/propietarioEsperadoId"),
    newOwnerId: id(body.nuevoPropietarioId, "/nuevoPropietarioId"),
    reason: text(body.motivo, 1000, "/motivo"),
  };
}

export function parseDeactivation(body) {
  exactObject(body, "", ["versionEsperada", "motivo"]);
  return { version: parseVersion(body.versionEsperada), reason: text(body.motivo, 500, "/motivo") };
}
