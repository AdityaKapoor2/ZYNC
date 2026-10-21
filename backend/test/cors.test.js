import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { getAllowedOrigins, getCorsOptions } from '../src/config/cors.js';

describe('SEC-05: CORS Configuration and Hardening', () => {
  describe('1. Origin Resolution & Normalization (getAllowedOrigins)', () => {
    it('in development, includes local Vite origins (localhost and 127.0.0.1)', () => {
      const origins = getAllowedOrigins({ NODE_ENV: 'development' });
      expect(origins).toContain('http://localhost:5173');
      expect(origins).toContain('http://127.0.0.1:5173');
    });

    it('in development, merges local Vite origins with configured FRONTEND_URL', () => {
      const origins = getAllowedOrigins({
        NODE_ENV: 'development',
        FRONTEND_URL: 'https://dev.zync.gg'
      });
      expect(origins).toContain('http://localhost:5173');
      expect(origins).toContain('http://127.0.0.1:5173');
      expect(origins).toContain('https://dev.zync.gg');
    });

    it('in production, allows ONLY the exact configured FRONTEND_URL origin', () => {
      const origins = getAllowedOrigins({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://zync-app.vercel.app'
      });
      expect(origins).toEqual(['https://zync-app.vercel.app']);
      expect(origins).not.toContain('http://localhost:5173');
      expect(origins).not.toContain('http://127.0.0.1:5173');
    });

    it('in production, does NOT fall back to localhost or wildcards when FRONTEND_URL is missing', () => {
      const originsMissing = getAllowedOrigins({ NODE_ENV: 'production' });
      expect(originsMissing).toEqual([]);

      const originsEmpty = getAllowedOrigins({ NODE_ENV: 'production', FRONTEND_URL: '   ' });
      expect(originsEmpty).toEqual([]);
    });

    it('normalizes trailing slashes and paths to origin root', () => {
      const origins = getAllowedOrigins({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://zync.app/some/subpath/'
      });
      expect(origins).toEqual(['https://zync.app']);
    });

    it('trims whitespace and handles comma-separated multiple origins', () => {
      const origins = getAllowedOrigins({
        NODE_ENV: 'production',
        FRONTEND_URL: '  https://zync.app/  ,  https://admin.zync.app  '
      });
      expect(origins).toEqual(['https://zync.app', 'https://admin.zync.app']);
    });

    it('safely discards invalid or non-http(s) origins without crashing', () => {
      const origins = getAllowedOrigins({
        NODE_ENV: 'production',
        FRONTEND_URL: 'not-a-valid-url, ftp://bad-protocol.com, https://valid.zync.app'
      });
      expect(origins).toEqual(['https://valid.zync.app']);
    });
  });

  describe('2. Development Environment CORS Behavior', () => {
    const devApp = createApp(getCorsOptions({ NODE_ENV: 'development' }));

    it('allows requests from http://localhost:5173', async () => {
      const res = await request(devApp)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['vary']).toBe('Origin');
    });

    it('allows requests from http://127.0.0.1:5173', async () => {
      const res = await request(devApp)
        .get('/api/health')
        .set('Origin', 'http://127.0.0.1:5173');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    });

    it('rejects unapproved origin by omitting Access-Control-Allow-Origin', async () => {
      const res = await request(devApp)
        .get('/api/health')
        .set('Origin', 'http://evil-attacker.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows requests without an Origin header (CLI, server-to-server, curl)', async () => {
      const res = await request(devApp).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok', message: 'ZYNC API is running' });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('3. Production Environment CORS Behavior', () => {
    const prodApp = createApp(
      getCorsOptions({
        NODE_ENV: 'production',
        FRONTEND_URL: 'https://zync-app.vercel.app/'
      })
    );

    const prodAppMissingUrl = createApp(
      getCorsOptions({
        NODE_ENV: 'production'
      })
    );

    it('allows the configured production origin (with trailing slash normalized)', async () => {
      const res = await request(prodApp)
        .get('/api/health')
        .set('Origin', 'https://zync-app.vercel.app');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://zync-app.vercel.app');
    });

    it('in production, rejects localhost origins that would have been accepted in dev', async () => {
      const res = await request(prodApp)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('in production, rejects arbitrary unapproved origins', async () => {
      const res = await request(prodApp)
        .get('/api/health')
        .set('Origin', 'https://malicious.example.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('in production without FRONTEND_URL, rejects all browser origins', async () => {
      const res1 = await request(prodAppMissingUrl)
        .get('/api/health')
        .set('Origin', 'http://localhost:5173');
      expect(res1.headers['access-control-allow-origin']).toBeUndefined();

      const res2 = await request(prodAppMissingUrl)
        .get('/api/health')
        .set('Origin', 'https://zync-app.vercel.app');
      expect(res2.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('in production without FRONTEND_URL, still serves CLI requests lacking Origin header', async () => {
      const res = await request(prodAppMissingUrl).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('4. Preflight OPTIONS Requests & Header Policy', () => {
    const app = createApp(
      getCorsOptions({
        NODE_ENV: 'development',
        FRONTEND_URL: 'https://zync-app.vercel.app'
      })
    );

    it('returns 204 No Content for preflight OPTIONS with allowed origin and required headers/methods', async () => {
      const res = await request(app)
        .options('/api/health')
        .set('Origin', 'https://zync-app.vercel.app')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Content-Type, Authorization');

      expect(res.status).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe('https://zync-app.vercel.app');

      // Verify all required methods are supported
      const methods = res.headers['access-control-allow-methods'];
      expect(methods).toContain('GET');
      expect(methods).toContain('POST');
      expect(methods).toContain('PUT');
      expect(methods).toContain('PATCH');
      expect(methods).toContain('DELETE');
      expect(methods).toContain('OPTIONS');

      // Verify required headers for Firebase Auth are allowed
      const headers = res.headers['access-control-allow-headers'];
      expect(headers).toContain('Content-Type');
      expect(headers).toContain('Authorization');
    });

    it('does not send Access-Control-Allow-Origin on preflight from unapproved origin', async () => {
      const res = await request(app)
        .options('/api/health')
        .set('Origin', 'https://attacker.site')
        .set('Access-Control-Request-Method', 'POST');

      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('does not enable Access-Control-Allow-Credentials (no credentialed cookies needed)', async () => {
      const res = await request(app)
        .get('/api/health')
        .set('Origin', 'https://zync-app.vercel.app');

      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });
  });
});
