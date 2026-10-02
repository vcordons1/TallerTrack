// Form ⇄ DTO rules for C02/C04/V02/V04/V06 (API contract §3.1). Only contract limits are
// checked locally; plate/VIN/contact formats stay open under G-05, so no regex rejects a
// legitimate value. Authority (owner, QR, state, actor) never comes from these forms.

const PROFILE_LIMITS = Object.freeze({ nombre: 200, telefono: 30, email: 254, direccion: 500, nit: 30 });
const VEHICLE_LIMITS = Object.freeze({ tipoVehiculo: 20, placa: 20, vin: 40, marca: 80, modelo: 80, color: 50 });
const UPPERCASE = new Set(["placa", "vin"]);

const length = (value) => [...value].length;
const clean = (value) => (typeof value === "string" ? value.trim() : "");

function profileValue(field, value) {
  const trimmed = clean(value);
  return trimmed === "" ? null : trimmed;
}

function vehicleValue(field, value) {
  if (field === "anio") return clean(String(value ?? "")) === "" ? null : Number(clean(String(value)));
  const trimmed = clean(value);
  if (trimmed === "") return null;
  return UPPERCASE.has(field) ? trimmed.toUpperCase() : trimmed;
}

function validateCustomerForm(form) {
  const errors = {};
  for (const [field, maximum] of Object.entries(PROFILE_LIMITS)) {
    const value = clean(form[field]);
    if (field === "nombre" && value === "") errors.nombre = "Ingresa el nombre del cliente.";
    else if (length(value) > maximum) errors[field] = `Máximo ${maximum} caracteres.`;
  }
  return errors;
}

function customerBody(form) {
  const body = {};
  for (const field of Object.keys(PROFILE_LIMITS)) {
    const value = profileValue(field, form[field]);
    if (value !== null) body[field] = value;
  }
  return body;
}

// SubsetNoVacio: only fields whose normalized value differs; clearing sends null.
function customerChanges(original, form) {
  const changes = {};
  for (const field of Object.keys(PROFILE_LIMITS)) {
    const value = profileValue(field, form[field]);
    if (value !== (original[field] ?? null)) changes[field] = value;
  }
  return changes;
}

function validateVehicleForm(form, { registration = false } = {}) {
  const errors = {};
  if (registration && !form.ownerId) errors.ownerId = "Selecciona al propietario.";
  if (!clean(form.tipoVehiculo)) errors.tipoVehiculo = "Selecciona el tipo de vehículo.";
  for (const [field, maximum] of Object.entries(VEHICLE_LIMITS)) {
    const value = clean(form[field]);
    if ((field === "marca" || field === "modelo") && value === "") errors[field] = "Campo obligatorio.";
    else if (length(value) > maximum) errors[field] = `Máximo ${maximum} caracteres.`;
  }
  const year = clean(String(form.anio ?? ""));
  if (year !== "" && (!/^[0-9]{1,4}$/.test(year) || Number(year) < 1)) errors.anio = "Año entre 1 y 9999.";
  if (registration) {
    const reason = clean(form.motivoPropiedad);
    if (reason === "") errors.motivoPropiedad = "Indica el motivo de la propiedad.";
    else if (length(reason) > 1000) errors.motivoPropiedad = "Máximo 1000 caracteres.";
  }
  return errors;
}

function vehicleEntry(form) {
  const vehicle = {};
  for (const field of ["tipoVehiculo", "placa", "vin", "marca", "modelo", "anio", "color"]) {
    const value = vehicleValue(field, form[field]);
    if (value !== null) vehicle[field] = value;
  }
  return vehicle;
}

function vehicleRegistrationBody(form) {
  return { vehiculo: vehicleEntry(form), propietarioId: form.ownerId, motivoPropiedad: clean(form.motivoPropiedad) };
}

function vehicleChanges(original, form) {
  const changes = {};
  for (const field of ["tipoVehiculo", "placa", "vin", "marca", "modelo", "anio", "color"]) {
    const value = vehicleValue(field, form[field]);
    if (value !== (original[field] ?? null)) changes[field] = value;
  }
  return changes;
}

function vehicleToForm(vehicle) {
  return { tipoVehiculo: vehicle.tipoVehiculo, placa: vehicle.placa ?? "", vin: vehicle.vin ?? "",
    marca: vehicle.marca, modelo: vehicle.modelo, anio: vehicle.anio == null ? "" : String(vehicle.anio),
    color: vehicle.color ?? "" };
}

function customerToForm(customer) {
  return Object.fromEntries(Object.keys(PROFILE_LIMITS).map((field) => [field, customer[field] ?? ""]));
}

function transferBody(vehicle, newOwnerId, reason) {
  return { propiedadEsperadaId: vehicle.propiedadActual.id, propietarioEsperadoId: vehicle.propiedadActual.clienteId,
    nuevoPropietarioId: newOwnerId, motivo: clean(reason) };
}

const MESSAGES = Object.freeze({
  VERSION_DESACTUALIZADA: "Los datos cambiaron en el servidor. Se recargó la versión actual: revísala y vuelve a aplicar tus cambios.",
  REFERENCIA_DUPLICADA: "Ya existe un vehículo con esa placa o VIN. Búscalo antes de registrar otro.",
  VALIDACION_DOMINIO: "Algún dato no cumple las condiciones vigentes. Revisa los campos marcados.",
  CLAVE_REUTILIZADA: "Esta intención ya se usó con otros datos. Revisa el registro antes de continuar.",
  PROPIEDAD_CAMBIADA: "El propietario del vehículo cambió. Recarga el vehículo antes de decidir nuevamente.",
  ESTADO_INCOMPATIBLE: "El registro ya no está en un estado que permita esta acción. Recárgalo.",
  ACCION_NO_PERMITIDA: "No tienes permiso para gestionar clientes y vehículos.",
  RECURSO_NO_ENCONTRADO: "No se encontró o ya no tienes acceso.",
  CLAVE_REQUERIDA: "No se pudo preparar la operación. Intenta de nuevo.",
});

function customerVehicleMessage(error) {
  if (error?.uncertain) {
    return "No se pudo confirmar el resultado. Reintenta la misma operación: no se creará un duplicado.";
  }
  return MESSAGES[error?.code] || error?.message || "No se pudo completar la operación.";
}

const FIELD_MESSAGES = Object.freeze({
  REFERENCIA_DUPLICADA: "Ya existe otro vehículo con este valor.",
  VALIDACION_DOMINIO: "Valor no disponible actualmente.",
});

// Maps server JSON Pointers (/vehiculo/placa, /cambios/placa, /propietarioId) to form fields.
function serverFieldErrors(error) {
  const errors = {};
  for (const item of error?.fields ?? []) {
    const field = String(item.path || "").split("/").filter(Boolean).at(-1);
    if (!field) continue;
    const key = field === "propietarioId" || field === "nuevoPropietarioId" ? "ownerId" : field;
    errors[key] = FIELD_MESSAGES[item.code] || item.message || "Valor no válido.";
  }
  return errors;
}

module.exports = {
  PROFILE_LIMITS, VEHICLE_LIMITS, validateCustomerForm, customerBody, customerChanges,
  validateVehicleForm, vehicleRegistrationBody, vehicleChanges, vehicleToForm, customerToForm,
  transferBody, customerVehicleMessage, serverFieldErrors,
};
