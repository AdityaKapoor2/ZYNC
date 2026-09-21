import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { verifySuperAdmin } from '../src/middleware/adminMiddleware.js';
import UserProfile from '../src/models/UserProfile.js';
import { connectTestDB, closeTestDB, clearTestDB } from './setup.js';

describe('Admin Middleware: verifySuperAdmin', () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    vi.restoreAllMocks();
  });

  it('1. Authenticated normal user - returns 403', async () => {
    await UserProfile.create({
      firebaseUid: 'user123',
      email: 'user@test.com',
      displayName: 'Normal User',
      role: 'user'
    });

    const req = { user: { uid: 'user123' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
    const next = vi.fn();

    await verifySuperAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden' });
  });

  it('2. Authenticated super admin - calls next()', async () => {
    await UserProfile.create({
      firebaseUid: 'admin123',
      email: 'admin@test.com',
      displayName: 'Super Admin',
      role: 'super_admin'
    });

    const req = { user: { uid: 'admin123' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
    const next = vi.fn();

    await verifySuperAdmin(req, res, next);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('3. Missing profile - returns 403', async () => {
    const req = { user: { uid: 'nonexistent' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
    const next = vi.fn();

    await verifySuperAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden' });
  });

  it('4. Missing UID - returns 403', async () => {
    const req = { user: {} };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
    const next = vi.fn();

    await verifySuperAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: 'Forbidden' });
  });

  it('5. Database/query failure - returns 500', async () => {
    vi.spyOn(UserProfile, 'findOne').mockRejectedValueOnce(new Error('DB Error'));

    const req = { user: { uid: 'admin123' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
    const next = vi.fn();

    await verifySuperAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ message: 'Internal server error' });
  });
});
