import { describe, it, expect } from 'vitest';
import {
  resolveApiBaseUrl,
  resolveSocketUrl,
  isLoopbackHostname,
  API_URL,
  SOCKET_URL
} from '../src/config/api.js';

describe('Centralized API & Socket.IO Configuration', () => {

  describe('isLoopbackHostname helper', () => {
    it('detects standard localhost', () => {
      expect(isLoopbackHostname('localhost')).toBe(true);
      expect(isLoopbackHostname('LOCALHOST')).toBe(true);
    });

    it('detects subdomains of localhost', () => {
      expect(isLoopbackHostname('api.localhost')).toBe(true);
      expect(isLoopbackHostname('sub.app.localhost')).toBe(true);
    });

    it('detects IPv4 loopback range (127.0.0.0/8) and 0.0.0.0', () => {
      expect(isLoopbackHostname('127.0.0.1')).toBe(true);
      expect(isLoopbackHostname('127.0.1.1')).toBe(true);
      expect(isLoopbackHostname('127.255.255.254')).toBe(true);
      expect(isLoopbackHostname('0.0.0.0')).toBe(true);
      expect(isLoopbackHostname('128.0.0.1')).toBe(false);
    });

    it('detects IPv6 loopback', () => {
      expect(isLoopbackHostname('[::1]')).toBe(true);
      expect(isLoopbackHostname('::1')).toBe(true);
      expect(isLoopbackHostname('[0:0:0:0:0:0:0:1]')).toBe(true);
      expect(isLoopbackHostname('[2001:db8::1]')).toBe(false);
    });

    it('does NOT reject legitimate hostnames containing "localhost" as a substring', () => {
      expect(isLoopbackHostname('localhosting.com')).toBe(false);
      expect(isLoopbackHostname('not-localhost.org')).toBe(false);
      expect(isLoopbackHostname('my-localhost-server.net')).toBe(false);
      expect(isLoopbackHostname('api.localhost.example.com')).toBe(false);
      expect(isLoopbackHostname('zync-backend-b7d1.onrender.com')).toBe(false);
    });
  });

  describe('resolveApiBaseUrl', () => {
    describe('Valid configuration', () => {
      it('uses canonical VITE_API_BASE_URL when provided', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveApiBaseUrl(env)).toBe('https://zync-backend-b7d1.onrender.com/api');
      });

      it('normalizes single and multiple trailing slashes from VITE_API_BASE_URL', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api///',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveApiBaseUrl(env)).toBe('https://zync-backend-b7d1.onrender.com/api');
      });

      it('accepts legitimate hostnames containing "localhost" substring in production', () => {
        const env = {
          VITE_API_BASE_URL: 'https://localhosting.com/api',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveApiBaseUrl(env)).toBe('https://localhosting.com/api');
      });

      it('accepts another legitimate hostname with localhost in domain in production', () => {
        const env = {
          VITE_API_BASE_URL: 'https://not-localhost.org/api/',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveApiBaseUrl(env)).toBe('https://not-localhost.org/api');
      });
    });

    describe('Path validation (requires /api)', () => {
      it('rejects root path without /api', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(/Expected canonical path "\/api"/i);
      });

      it('rejects root slash path without /api', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(/Expected canonical path "\/api"/i);
      });

      it('rejects unrelated path like /v1', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/v1',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(/Expected canonical path "\/api"/i);
      });

      it('rejects nested path like /api/v1', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api/v1',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(/Expected canonical path "\/api"/i);
      });
    });

    describe('Malformed URLs & Unsupported protocols', () => {
      it('rejects malformed string not conforming to URL', () => {
        const env = {
          VITE_API_BASE_URL: 'not-a-valid-url',
          PROD: false,
          MODE: 'development'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(/Invalid URL for VITE_API_BASE_URL/i);
      });

      it('rejects relative path URL', () => {
        const env = {
          VITE_API_BASE_URL: '/api/v1',
          PROD: false,
          MODE: 'development'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(/Invalid URL for VITE_API_BASE_URL/i);
      });

      it('rejects unsupported ftp: protocol', () => {
        const env = {
          VITE_API_BASE_URL: 'ftp://files.example.com/api',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(/Unsupported protocol "ftp:"/i);
      });

      it('rejects unsupported ws: protocol for API base URL', () => {
        const env = {
          VITE_API_BASE_URL: 'ws://socket.example.com/api',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(/Unsupported protocol "ws:"/i);
      });

      it('rejects URL with query parameters', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api?token=secret',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(/must not contain query parameters/i);
      });

      it('rejects URL with hash fragments', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api#section',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(/must not contain query parameters, hash fragments/i);
      });

      it('rejects URL ending in a bare "?" delimiter without query params', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api?',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /URL for VITE_API_BASE_URL must not contain query parameters, hash fragments, or bare delimiters/i
        );
      });

      it('rejects URL ending in a bare "?" delimiter after trailing slash', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api/?',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /URL for VITE_API_BASE_URL must not contain query parameters, hash fragments, or bare delimiters/i
        );
      });

      it('rejects URL ending in a bare "#" delimiter without hash fragments', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api#',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /URL for VITE_API_BASE_URL must not contain query parameters, hash fragments, or bare delimiters/i
        );
      });

      it('rejects URL ending in a bare "#" delimiter after trailing slash', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api/#',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /URL for VITE_API_BASE_URL must not contain query parameters, hash fragments, or bare delimiters/i
        );
      });

      it('rejects URL containing username and password credentials without echoing them', () => {
        const env = {
          VITE_API_BASE_URL: 'https://admin:supersecret123@zync-backend-b7d1.onrender.com/api',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /URL for VITE_API_BASE_URL must not contain embedded user credentials/i
        );
        try {
          resolveApiBaseUrl(env);
        } catch (err) {
          expect(err.message).not.toContain('admin');
          expect(err.message).not.toContain('supersecret123');
        }
      });

      it('rejects URL containing username-only credentials without echoing', () => {
        const env = {
          VITE_API_BASE_URL: 'https://adminUser@zync-backend-b7d1.onrender.com/api',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /URL for VITE_API_BASE_URL must not contain embedded user credentials/i
        );
        try {
          resolveApiBaseUrl(env);
        } catch (err) {
          expect(err.message).not.toContain('adminUser');
        }
      });
    });

    describe('Production Loopback Rejection', () => {
      it('blocks localhost in production', () => {
        const env = {
          VITE_API_BASE_URL: 'http://localhost:5000/api',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /Loopback API base URL \("localhost"\) is forbidden in production/i
        );
      });

      it('blocks localhost subdomains in production', () => {
        const env = {
          VITE_API_BASE_URL: 'http://api.localhost:5000/api',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /Loopback API base URL \("api\.localhost"\) is forbidden in production/i
        );
      });

      it('blocks IPv4 127.0.0.1 in production', () => {
        const env = {
          VITE_API_BASE_URL: 'http://127.0.0.1:5000/api',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /Loopback API base URL \("127\.0\.0\.1"\) is forbidden in production/i
        );
      });

      it('blocks IPv4 127.0.1.1 loopback in production', () => {
        const env = {
          VITE_API_BASE_URL: 'http://127.0.1.1:5000/api',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /Loopback API base URL \("127\.0\.1\.1"\) is forbidden in production/i
        );
      });

      it('blocks IPv6 [::1] in production', () => {
        const env = {
          VITE_API_BASE_URL: 'http://[::1]:5000/api',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /Loopback API base URL \("\[::1\]"\) is forbidden in production/i
        );
      });
    });

    describe('Development / Test fallbacks & Missing production config', () => {
      it('falls back to http://localhost:5000/api in development mode when unset', () => {
        const env = {
          PROD: false,
          MODE: 'development'
        };
        expect(resolveApiBaseUrl(env)).toBe('http://localhost:5000/api');
      });

      it('falls back to http://localhost:5000/api in test mode when unset', () => {
        const env = {
          PROD: false,
          MODE: 'test'
        };
        expect(resolveApiBaseUrl(env)).toBe('http://localhost:5000/api');
      });

      it('permits localhost API base URL in development mode', () => {
        const env = {
          VITE_API_BASE_URL: 'http://localhost:5000/api',
          PROD: false,
          MODE: 'development'
        };
        expect(resolveApiBaseUrl(env)).toBe('http://localhost:5000/api');
      });

      it('throws a descriptive error in production when VITE_API_BASE_URL is missing', () => {
        const env = {
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /Missing required environment variable "VITE_API_BASE_URL" in production/i
        );
      });

      it('throws a descriptive error in production when VITE_API_BASE_URL is empty whitespace', () => {
        const env = {
          VITE_API_BASE_URL: '   ',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveApiBaseUrl(env)).toThrow(
          /Missing required environment variable "VITE_API_BASE_URL" in production/i
        );
      });
    });
  });

  describe('resolveSocketUrl', () => {
    describe('Derived from VITE_API_BASE_URL', () => {
      it('derives default Socket.IO origin by removing terminal /api', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveSocketUrl(env)).toBe('https://zync-backend-b7d1.onrender.com');
      });

      it('derives Socket.IO origin when VITE_API_BASE_URL has trailing slashes', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api///',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveSocketUrl(env)).toBe('https://zync-backend-b7d1.onrender.com');
      });

      it('accepts legitimate hostnames containing "localhost" substring in production', () => {
        const env = {
          VITE_API_BASE_URL: 'https://localhosting.com/api',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveSocketUrl(env)).toBe('https://localhosting.com');
      });

      it('rejects loopback derived from VITE_API_BASE_URL in production', () => {
        const env = {
          VITE_API_BASE_URL: 'http://localhost:5000/api',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /Loopback (API base|Socket\.IO backend) URL/i
        );
      });
    });

    describe('Explicit VITE_BACKEND_URL override', () => {
      it('respects explicit VITE_BACKEND_URL override if provided', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api',
          VITE_BACKEND_URL: 'https://custom-ws.onrender.com/',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveSocketUrl(env)).toBe('https://custom-ws.onrender.com');
      });

      it('validates VITE_BACKEND_URL as absolute HTTP(S) URL', () => {
        const env = {
          VITE_BACKEND_URL: 'not-a-valid-url',
          PROD: false,
          MODE: 'development'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /Invalid URL for VITE_BACKEND_URL/i
        );
      });

      it('rejects unsupported protocol on VITE_BACKEND_URL', () => {
        const env = {
          VITE_BACKEND_URL: 'ftp://socket.example.com',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /Unsupported protocol "ftp:" for VITE_BACKEND_URL/i
        );
      });

      it('rejects loopback VITE_BACKEND_URL in production', () => {
        const env = {
          VITE_BACKEND_URL: 'http://127.0.0.1:5000',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /Loopback Socket\.IO backend URL \("127\.0\.0\.1"\) is forbidden in production/i
        );
      });

      it('rejects IPv6 loopback VITE_BACKEND_URL in production', () => {
        const env = {
          VITE_BACKEND_URL: 'http://[::1]:5000',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /Loopback Socket\.IO backend URL \("\[::1\]"\) is forbidden in production/i
        );
      });

      it('accepts legitimate hostnames containing "localhost" on VITE_BACKEND_URL in production', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api',
          VITE_BACKEND_URL: 'https://my-localhost-server.org',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveSocketUrl(env)).toBe('https://my-localhost-server.org');
      });

      it('rejects VITE_BACKEND_URL with embedded credentials without echoing them', () => {
        const env = {
          VITE_BACKEND_URL: 'https://wsuser:secretpass@custom-ws.onrender.com',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /URL for VITE_BACKEND_URL must not contain embedded user credentials/i
        );
        try {
          resolveSocketUrl(env);
        } catch (err) {
          expect(err.message).not.toContain('wsuser');
          expect(err.message).not.toContain('secretpass');
        }
      });

      it('rejects VITE_BACKEND_URL ending in a bare "?" delimiter', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api',
          VITE_BACKEND_URL: 'https://custom-ws.onrender.com?',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /URL for VITE_BACKEND_URL must not contain query parameters, hash fragments, or bare delimiters/i
        );
      });

      it('rejects VITE_BACKEND_URL ending in a bare "#" delimiter', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api',
          VITE_BACKEND_URL: 'https://custom-ws.onrender.com#',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /URL for VITE_BACKEND_URL must not contain query parameters, hash fragments, or bare delimiters/i
        );
      });
    });

    describe('Independent Configuration Validation (VITE_BACKEND_URL cannot bypass API validation)', () => {
      it('rejects missing VITE_API_BASE_URL in production even if VITE_BACKEND_URL is explicitly set', () => {
        const env = {
          VITE_BACKEND_URL: 'https://custom-ws.onrender.com',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /Missing required environment variable "VITE_API_BASE_URL" in production/i
        );
      });

      it('rejects malformed VITE_API_BASE_URL even if explicit VITE_BACKEND_URL is valid', () => {
        const env = {
          VITE_API_BASE_URL: 'not-a-valid-url',
          VITE_BACKEND_URL: 'https://custom-ws.onrender.com',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /Invalid URL for VITE_API_BASE_URL/i
        );
      });

      it('rejects non-canonical VITE_API_BASE_URL path (e.g. /v1) even if VITE_BACKEND_URL is valid', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/v1',
          VITE_BACKEND_URL: 'https://custom-ws.onrender.com',
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /Invalid path for VITE_API_BASE_URL/i
        );
      });

      it('resolves both URLs when valid VITE_API_BASE_URL and explicit VITE_BACKEND_URL are provided', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api',
          VITE_BACKEND_URL: 'https://custom-ws.onrender.com',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveApiBaseUrl(env)).toBe('https://zync-backend-b7d1.onrender.com/api');
        expect(resolveSocketUrl(env)).toBe('https://custom-ws.onrender.com');
      });

      it('derives socket origin from valid VITE_API_BASE_URL without requiring VITE_BACKEND_URL', () => {
        const env = {
          VITE_API_BASE_URL: 'https://zync-backend-b7d1.onrender.com/api',
          PROD: true,
          MODE: 'production'
        };
        expect(resolveApiBaseUrl(env)).toBe('https://zync-backend-b7d1.onrender.com/api');
        expect(resolveSocketUrl(env)).toBe('https://zync-backend-b7d1.onrender.com');
      });

      it('allows explicit VITE_BACKEND_URL in development with development localhost fallback for API', () => {
        const env = {
          VITE_BACKEND_URL: 'http://localhost:5001',
          PROD: false,
          MODE: 'development'
        };
        expect(resolveApiBaseUrl(env)).toBe('http://localhost:5000/api');
        expect(resolveSocketUrl(env)).toBe('http://localhost:5001');
      });
    });

    describe('Development / Test fallbacks & Missing production config', () => {
      it('falls back to http://localhost:5000 in development mode when unset', () => {
        const env = {
          PROD: false,
          MODE: 'development'
        };
        expect(resolveSocketUrl(env)).toBe('http://localhost:5000');
      });

      it('throws a descriptive error in production when configuration is missing', () => {
        const env = {
          PROD: true,
          MODE: 'production'
        };
        expect(() => resolveSocketUrl(env)).toThrow(
          /Missing required environment variable "VITE_API_BASE_URL"/i
        );
      });
    });
  });

  describe('Module Exports in Test Environment', () => {
    it('exports defined string constants for API_URL and SOCKET_URL in non-prod test runner', () => {
      expect(typeof API_URL).toBe('string');
      expect(API_URL.length).toBeGreaterThan(0);
      expect(typeof SOCKET_URL).toBe('string');
      expect(SOCKET_URL.length).toBeGreaterThan(0);
    });
  });
});
