import { SignJWT, jwtVerify } from 'jose';

/**
 * Session duration in seconds (4 hours).
 */
const SESSION_DURATION = 60 * 60 * 4;

/**
 * @typedef {object} SessionPayload
 * @property {string} sub - User ID.
 * @property {string} [name] - User display name.
 * @property {string} [email] - User email.
 * @property {string} provider - OAuth provider name.
 * @property {string} [login] - User login/username.
 * @property {number} iat - Issued at timestamp.
 * @property {number} exp - Expiration timestamp.
 */

/**
 * Create a session token for the authenticated user.
 * @param {object} user - User information from OAuth provider.
 * @param {string} user.id - User ID.
 * @param {string} [user.name] - User display name.
 * @param {string} [user.email] - User email.
 * @param {string} user.provider - OAuth provider name.
 * @param {string} [user.login] - User login/username.
 * @param {{ [key: string]: string }} env - Environment variables.
 * @returns {Promise<string>} JWT session token.
 */
export async function createSessionToken(user, env) {
  const { JWT_SECRET } = env;

  if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not configured');
  }

  const secret = new TextEncoder().encode(JWT_SECRET);

  return new SignJWT({
    sub: user.id,
    name: user.name,
    email: user.email,
    provider: user.provider,
    login: user.login,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DURATION}s`)
    .sign(secret);
}

/**
 * Validate a session token from the Authorization header.
 * @param {Request} request - HTTP request.
 * @param {{ [key: string]: string }} env - Environment variables.
 * @returns {Promise<SessionPayload | null>} Session payload or null if invalid.
 */
export async function validateSession(request, env) {
  const { JWT_SECRET } = env;

  if (!JWT_SECRET) {
    return null;
  }

  const authHeader = request.headers.get('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const secret = new TextEncoder().encode(JWT_SECRET);

  try {
    const { payload } = await jwtVerify(token, secret);

    return /** @type {SessionPayload} */ (payload);
  } catch {
    return null;
  }
}

/**
 * Handle session validation request.
 * @param {Request} request - HTTP request.
 * @param {{ [key: string]: string }} env - Environment variables.
 * @returns {Promise<Response>} HTTP response.
 */
export async function handleSession(request, env) {
  const session = await validateSession(request, env);

  if (!session) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  return new Response(
    JSON.stringify({
      user: {
        id: session.sub,
        name: session.name,
        email: session.email,
        provider: session.provider,
        login: session.login,
      },
      expiresAt: session.exp ? session.exp * 1000 : null,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
}

/**
 * Handle token exchange - convert OAuth token to session token.
 * This endpoint allows the CMS to exchange a valid OAuth token for a session token
 * that can be used for presigned URL requests.
 * @param {Request} request - HTTP request.
 * @param {{ [key: string]: string }} env - Environment variables.
 * @returns {Promise<Response>} HTTP response.
 */
export async function handleTokenExchange(request, env) {
  try {
    const { provider, token } = await request.json();

    if (!provider || !token) {
      return new Response(JSON.stringify({ error: 'Missing provider or token' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Validate the OAuth token by fetching user info
    let userInfo;

    if (provider === 'github') {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/json',
          'User-Agent': 'sveltia-cms-auth',
        },
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: 'Invalid GitHub token' }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      const data = await response.json();

      userInfo = {
        id: String(data.id),
        name: data.name || data.login,
        email: data.email,
        login: data.login,
        provider: 'github',
      };
    } else if (provider === 'gitlab') {
      const { GITLAB_HOSTNAME = 'gitlab.com' } = env;

      const response = await fetch(`https://${GITLAB_HOSTNAME}/api/v4/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        return new Response(JSON.stringify({ error: 'Invalid GitLab token' }), {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      const data = await response.json();

      userInfo = {
        id: String(data.id),
        name: data.name || data.username,
        email: data.email,
        login: data.username,
        provider: 'gitlab',
      };
    } else {
      return new Response(JSON.stringify({ error: 'Unsupported provider' }), {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    // Create session token
    const sessionToken = await createSessionToken(userInfo, env);

    return new Response(
      JSON.stringify({
        sessionToken,
        user: userInfo,
        expiresIn: SESSION_DURATION,
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Token exchange failed' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
