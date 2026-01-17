import { S3Presigner } from './aws.js';
import { R2Presigner } from './r2.js';
import { GCSPresigner } from './gcs.js';
import { AzurePresigner } from './azure.js';

/**
 * @typedef {object} PresignOptions
 * @property {'GET' | 'PUT' | 'DELETE'} operation - Operation type.
 * @property {string} path - Object path within the bucket.
 * @property {string} [contentType] - Content type for PUT operations.
 * @property {string} [bucket] - Override bucket name.
 * @property {number} [expiresIn] - Expiration time in seconds (default: 900).
 */

/**
 * @typedef {object} Presigner
 * @property {(options: PresignOptions) => Promise<string>} generatePresignedUrl - Generate URL.
 */

/**
 * Auto-detect storage provider from environment variables.
 * @param {{ [key: string]: string }} env - Environment variables.
 * @returns {string} Detected provider name.
 */
function detectProvider(env) {
  // Check for provider-specific environment variables
  if (env.R2_ACCOUNT_ID || env.R2_ACCESS_KEY_ID) {
    return 'r2';
  }

  if (env.GCS_PROJECT_ID || env.GOOGLE_APPLICATION_CREDENTIALS) {
    return 'gcs';
  }

  if (env.AZURE_STORAGE_ACCOUNT || env.AZURE_STORAGE_CONNECTION_STRING) {
    return 'azure';
  }

  // Check endpoint for MinIO-style self-hosted
  const endpoint = env.S3_ENDPOINT || '';

  if (endpoint && !endpoint.includes('amazonaws.com')) {
    return 'minio';
  }

  // Default to S3
  return 's3';
}

/**
 * Supported storage providers.
 * @type {string[]}
 */
export const SUPPORTED_PROVIDERS = ['s3', 'r2', 'gcs', 'azure', 'minio'];

/**
 * Get the appropriate presigner for the specified storage provider.
 * @param {string | undefined} provider - Provider name. If not specified, auto-detect from env.
 * @param {{ [key: string]: string }} env - Environment variables.
 * @returns {Presigner} Presigner instance.
 * @throws {Error} If required environment variables are missing.
 */
export function getPresigner(provider, env) {
  // Auto-detect provider from environment if not specified
  const detectedProvider = provider || detectProvider(env);

  switch (detectedProvider) {
    case 'r2':
      return new R2Presigner(env);

    case 'gcs':
      return new GCSPresigner(env);

    case 'azure':
      return new AzurePresigner(env);

    case 's3':
    case 'minio':
    default:
      // Default to S3-compatible (works with AWS S3, MinIO, DigitalOcean Spaces, etc.)
      return new S3Presigner(env);
  }
}

/**
 * Validate that required environment variables are set for a provider.
 * @param {string} provider - Provider name.
 * @param {{ [key: string]: string }} env - Environment variables.
 * @returns {{ valid: boolean, missing: string[] }} Validation result.
 */
export function validateProviderConfig(provider, env) {
  /** @type {Record<string, string[]>} */
  const requiredVars = {
    s3: ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET'],
    minio: ['S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'S3_ENDPOINT'],
    r2: ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET'],
    gcs: ['GCS_PROJECT_ID', 'GCS_BUCKET', 'GCS_SERVICE_ACCOUNT_KEY'],
    azure: ['AZURE_STORAGE_ACCOUNT', 'AZURE_STORAGE_KEY', 'AZURE_CONTAINER'],
  };

  const required = requiredVars[provider] || requiredVars.s3;
  const missing = required.filter((key) => !env[key]);

  return {
    valid: missing.length === 0,
    missing,
  };
}
