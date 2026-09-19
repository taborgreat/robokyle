// Spec section 10, plus NOT_FOUND from the quick-start sketch's fallback route and
// INTERNAL_ERROR for bugs in the simulator itself.
const HTTP_STATUS = {
  INVALID_PARAM: 400,
  UNKNOWN_GESTURE: 400,
  UNKNOWN_INTENT: 400,
  UNKNOWN_ACTUATOR: 400,
  GESTURE_NAME_EXISTS: 400,
  PREDEFINED_GESTURE: 400,
  ESTOP_ACTIVE: 403,
  NOT_FOUND: 404,
  MOTION_IN_PROGRESS: 409,
  ACTUATOR_FAULT: 500,
  SENSOR_UNAVAILABLE: 500,
  EEPROM_WRITE_FAIL: 500,
  INTERNAL_ERROR: 500,
  WATCHDOG_TIMEOUT: 503,
};

export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.status = HTTP_STATUS[code];
  }
}
