/**
 * Sveltia CMS Auth - Cloudflare Worker.
 * Provides OAuth authentication and presigned URL generation for Sveltia CMS.
 * Supports multiple storage providers (S3, R2, GCS, Azure) and OAuth providers (GitHub, GitLab).
 * @see https://github.com/walkthru-earth/sveltia-cms-auth
 */

import { handleAuth, handleCallback } from './handlers/oauth.js';
import { handleSession, handleTokenExchange } from './handlers/session.js';
import { handlePresign, handlePresignBatch } from './handlers/presign.js';

/**
 * Handle CORS preflight requests.
 * @param {Request} request - HTTP request.
 * @param {{ [key: string]: string }} env - Environment variables.
 * @returns {Response} CORS preflight response.
 */
function handleCORS(request, env) {
  const origin = request.headers.get('Origin') || '*';
  const { ALLOWED_ORIGINS = '*' } = env;
  let allowOrigin = '*';

  if (ALLOWED_ORIGINS !== '*') {
    const allowedList = ALLOWED_ORIGINS.split(',').map((s) => s.trim());

    allowOrigin = allowedList.includes(origin) ? origin : allowedList[0] || '*';
  } else if (origin !== '*') {
    allowOrigin = origin;
  }

  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': allowOrigin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Create a simple JSON response.
 * @param {object} data - Response data.
 * @param {number} [status] - HTTP status code.
 * @returns {Response} JSON response.
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default {
  /**
   * The main request handler.
   * @param {Request} request - HTTP request.
   * @param {{ [key: string]: string }} env - Environment variables.
   * @returns {Promise<Response>} HTTP response.
   * @see https://developers.cloudflare.com/workers/runtime-apis/fetch/
   * @see https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
   * @see https://docs.gitlab.com/ee/api/oauth2.html#authorization-code-flow
   */
  async fetch(request, env) {
    const { method, url } = request;
    const { pathname } = new URL(url);

    // CORS preflight handling
    if (method === 'OPTIONS') {
      return handleCORS(request, env);
    }

    // Health check endpoint
    if (method === 'GET' && pathname === '/health') {
      return jsonResponse({
        status: 'ok',
        version: '0.2.0',
        features: ['oauth', 'presign', 'session'],
      });
    }

    // ==================
    // OAuth Endpoints
    // ==================

    // Start OAuth flow
    if (method === 'GET' && ['/auth', '/oauth/authorize'].includes(pathname)) {
      return handleAuth(request, env);
    }

    // OAuth callback
    if (method === 'GET' && ['/callback', '/oauth/redirect'].includes(pathname)) {
      return handleCallback(request, env);
    }

    // ==================
    // Session Endpoints
    // ==================

    // Validate session token
    if (method === 'GET' && pathname === '/session') {
      return handleSession(request, env);
    }

    // Exchange OAuth token for session token
    if (method === 'POST' && pathname === '/token-exchange') {
      return handleTokenExchange(request, env);
    }

    // ==================
    // Presigned URL Endpoints
    // ==================

    // Generate presigned URL for single path
    if (method === 'POST' && pathname === '/presign') {
      return handlePresign(request, env);
    }

    // Generate presigned URLs for multiple paths
    if (method === 'POST' && pathname === '/presign-batch') {
      return handlePresignBatch(request, env);
    }

    // ==================
    // Not Found
    // ==================

    return new Response(
      JSON.stringify({
        error: 'Not Found',
        endpoints: {
          oauth: {
            'GET /auth': 'Start OAuth flow',
            'GET /callback': 'OAuth callback',
          },
          session: {
            'GET /session': 'Validate session token',
            'POST /token-exchange': 'Exchange OAuth token for session token',
          },
          presign: {
            'POST /presign': 'Generate presigned URL',
            'POST /presign-batch': 'Generate multiple presigned URLs',
          },
          health: {
            'GET /health': 'Health check',
          },
        },
      }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  },
};
