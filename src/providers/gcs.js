/**
 * @typedef {import('./index.js').PresignOptions} PresignOptions
 * @typedef {import('./index.js').Presigner} Presigner
 */

/**
 * Google Cloud Storage presigner.
 * Uses V4 signing for presigned URLs.
 *
 * Note: GCS can also work in S3-compatible mode with HMAC keys,
 * but this implementation uses the native GCS API with service account credentials.
 * @implements {Presigner}
 */
export class GCSPresigner {
  /**
   * GCS project ID.
   * @type {string}
   */
  #projectId;

  /**
   * Default bucket name.
   * @type {string}
   */
  #bucket;

  /**
   * Service account email.
   * @type {string}
   */
  #clientEmail;

  /**
   * Service account private key.
   * @type {string}
   */
  #privateKey;

  /**
   * Create a new GCSPresigner.
   * @param {{ [key: string]: string }} env - Environment variables.
   * @throws {Error} If required environment variables are missing.
   */
  constructor(env) {
    const { GCS_PROJECT_ID, GCS_BUCKET, GCS_SERVICE_ACCOUNT_KEY } = env;

    if (!GCS_PROJECT_ID) {
      throw new Error('GCS_PROJECT_ID is required');
    }

    if (!GCS_BUCKET) {
      throw new Error('GCS_BUCKET is required');
    }

    if (!GCS_SERVICE_ACCOUNT_KEY) {
      throw new Error('GCS_SERVICE_ACCOUNT_KEY is required');
    }

    // Parse service account key JSON
    let serviceAccount;

    try {
      serviceAccount = JSON.parse(GCS_SERVICE_ACCOUNT_KEY);
    } catch {
      throw new Error('GCS_SERVICE_ACCOUNT_KEY must be valid JSON');
    }

    if (!serviceAccount.client_email || !serviceAccount.private_key) {
      throw new Error('Service account must have client_email and private_key');
    }

    this.#projectId = GCS_PROJECT_ID;
    this.#bucket = GCS_BUCKET;
    this.#clientEmail = serviceAccount.client_email;
    this.#privateKey = serviceAccount.private_key;
  }

  /**
   * Import the private key for signing.
   * @returns {Promise<CryptoKey>} Imported key.
   */
  async #importPrivateKey() {
    // Remove PEM headers and decode base64
    const pemContents = this.#privateKey
      .replace(/-----BEGIN PRIVATE KEY-----/g, '')
      .replace(/-----END PRIVATE KEY-----/g, '')
      .replace(/\s/g, '');

    const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));

    return crypto.subtle.importKey(
      'pkcs8',
      binaryDer,
      {
        name: 'RSASSA-PKCS1-v1_5',
        hash: 'SHA-256',
      },
      false,
      ['sign'],
    );
  }

  /**
   * Sign a string using RSA-SHA256.
   * @param {string} stringToSign - String to sign.
   * @returns {Promise<string>} Base64-encoded signature.
   */
  async #sign(stringToSign) {
    const key = await this.#importPrivateKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(stringToSign);
    const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, data);

    // Convert to base64
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  /**
   * Generate a presigned URL for Google Cloud Storage.
   * Uses V4 signing algorithm.
   * @param {PresignOptions} options - Presign options.
   * @returns {Promise<string>} Presigned URL.
   * @see https://cloud.google.com/storage/docs/access-control/signed-urls
   */
  async generatePresignedUrl(options) {
    const { operation, path, bucket, expiresIn = 900 } = options;
    const bucketName = bucket || this.#bucket;
    const cleanPath = path.replace(/^\//, ''); // Remove leading slash
    // Determine HTTP method based on operation
    let method = 'GET';

    if (operation === 'PUT') {
      method = 'PUT';
    } else if (operation === 'DELETE') {
      method = 'DELETE';
    }

    // Current time in ISO format
    const now = new Date();

    const timestamp = now
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');

    const datestamp = timestamp.slice(0, 8);
    const canonicalUri = `/${bucketName}/${cleanPath}`;
    const credentialScope = `${datestamp}/auto/storage/goog4_request`;
    const credential = `${this.#clientEmail}/${credentialScope}`;
    const signedHeaders = 'host';

    // Query parameters
    const queryParams = new URLSearchParams({
      'X-Goog-Algorithm': 'GOOG4-RSA-SHA256',
      'X-Goog-Credential': credential,
      'X-Goog-Date': timestamp,
      'X-Goog-Expires': String(expiresIn),
      'X-Goog-SignedHeaders': signedHeaders,
    });

    // Host
    const host = 'storage.googleapis.com';
    const canonicalQueryString = queryParams.toString().replace(/\+/g, '%20');
    const canonicalHeaders = `host:${host}\n`;

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    // Hash canonical request
    const encoder = new TextEncoder();

    const canonicalRequestHash = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(canonicalRequest),
    );

    const canonicalRequestHashHex = Array.from(new Uint8Array(canonicalRequestHash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    // String to sign
    const stringToSign = [
      'GOOG4-RSA-SHA256',
      timestamp,
      credentialScope,
      canonicalRequestHashHex,
    ].join('\n');

    // Sign
    const signature = await this.#sign(stringToSign);

    const signatureHex = Array.from(atob(signature), (c) =>
      c.charCodeAt(0).toString(16).padStart(2, '0'),
    ).join('');

    // Build final URL
    return `https://${host}${canonicalUri}?${canonicalQueryString}&X-Goog-Signature=${signatureHex}`;
  }
}
