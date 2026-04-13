/**
 * Returns Express middleware that validates req.body, req.params, and/or req.query with Joi.
 *
 * Backward compatible:
 *   validateRequest(bodySchema)
 *
 * Extended:
 *   validateRequest({ bodySchema?, paramsSchema?, querySchema? })
 *
 * @param {import("joi").Schema | {
 *   bodySchema?: import("joi").Schema,
 *   paramsSchema?: import("joi").Schema,
 *   querySchema?: import("joi").Schema,
 * }} spec
 */
function hasMultiSchemaShape(spec) {
  if (!spec || typeof spec !== "object") return false;
  return (
    Object.prototype.hasOwnProperty.call(spec, "bodySchema") ||
    Object.prototype.hasOwnProperty.call(spec, "paramsSchema") ||
    Object.prototype.hasOwnProperty.call(spec, "querySchema")
  );
}

function assertJoiSchema(schema, label) {
  if (schema == null) return;
  if (typeof schema.validate !== "function") {
    throw new TypeError(`validateRequest: ${label} must be a Joi schema when provided`);
  }
}

function collectMessages(error) {
  if (!error || !error.details) return [];
  return error.details.map((d) => d.message);
}

export default function validateRequest(spec) {
  if (!spec || typeof spec !== "object") {
    throw new TypeError("validateRequest: expected a Joi schema or options object");
  }

  if (hasMultiSchemaShape(spec)) {
    const { bodySchema, paramsSchema, querySchema } = spec;
    assertJoiSchema(bodySchema, "bodySchema");
    assertJoiSchema(paramsSchema, "paramsSchema");
    assertJoiSchema(querySchema, "querySchema");

    return (req, res, next) => {
      const errors = [];

      if (bodySchema) {
        const { error } = bodySchema.validate(req.body ?? {}, { abortEarly: false });
        errors.push(...collectMessages(error));
      }
      if (paramsSchema) {
        const { error } = paramsSchema.validate(req.params ?? {}, { abortEarly: false });
        errors.push(...collectMessages(error));
      }
      if (querySchema) {
        const { error } = querySchema.validate(req.query ?? {}, { abortEarly: false });
        errors.push(...collectMessages(error));
      }

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors,
        });
      }

      next();
    };
  }

  if (typeof spec.validate !== "function") {
    throw new TypeError("validateRequest: schema must be a Joi schema");
  }

  return (req, res, next) => {
    const { error } = spec.validate(req.body, { abortEarly: false });

    if (error) {
      const errors = collectMessages(error);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
      });
    }

    next();
  };
}
