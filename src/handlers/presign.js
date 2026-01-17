/* eslint-disable no-await-in-loop */

import { validateSession } from './session.js';
import { getPresigner } from '../providers/index.js';

/**
 * @typedef {object} PresignRequest
 * @property {string} [provider] - Storage provider ('s3' | 'r2' | 'gcs' | 'azure' | 'minio').
 * @property {'GET' | 'PUT' | 'DELETE'} operation - Operation type.
 * @property {string} path - Object path.
 * @property {string} [contentType] - Content type for PUT operations.
 * @property {string} [bucket] - Override bucket name (optional).
 */

/**
 * @typedef {object} PresignBatchRequest
 * @property {string} [provider] - Storage provider.
 * @property {string[]} paths - List of paths.
 * @property {'GET' | 'PUT' | 'DELETE'} [operation] - Operation type (default: GET).
 * @property {string} [bucket] - Override bucket name (optional).
 */

/**
 * Default presigned URL expiry in seconds (15 minutes).
 */
const DEFAULT_EXPIRY = 900;

/**
 * Create JSON response with CORS headers.
 * @param {object} data - Response data.
 * @param {Request} [request] - Original request for CORS origin.
 * @param {{ [key: string]: string }} [env] - Environment variables.
 * @param {number} [status] - HTTP status code.
 * @returns {Response} HTTP response.
 */
function jsonResponse(data, request, env, status = 200) {
  const origin = request?.headers.get('Origin') || '*';
  const allowedOrigins = env?.ALLOWED_ORIGINS;
  let allowOrigin = '*';

  if (allowedOrigins && allowedOrigins !== '*') {
    const allowedList = allowedOrigins.split(',').map((s) => s.trim());

    allowOrigin = allowedList.includes(origin) ? origin : allowedList[0];
  } else if (origin !== '*') {
    allowOrigin = origin;
  }

  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Credentials': 'true',
    },
  });
}

/**
 * Handle presigned URL request for a single path.
 * @param {Request} request - HTTP request.
 * @param {{ [key: string]: string }} env - Environment variables.
 * @returns {Promise<Response>} HTTP response.
 */
export async function handlePresign(request, env) {
  // Validate session
  const session = await validateSession(request, env);

  if (!session) {
    return jsonResponse({ error: 'Unauthorized' }, request, env, 401);
  }

  // Parse request body
  /** @type {PresignRequest} */
  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, request, env, 400);
  }

  const { provider, operation, path, contentType, bucket } = body;

  // Validate required fields
  if (!operation || !path) {
    return jsonResponse({ error: 'Missing required fields: operation, path' }, request, env, 400);
  }

  // Validate operation
  if (!['GET', 'PUT', 'DELETE'].includes(operation)) {
    return jsonResponse(
      { error: 'Invalid operation. Must be GET, PUT, or DELETE' },
      request,
      env,
      400,
    );
  }

  // Validate path (prevent directory traversal)
  if (path.includes('..') || path.startsWith('/')) {
    return jsonResponse({ error: 'Invalid path' }, request, env, 400);
  }

  try {
    // Get the appropriate presigner
    const presigner = getPresigner(provider, env);

    // Generate presigned URL
    const url = await presigner.generatePresignedUrl({
      operation,
      path,
      contentType,
      bucket,
      expiresIn: DEFAULT_EXPIRY,
    });

    return jsonResponse({ url, expiresIn: DEFAULT_EXPIRY, path, operation }, request, env);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Presign error:', error);

    const message = error instanceof Error ? error.message : 'Failed to generate presigned URL';

    return jsonResponse({ error: message }, request, env, 500);
  }
}

/**
 * Handle batch presigned URL request for multiple paths.
 * @param {Request} request - HTTP request.
 * @param {{ [key: string]: string }} env - Environment variables.
 * @returns {Promise<Response>} HTTP response.
 */
export async function handlePresignBatch(request, env) {
  // Validate session
  const session = await validateSession(request, env);

  if (!session) {
    return jsonResponse({ error: 'Unauthorized' }, request, env, 401);
  }

  // Parse request body
  /** @type {PresignBatchRequest} */
  let body;

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, request, env, 400);
  }

  const { provider, paths, operation = 'GET', bucket } = body;

  // Validate paths
  if (!Array.isArray(paths) || paths.length === 0) {
    return jsonResponse({ error: 'paths must be a non-empty array' }, request, env, 400);
  }

  // Limit batch size
  const maxBatchSize = 100;

  if (paths.length > maxBatchSize) {
    const errorMsg = `Batch size exceeds maximum of ${maxBatchSize}`;

    return jsonResponse({ error: errorMsg }, request, env, 400);
  }

  // Validate all paths using Array methods instead of for-of loop
  const invalidPath = paths.find(
    (p) => typeof p !== 'string' || p.includes('..') || p.startsWith('/'),
  );

  if (invalidPath !== undefined) {
    return jsonResponse({ error: `Invalid path: ${invalidPath}` }, request, env, 400);
  }

  try {
    // Get the appropriate presigner
    const presigner = getPresigner(provider, env);
    // Generate presigned URLs for all paths
    /** @type {Record<string, string>} */
    const urls = {};

    // Process paths sequentially (avoids rate limits)
    // eslint-disable-next-line no-restricted-syntax
    for (const path of paths) {
      urls[path] = await presigner.generatePresignedUrl({
        operation,
        path,
        bucket,
        expiresIn: DEFAULT_EXPIRY,
      });
    }

    return jsonResponse({ urls, expiresIn: DEFAULT_EXPIRY, count: paths.length }, request, env);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Presign batch error:', error);

    const message = error instanceof Error ? error.message : 'Failed to generate presigned URLs';

    return jsonResponse({ error: message }, request, env, 500);
  }
}
