import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, createTestAdmin, createTestDriver, cleanupGroup } from './helpers.js';

let admin: Awaited<ReturnType<typeof createTestAdmin>>;
let driver: Awaited<ReturnType<typeof createTestDriver>>;

beforeAll(async () => {
  admin = await createTestAdmin('CustBiz');
  driver = await createTestDriver(admin.groupCode);
});

afterAll(async () => {
  await cleanupGroup(admin.groupId);
});

describe('Customer CRUD', () => {
  let customerId: string;

  it('admin creates a customer', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'Acme Transport', phone: '9876543210', address: 'Mumbai' });
    expect(res.status).toBe(201);
    expect(res.body.customer.name).toBe('Acme Transport');
    customerId = res.body.customer.id;
  });

  it('admin lists customers', async () => {
    const res = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.customers.some((c: { id: string }) => c.id === customerId)).toBe(true);
  });

  it('admin updates a customer', async () => {
    const res = await request(app)
      .patch(`/api/customers/${customerId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ address: 'Delhi' });
    expect(res.status).toBe(200);
    expect(res.body.customer.address).toBe('Delhi');
  });

  it('rejects customer without a name', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('driver cannot create customers', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ name: 'DriverCreated' });
    expect(res.status).toBe(403);
  });

  it('admin deletes a customer', async () => {
    const res = await request(app)
      .delete(`/api/customers/${customerId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
  });
});

describe('Customer advance payments', () => {
  let customerId: string;
  let advanceId: string;

  it('admin creates customer and adds advance', async () => {
    const custRes = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ name: 'AdvanceCust' });
    customerId = custRes.body.customer.id;

    const res = await request(app)
      .post(`/api/customers/${customerId}/advance`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ amount: 5000, note: 'Initial advance' });
    expect(res.status).toBe(200);
    advanceId = res.body.customer.advanceHistory[0].id;
  });

  it('rejects zero advance amount', async () => {
    const res = await request(app)
      .post(`/api/customers/${customerId}/advance`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ amount: 0 });
    expect(res.status).toBe(400);
  });

  it('soft-deletes an advance entry', async () => {
    const res = await request(app)
      .delete(`/api/customers/${customerId}/advance/${advanceId}`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
  });
});
