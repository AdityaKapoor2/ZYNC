/**
 * In-memory rate limiting middleware.
 * Designed for single-instance Node.js deployments without external dependencies.
 */
export const createRateLimiter = ({
  windowMs = 60 * 1000,
  max = 10,
  message = 'Too many requests, please try again later.',
  keyGenerator = (req) => req.user?.uid || req.ip
} = {}) => {
  const hits = new Map();

  const limiter = (req, res, next) => {
    const key = keyGenerator(req);
    if (!key) return next();

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

// Rate limiter for Gemini match explanation: 10 requests per minute per authenticated user
export const matchExplanationRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many match explanation requests. Please wait a moment before requesting another explanation.'
});

// Rate limiter for support ticket and appeal creation: 5 requests per 15 minutes per user
export const supportCreationRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many support requests created. Please wait before submitting another ticket or appeal.',
  keyGenerator: (req) => req.user?.uid || req.ip || 'anonymous'
});

