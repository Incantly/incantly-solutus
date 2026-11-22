/** @incantly/server: Node service for the teacher: settings, limits, the HTTP server, the log, headless checks (.kiro/specs/server). */
export { createServer, ROUTES } from './http/server';
export type { Listening, Server, ServerOptions } from './http/server';
export { readSettings, DEFAULT_TEXT_MODELS, DEFAULT_VISION_MODELS, DEFAULT_SPEECH_MODELS, DEFAULT_ORIGINS } from './env';
export type { EnvLike, Provider, Secrets, Settings } from './env';
export { RateLimiter } from './limits/rate';
export type { AcquireOptions, Admission, RateConfig } from './limits/rate';
export { createLog, scrub, silentLog } from './log';
export type { LogFn, LogStream } from './log';
export { checkOrigin, corsHeaders, preflightHeaders } from './http/cors';
export { BODY_LIMIT, BODY_LIMIT_PICTURE, DROP_LIMIT, PICTURE_BYTES, PICTURE_SIDE, checkPicture, parseJsonObject, readBody } from './http/body';
export type { Picture } from './http/body';
export { NDJSON_TYPE, ndjsonLine } from './http/ndjson';
export { Job, SERVER_JOB_MACHINE } from './jobs/job';
export type { JobState, JobMove } from './jobs/job';
export { CHECK_MAX_LINES } from './jobs/check';
export type { Context, Route } from './jobs/context';
export { STATUS, serverError, isServerError } from './errors';
export type { ServerError, ServerErrorKind } from './errors';
