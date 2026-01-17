/**
 * @typedef {import('./index.js').PresignOptions} PresignOptions
 * @typedef {import('./index.js').Presigner} Presigner
 */

/**
 * Azure Blob Storage presigner.
 * Uses Shared Access Signatures (SAS) for presigned URLs.
 * @implements {Presigner}
 */
export class AzurePresigner {
  /**
   * Azure storage account name.
   * @type {string}
   */
  #accountName;

  /**
   * Azure storage account key.
   * @type {string}
   */
  #accountKey;

  /**
   * Default container name.
   * @type {string}
   */
  #container;

  /**
   * Create a new AzurePresigner.
   * @param {{ [key: string]: string }} env - Environment variables.
   * @throws {Error} If required environment variables are missing.
   */
  constructor(env) {
    const { AZURE_STORAGE_ACCOUNT, AZURE_STORAGE_KEY, AZURE_CONTAINER } = env;

    if (!AZURE_STORAGE_ACCOUNT) {
      throw new Error('AZURE_STORAGE_ACCOUNT is required');
    }

    if (!AZURE_STORAGE_KEY) {
      throw new Error('AZURE_STORAGE_KEY is required');
    }

    if (!AZURE_CONTAINER) {
      throw new Error('AZURE_CONTAINER is required');
    }

    this.#accountName = AZURE_STORAGE_ACCOUNT;
    this.#accountKey = AZURE_STORAGE_KEY;
    this.#container = AZURE_CONTAINER;
  }

  /**
   * Import the storage account key for HMAC signing.
   * @returns {Promise<CryptoKey>} Imported key.
   */
  async #importKey() {
    const keyData = Uint8Array.from(atob(this.#accountKey), (c) => c.charCodeAt(0));

    return crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
  }

  /**
   * Sign a string using HMAC-SHA256.
   * @param {string} stringToSign - String to sign.
   * @returns {Promise<string>} Base64-encoded signature.
   */
  async #sign(stringToSign) {
    const key = await this.#importKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(stringToSign);
    const signature = await crypto.subtle.sign('HMAC', key, data);

    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  }

  /**
   * Format date for Azure SAS.
   * @param {Date} date - Date to format.
   * @returns {string} ISO format without milliseconds.
   */
  #formatDate(date) {
    return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  /**
   * Generate a presigned URL (SAS token) for Azure Blob Storage.
   * Uses Service SAS for blob-level access.
   * @param {PresignOptions} options - Presign options.
   * @returns {Promise<string>} Presigned URL with SAS token.
   * @see https://docs.microsoft.com/en-us/rest/api/storageservices/create-service-sas
   */
  async generatePresignedUrl(options) {
    const { operation, path, contentType, bucket, expiresIn = 900 } = options;
    const containerName = bucket || this.#container;
    const cleanPath = path.replace(/^\//, ''); // Remove leading slash
    // Determine permissions based on operation
    let permissions = 'r'; // Default: Read

    if (operation === 'PUT') {
      permissions = 'cw'; // Create and Write
    } else if (operation === 'DELETE') {
      permissions = 'd'; // Delete
    }

    // Time calculations
    const now = new Date();
    const startTime = new Date(now.getTime() - 5 * 60 * 1000); // 5 minutes ago (clock skew)
    const expiryTime = new Date(now.getTime() + expiresIn * 1000);
    // SAS parameters
    const signedVersion = '2022-11-02'; // API version
    const signedResource = 'b'; // Blob
    const signedStart = this.#formatDate(startTime);
    const signedExpiry = this.#formatDate(expiryTime);
    const signedPermissions = permissions;
    const signedProtocol = 'https';
    const canonicalizedResource = `/blob/${this.#accountName}/${containerName}/${cleanPath}`;

    // String to sign (order matters!)
    // https://docs.microsoft.com/en-us/rest/api/storageservices/create-service-sas#version-2020-12-06-and-later
    const stringToSign = [
      signedPermissions,
      signedStart,
      signedExpiry,
      canonicalizedResource,
      '', // signedIdentifier (empty)
      '', // signedIP (empty)
      signedProtocol,
      signedVersion,
      signedResource,
      '', // signedSnapshotTime (empty)
      '', // signedEncryptionScope (empty)
      '', // rscc (Cache-Control)
      '', // rscd (Content-Disposition)
      '', // rsce (Content-Encoding)
      '', // rscl (Content-Language)
      contentType || '', // rsct (Content-Type)
    ].join('\n');

    // Sign
    const signature = await this.#sign(stringToSign);

    // Build SAS query string
    const sasParams = new URLSearchParams({
      sv: signedVersion,
      ss: 'b', // Blob service
      srt: 'o', // Object level
      sp: signedPermissions,
      st: signedStart,
      se: signedExpiry,
      spr: signedProtocol,
      sig: signature,
    });

    if (contentType) {
      sasParams.set('rsct', contentType);
    }

    // Build final URL
    const baseUrl = `https://${this.#accountName}.blob.core.windows.net/${containerName}/${cleanPath}`;

    return `${baseUrl}?${sasParams.toString()}`;
  }
}
