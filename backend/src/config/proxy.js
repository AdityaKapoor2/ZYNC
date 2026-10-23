/**
 * Validates and normalizes the TRUST_PROXY configuration.
 *
 * Rules:
 * - Unset (undefined, null, or empty string): defaults to 1 (single-tier reverse proxy).
 * - Non-negative integer (0, 1, 2, ...): returns the integer. 0 means direct TCP peer (no trusted proxy hops).
 * - Boolean false or string "false": returns 0 (direct TCP peer, no trusted proxy hops).
 * - Boolean true or string "true": throws an explicit configuration Error (insecure leftmost IP resolution rejected).
 * - Malformed, negative, fractional, or other unsupported types: throws an explicit configuration Error.
 *
 * @param {any} [val=process.env.TRUST_PROXY] - The input value to validate
 * @returns {number} The validated non-negative integer hop count
 * @throws {Error} If configuration is malformed, negative, or unsupported
 */
export function validateTrustProxy(val = process.env.TRUST_PROXY) {
  if (val === undefined || val === null) {
    return 1;
  }

  // false / 'false' represents 0 trusted proxy hops (direct TCP peer on bare servers)
  if (val === false || val === 'false') {
    return 0;
  }

  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') {
      return 1;
    }
    // Reject "true" explicitly (never allow insecure leftmost IP resolution)
    if (trimmed === 'true') {
      throw new Error(
        'Invalid TRUST_PROXY configuration: "true". Insecure leftmost IP trusting is not supported. Use an explicit hop count (e.g. 1, 2) or 0/false for direct peer.'
      );
    }
    // Must be strictly non-negative integer digits
    if (!/^\d+$/.test(trimmed)) {
      throw new Error(
        `Invalid TRUST_PROXY configuration: "${val}". Must be a non-negative integer (e.g. 0, 1, 2) or false.`
      );
    }
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(
        `Invalid TRUST_PROXY configuration: "${val}". Exceeds maximum safe integer.`
      );
    }
    return parsed;
  }

  if (typeof val === 'number') {
    if (Number.isInteger(val) && val >= 0) {
      return val;
    }
    throw new Error(
      `Invalid TRUST_PROXY configuration: ${val}. Must be a non-negative integer (e.g. 0, 1, 2) or false.`
    );
  }

  throw new Error(
    `Invalid TRUST_PROXY configuration: ${JSON.stringify(val)}. Must be a non-negative integer (e.g. 0, 1, 2) or false.`
  );
}

export default validateTrustProxy;
