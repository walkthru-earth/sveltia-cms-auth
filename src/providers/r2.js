import { AwsClient } from 'aws4fetch';

/**
 * @typedef {import('./index.js').PresignOptions} PresignOptions
 * @typedef {import('./index.js').Presigner} Presigner
 */

/**
 * Cloudflare R2 presigner.
 * R2 is S3-compatible but has a specific endpoint format.
 * @implements {Presigner}
 */
export class R2Presigner {
  /**
   * AWS client for signing requests (R2 uses S3-compatible API).
   * @type {AwsClient}
   */
  #client;

  /**
   * Cloudflare account ID.
   * @type {string}
   */
  #accountId;

  /**
   * Default bucket name.
   * @type {string}
   */
  #bucket;

  /**
   * Path prefix for all operations (e.g., 'walkthru-earth/opensensor-space/').
   * @type {string}
   */
  #pathPrefix;

  /**
   * Create a new R2Presigner.
   * @param {{ [key: string]: string }} env - Environment variables.
   * @throws {Error} If required environment variables are missing.
   */
  constructor(env) {
    const {
      R2_ACCESS_KEY_ID,
      R2_SECRET_ACCESS_KEY,
      R2_ACCOUNT_ID,
      R2_BUCKET,
      R2_PATH_PREFIX = '',
    } = env;

    if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new Error('R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required');
    }

    if (!R2_ACCOUNT_ID) {
      throw new Error('R2_ACCOUNT_ID is required');
    }

    if (!R2_BUCKET) {
      throw new Error('R2_BUCKET is required');
    }

    // R2 uses S3-compatible API with 'auto' region
    this.#client = new AwsClient({
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      region: 'auto',
      service: 's3',
    });

    this.#accountId = R2_ACCOUNT_ID;
    this.#bucket = R2_BUCKET;
    this.#pathPrefix = R2_PATH_PREFIX.replace(/^\/|\/$/g, ''); // Normalize: remove leading/trailing slashes
  }

  /**
   * Build the R2 URL for an object.
   * R2 format: https://ACCOUNT_ID.r2.cloudflarestorage.com/BUCKET/KEY.
   * @param {string} path - Object path.
   * @param {string} [bucket] - Override bucket name.
   * @returns {URL} Object URL.
   */
  #buildUrl(path, bucket) {
    const bucketName = bucket || this.#bucket;
    const cleanPath = path.replace(/^\//, ''); // Remove leading slash
    const fullPath = this.#pathPrefix ? `${this.#pathPrefix}/${cleanPath}` : cleanPath;

    return new URL(`https://${this.#accountId}.r2.cloudflarestorage.com/${bucketName}/${fullPath}`);
  }

  /**
   * Generate a presigned URL for Cloudflare R2.
   * @param {PresignOptions} options - Presign options.
   * @returns {Promise<string>} Presigned URL.
   */
  async generatePresignedUrl(options) {
    const { operation, path, contentType, bucket, expiresIn = 900 } = options;
    const url = this.#buildUrl(path, bucket);
    // Determine HTTP method based on operation
    let method = 'GET';

    if (operation === 'PUT') {
      method = 'PUT';
    } else if (operation === 'DELETE') {
      method = 'DELETE';
    }

    // Build headers
    /** @type {Record<string, string>} */
    const headers = {};

    if (contentType && operation === 'PUT') {
      headers['Content-Type'] = contentType;
    }

    // Create request to sign
    const request = new Request(url.toString(), {
      method,
      headers,
    });

    // Sign the request with query parameters
    const signedRequest = await this.#client.sign(request, {
      aws: { signQuery: true },
      expiresIn,
    });

    return signedRequest.url;
  }
}
