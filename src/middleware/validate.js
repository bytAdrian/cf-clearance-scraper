"use strict";

const validateSchema = require("../validation/requestSchema");

module.exports = function validate(req, res, next) {
  const check = validateSchema(req.body);
  if (check !== true) {
    return res.status(400).json({ code: 400, message: "Bad Request", schema: check });
  }
  next();
};
