import request from 'supertest';
import { describe, it, expect, afterAll } from 'vitest';
import { app, createTestAdmin, cleanupGroup } from './helpers.js';

const groupIds: string[] = [];
let phoneCounter = Date.now() % 100000000;
function uniquePhone() { return String(++phoneCounter).padStart(10, '9'); }

afterAll(async () => {
  for (const id of groupIds) await cleanupGroup(id);
});

describe('POST /api/auth/signup', () => {
  it('creates an admin with a new group', async () => {
    const phone = uniquePhone();
    const res = await request(app)
      .post('/api/auth/signup')
      .set('X-Forwarded-For', `10.99.${++phoneCounter % 256}.1`)
      .send({ name: 'Alice', phone, password: 'secret123', role: 'admin', groupName: 'AliceBiz' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('admin');
    expect(res.body.group.name).toBe('AliceBiz');
    groupIds.push(res.body.group.id);
  });

  it('creates a driver in an existing group', async () => {
    const admin = await createTestAdmin();
    groupIds.push(admin.groupId);
    const res = await request(app)
      .post('/api/auth/signup')
      .set('X-Forwarded-For', `10.99.${++phoneCounter % 256}.2`)
      .send({ name: 'Bob', phone: uniquePhone(), password: 'secret123', role: 'driver', groupCode: admin.groupCode });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('driver');
  });

  it('rejects driver signup without a group code', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('X-Forwarded-For', `10.99.${++phoneCounter % 256}.3`)
      .send({ name: 'NoGroup', phone: uniquePhone(), password: 'secret123', role: 'driver' });
    expect(res.status).toBe(400);
  });

  it('rejects duplicate phone in the same group', async () => {
    const admin = await createTestAdmin();
    groupIds.push(admin.groupId);
    const phone = uniquePhone();
    const ip = `10.99.${++phoneCounter % 256}.4`;
    const res = await request(app)
      .post('/api/auth/signup')
      .set('X-Forwarded-For', ip)
      .send({ name: 'Dup', phone, password: 'secret123', role: 'driver', groupCode: admin.groupCode });
    expect(res.status).toBe(201);
    const res2 = await request(app)
      .post('/api/auth/signup')
      .set('X-Forwarded-For', `10.99.${++phoneCounter % 256}.5`)
      .send({ name: 'Dup2', phone, password: 'secret123', role: 'driver', groupCode: admin.groupCode });
    expect(res2.status).toBe(409);
  });

  it('rejects short passwords', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .set('X-Forwarded-For', `10.99.${++phoneCounter % 256}.6`)
      .send({ name: 'Short', phone: uniquePhone(), password: '12345', role: 'admin', groupName: 'ShortPw' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/6 characters/);
  });
});

describe('POST /api/auth/login', () => {
  const loginPhone = `8${Date.now().toString().slice(-9)}`;

  it('logs in with correct credentials', async () => {
    const admin = await createTestAdmin();
    groupIds.push(admin.groupId);
    await request(app)
      .post('/api/auth/signup')
      .set('X-Forwarded-For', `10.99.${++phoneCounter % 256}.7`)
      .send({ name: 'LoginTest', phone: loginPhone, password: 'loginpass1', role: 'driver', groupCode: admin.groupCode });

    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', `10.99.${++phoneCounter % 256}.8`)
      .send({ phone: loginPhone, password: 'loginpass1' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects wrong password with generic message', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', `10.99.${++phoneCounter % 256}.9`)
      .send({ phone: loginPhone, password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid phone number or password');
  });

  it('rejects nonexistent phone with same generic message', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', `10.99.${++phoneCounter % 256}.10`)
      .send({ phone: '0000000000', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid phone number or password');
  });
});

describe('Auth token validation', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with a garbage token', async () => {
    const res = await request(app).get('/api/me').set('Authorization', 'Bearer garbage.token');
    expect(res.status).toBe(401);
  });

  it('returns user data with a valid token', async () => {
    const admin = await createTestAdmin();
    groupIds.push(admin.groupId);
    const res = await request(app).get('/api/me').set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(admin.userId);
  });
});
