import dotenv from 'dotenv';

dotenv.config();

/**
 * Resolves and normalizes allowed CORS origins based on the environment.
 * 
 * - In development (NODE_ENV !== 'production'):
 *   Allows local Vite development origins (http://localhost:5173 and http://127.0.0.1:5173),
 *   plus any valid origins explicitly defined in FRONTEND_URL.
 * 
 * - In production (NODE_ENV === 'production'):
 *   Allows ONLY the exact configured FRONTEND_URL origin(s).
 *   Never falls back to localhost or wildcards if FRONTEND_URL is missing or invalid.
 * 
 * Normalization:
 * - Trims whitespace
 * - Strips trailing slashes and paths via URL.origin
 * - Validates protocol (http: / https:)
 * - Deduplicates results
 */
export const getAllowedOrigins = (env = process.env) => {
  const isProduction = env.NODE_ENV === 'production';
  const origins = [];

  // In development, permit local Vite frontend origins
  if (!isProduction) {
    origins.push('http://localhost:5173', 'http://127.0.0.1:5173');
  }

  // Parse and normalize FRONTEND_URL if provided
  if (env.FRONTEND_URL) {
    const rawList = env.FRONTEND_URL.split(',')
      .map(entry => entry.trim())
      .filter(Boolean);

    for (const raw of rawList) {
      try {
        const parsed = new URL(raw);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          origins.push(parsed.origin);
        } else {
          console.warn(`[CORS] Unsupported protocol in FRONTEND_URL ignored: "${raw}"`);
        }
      } catch {
        console.warn(`[CORS] Invalid origin in FRONTEND_URL ignored: "${raw}"`);
      }
    }
  }

  if (isProduction && origins.length === 0) {
    console.warn('[CORS] Warning: FRONTEND_URL is not configured in production. Cross-origin browser requests will be blocked.');
  }

  return Array.from(new Set(origins));
};

/**
 * Constructs cors middleware options matching ZYNC security requirements.
 */
export const getCorsOptions = (env = process.env) => {
  const allowedOrigins = getAllowedOrigins(env);

  return {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
    optionsSuccessStatus: 204
  };
};

export default getCorsOptions;
