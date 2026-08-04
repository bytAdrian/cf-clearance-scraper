"use strict";

const config = require("./config");

// ASCII-only output (no symbols that break log-pipeline encoding).
function emit(fn, message, data) {
  if (data !== undefined) fn(message, data);
  else fn(message);
}

module.exports = {
  info(message, data) {
    emit(console.log, message, data);
  },
  warn(message, data) {
    emit(console.warn, message, data);
  },
  error(message, data) {
    emit(console.error, message, data);
  },
  // Returns a prefixed debug logger gated on config.detailedLogs, replacing the
  // per-file log() helpers that were duplicated across the handlers.
  scoped(prefix) {
    return (message, data) => {
      if (!config.detailedLogs) return;
      emit(console.log, `${prefix} ${message}`, data);
    };
  },
};
