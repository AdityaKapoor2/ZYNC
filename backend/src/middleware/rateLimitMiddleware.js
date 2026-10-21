/**
 * In-memory rate limiting middleware.
 * Designed for single-instance Node.js deployments without external dependencies.
 */
export const createRateLimiter = ({
  windowMs = 60 * 1000,
  max = 10,
  message = 'Too many requests, please try again later.',
  keyGenerator = (req) => req.user?.uid || req.ip || req.socket?.remoteAddress || 'unknown-client'
} = {}) => {
  const hits = new Map();

  const limiter = (req, res, next) => {
    // Fail-safe key resolution: never silently bypass rate limiting on missing identity
    let rawKey;
    try {
      rawKey = keyGenerator(req);
    } catch {
      rawKey = null;
    }

    const key = (typeof rawKey === 'string' && rawKey.trim().length > 0)
      ? rawKey
      : (req.ip || req.socket?.remoteAddress || 'unknown-client');

    const now = Date.now();
    const record = hits.get(key) || { count: 0, resetTime: now + windowMs };

    // Reset if window has elapsed
    if (now > record.resetTime) {
      record.count = 0;
      record.resetTime = now + windowMs;
    }

    record.count += 1;
    hits.set(key, record);

    const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));

    // Periodic cleanup of stale entries to bound memory usage
    if (hits.size > 500) {
      for (const [k, v] of hits.entries()) {
        if (now > v.resetTime) hits.delete(k);
      }
    }

    if (record.count > max) {
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        message,
        retryAfter: retryAfterSeconds
      });
    }

    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - record.count)));
    res.set('X-RateLimit-Reset', String(Math.ceil(record.resetTime / 1000)));

    next();
  };

  limiter.reset = () => {
    hits.clear();
  };

  return limiter;
};

// 1a. Auth verification pre-token IP rate limiter: 60 requests per minute per IP
// Protects verifyToken / Firebase Admin SDK from unauthenticated token verification floods
export const authIpRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many authentication attempts from this IP address. Please try again in a minute.',
  keyGenerator: (req) => req.ip || req.socket?.remoteAddress || 'unknown-ip'
});

// 1b. Auth verification user rate limiter: 30 requests per minute per authenticated user
// Applied after verifyToken using verified Firebase UID
export const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many authentication attempts. Please try again in a minute.',
  keyGenerator: (req) => req.user?.uid || req.ip || req.socket?.remoteAddress || 'unknown-user'
});

// 2. Teammate discovery rate limiter: 30 requests per minute per authenticated user
export const matchDiscoveryRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: 'Too many match discovery requests. Please wait before refreshing matches.'
});

// 3. Gemini match explanation rate limiter: 10 requests per minute per authenticated user
export const matchExplanationRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many match explanation requests. Please wait a moment before requesting another explanation.'
});

// 4. Chat messaging rate limiter: 60 messages per minute per authenticated user
export const messageSendRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  message: 'You are sending messages too quickly. Please slow down.'
});

// 5. Connection request rate limiter: 15 requests per 15 minutes per authenticated user
export const connectionRequestRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: 'Too many connection requests sent. Please wait before connecting with more players.'
});

// 6. User reporting rate limiter: 10 reports per hour per authenticated user
export const reportCreationRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many reports submitted. Please wait before submitting another report.'
});

// 7. Support ticket and appeal creation rate limiter: 5 requests per 15 minutes per user
export const supportCreationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many support requests created. Please wait before submitting another ticket or appeal.',
  keyGenerator: (req) => req.user?.uid || req.ip || 'anonymous'
});
