import { AwsClient } from 'aws4fetch';

/**
 * @typedef {import('./index.js').PresignOptions} PresignOptions
 * @typedef {import('./index.js').Presigner} Presigner
 */

/**
 * S3-compatible presigner.
 * Works with AWS S3, MinIO, DigitalOcean Spaces, Wasabi, Backblaze B2, and other S3-compatible
 * storage services.
 * @implements {Presigner}
 */
export class S3Presigner {
  /**
   * AWS client for signing requests.
   * @type {AwsClient}
   */
  #client;

  /**
   * S3 endpoint URL.
   * @type {string}
   */
  #endpoint;

  /**
   * Default bucket name.
   * @type {string}
   */
  #bucket;

  /**
   * AWS region.
   * @type {string}
   */
  #region;

  /**
   * Whether to use path-style URLs (required for MinIO, some S3-compatible services).
   * @type {boolean}
   */
  #forcePathStyle;

  /**
   * Create a new S3Presigner.
   * @param {{ [key: string]: string }} env - Environment variables.
   * @throws {Error} If required environment variables are missing.
   */
  constructor(env) {
    const {
      S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY,
      S3_ENDPOINT = 'https://s3.amazonaws.com',
      S3_BUCKET,
      S3_REGION = 'us-east-1',
      S3_FORCE_PATH_STYLE = 'false',
    } = env;

    if (!S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
      throw new Error('S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required');
    }

    if (!S3_BUCKET) {
      throw new Error('S3_BUCKET is required');
    }

    this.#client = new AwsClient({
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
      region: S3_REGION,
      service: 's3',
    });

    this.#endpoint = S3_ENDPOINT.replace(/\/$/, ''); // Remove trailing slash
    this.#bucket = S3_BUCKET;
    this.#region = S3_REGION;
    this.#forcePathStyle = S3_FORCE_PATH_STYLE === 'true';
  }

  /**
   * Build the URL for an object.
   * @param {string} path - Object path.
   * @param {string} [bucket] - Override bucket name.
   * @returns {URL} Object URL.
   */
  #buildUrl(path, bucket) {
    const bucketName = bucket || this.#bucket;
    const cleanPath = path.replace(/^\//, ''); // Remove leading slash

    if (this.#forcePathStyle) {
      // Path-style: https://endpoint/bucket/key
      return new URL(`${this.#endpoint}/${bucketName}/${cleanPath}`);
    }

    // Virtual-hosted-style: https://bucket.endpoint/key
    const endpointUrl = new URL(this.#endpoint);
    const virtualHost = `${bucketName}.${endpointUrl.host}`;

    return new URL(`${endpointUrl.protocol}//${virtualHost}/${cleanPath}`);
  }

  /**
   * Generate a presigned URL for S3-compatible storage.
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
      // Note: aws4fetch uses 'expiresIn' option for presigned URLs
      expiresIn,
    });

    return signedRequest.url;
  }
}
