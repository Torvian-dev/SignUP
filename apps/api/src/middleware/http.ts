import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { HttpError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

/** Wrap async handlers so rejections reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  return schema.parse(data);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: "validation_error", message: "invalid request", details: err.flatten() } });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  logger.error({ err, path: req.path }, "unhandled error");
  res.status(500).json({ error: { code: "internal", message: "internal server error" } });
}
