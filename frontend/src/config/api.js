/**
 * Centralized API & WebSocket Configuration for ZYNC Frontend.
 *
 * Canonical environment variables:
 * - VITE_API_BASE_URL: Backend REST API base URL with canonical path '/api' (e.g. 'https://zync-backend-b7d1.onrender.com/api').
 * - VITE_BACKEND_URL: Optional override for backend origin / Socket.IO server (defaults to VITE_API_BASE_URL without '/api').
 */

/**
 * Checks whether a given hostname is an actual loopback destination.
 * Matches:
 * - 'localhost' and subdomains (*.localhost)
 * - IPv4 loopback (127.0.0.0/8)
 * - IPv6 loopback ('[::1]' or '::1')
 * - '0.0.0.0'
 * Does NOT match legitimate domains that happen to contain the word "localhost"
 * (e.g. 'localhosting.com', 'not-localhost.org', 'my-localhost-server.net').
 */
export function isLoopbackHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const lower = hostname.toLowerCase();

  // Strip IPv6 square brackets if present
  const unbracketed = lower.replace(/^\[|\]$/g, '');

  if (lower === 'localhost' || lower.endsWith('.localhost')) {
    return true;
  }

  // IPv6 loopback
  if (unbracketed === '::1' || unbracketed === '0:0:0:0:0:0:0:1') {
    return true;
  }

  // IPv4 loopback (127.0.0.0/8)
  if (/^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/.test(lower)) {
    return true;
  }

  // 0.0.0.0
  if (lower === '0.0.0.0') {
    return true;
  }

  return false;
}

/**
 * Parses and validates an absolute HTTP or HTTPS URL.
 * Throws a descriptive error if the URL is malformed, uses an unsupported protocol,
 * contains embedded user credentials, or contains query parameters or hash fragments.
 */
function parseAndValidateHttpUrl(urlString, configName) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(
      `[ZYNC Config Error] Invalid URL for ${configName}. Expected a valid absolute HTTP(S) URL.`
    );
  }

  // Reject embedded credentials without leaking credential values in errors
  if (parsed.username || parsed.password) {
    throw new Error(
      `[ZYNC Config Error] URL for ${configName} must not contain embedded user credentials.`
    );
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `[ZYNC Config Error] Unsupported protocol "${parsed.protocol}" for ${configName}. Expected http: or https:.`
    );
  }

  // Reject query parameters, hash fragments, or bare '?' / '#' delimiters
  if (parsed.search || parsed.hash || urlString.includes('?') || urlString.includes('#')) {
    throw new Error(
      `[ZYNC Config Error] URL for ${configName} must not contain query parameters, hash fragments, or bare delimiters ("?" or "#").`
    );
  }

  return parsed;
}

/**
 * Resolves and normalizes the canonical API base URL.
 * Trailing slashes are stripped.
 * Canonical path must be '/api'.
 * In development / test, defaults to 'http://localhost:5000/api'.
 * In production, requires VITE_API_BASE_URL and disallows loopback destinations.
 */
export function resolveApiBaseUrl(env = import.meta.env) {
  const isProduction = env?.PROD === true || env?.MODE === 'production';
  const raw = env?.VITE_API_BASE_URL;

  if (raw && typeof raw === 'string' && raw.trim() !== '') {
    const trimmed = raw.trim();
    const parsed = parseAndValidateHttpUrl(trimmed, 'VITE_API_BASE_URL');

    // Canonical API base URL must have path '/api'
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    if (normalizedPath !== '/api') {
      throw new Error(
        `[ZYNC Config Error] Invalid path for VITE_API_BASE_URL: "${parsed.pathname}". Expected canonical path "/api".`
      );
    }

    if (isProduction && isLoopbackHostname(parsed.hostname)) {
      throw new Error(
        `[ZYNC Config Error] Loopback API base URL ("${parsed.hostname}") is forbidden in production environment.`
      );
    }

    return trimmed.replace(/\/+$/, '');
  }

  if (isProduction) {
    throw new Error(
      '[ZYNC Config Error] Missing required environment variable "VITE_API_BASE_URL" in production. ' +
      'Silently falling back to localhost is blocked.'
    );
  }

  return 'http://localhost:5000/api';
}

/**
 * Resolves and normalizes the Socket.IO server URL.
 * Validates the canonical API configuration first, ensuring that an explicit
 * VITE_BACKEND_URL override cannot bypass validation of VITE_API_BASE_URL.
 * Respects explicit VITE_BACKEND_URL override if present;
 * otherwise derives the origin from VITE_API_BASE_URL by removing terminal '/api'.
 * In development / test, defaults to 'http://localhost:5000'.
 * In production, requires configuration and disallows loopback destinations.
 */
export function resolveSocketUrl(env = import.meta.env) {
  const isProduction = env?.PROD === true || env?.MODE === 'production';

  // 1. Explicit VITE_BACKEND_URL override validation
  const explicitBackend = env?.VITE_BACKEND_URL;
  let normalizedBackend = null;
  if (explicitBackend && typeof explicitBackend === 'string' && explicitBackend.trim() !== '') {
    const trimmedBackend = explicitBackend.trim();
    const parsedBackend = parseAndValidateHttpUrl(trimmedBackend, 'VITE_BACKEND_URL');

    if (isProduction && isLoopbackHostname(parsedBackend.hostname)) {
      throw new Error(
        `[ZYNC Config Error] Loopback Socket.IO backend URL ("${parsedBackend.hostname}") is forbidden in production environment.`
      );
    }

    normalizedBackend = trimmedBackend.replace(/\/+$/, '');
  }

  // Fix 2: Validate canonical API configuration so that an explicit VITE_BACKEND_URL
  // cannot bypass validation of VITE_API_BASE_URL when both settings are expected to be valid.
  const apiBaseUrl = resolveApiBaseUrl(env);

  if (normalizedBackend) {
    return normalizedBackend;
  }

  // 2. Derive origin from validated canonical API base URL by stripping terminal '/api'
  const derived = apiBaseUrl.replace(/\/api$/, '') || apiBaseUrl;
  return derived;
}

export const API_URL = resolveApiBaseUrl();
export const SOCKET_URL = resolveSocketUrl();

export default {
  API_URL,
  SOCKET_URL,
  resolveApiBaseUrl,
  resolveSocketUrl,
  isLoopbackHostname,
};
