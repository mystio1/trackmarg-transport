import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, createTestAdmin, createTestDriver, cleanupGroup } from './helpers.js';

let bizA: Awaited<ReturnType<typeof createTestAdmin>>;
let bizB: Awaited<ReturnType<typeof createTestAdmin>>;
let driverA: Awaited<ReturnType<typeof createTestDriver>>;

beforeAll(async () => {
  bizA = await createTestAdmin('BusinessA');
  bizB = await createTestAdmin('BusinessB');
  driverA = await createTestDriver(bizA.groupCode);
});

afterAll(async () => {
  await cleanupGroup(bizA.groupId);
  await cleanupGroup(bizB.groupId);
});

describe('Tenant isolation — customers', () => {
  let customerAId: string;

  it('admin A creates a customer', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${bizA.token}`)
      .send({ name: 'IsolatedCustomer' });
    expect(res.status).toBe(201);
    customerAId = res.body.customer.id;
  });

  it('admin B cannot see admin A customers', async () => {
    const res = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${bizB.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.customers.map((c: { id: string }) => c.id);
    expect(ids).not.toContain(customerAId);
  });

  it('admin B cannot update admin A customer', async () => {
    const res = await request(app)
      .patch(`/api/customers/${customerAId}`)
      .set('Authorization', `Bearer ${bizB.token}`)
      .send({ name: 'Hacked' });
    expect(res.status).toBe(404);
  });

  it('admin B delete of admin A customer is a no-op (deleteMany matches 0 rows)', async () => {
    // deleteMany with wrong groupId silently deletes nothing — tenant data is safe.
    // The route returns 200 regardless; verify customer still exists in biz A.
    await request(app)
      .delete(`/api/customers/${customerAId}`)
      .set('Authorization', `Bearer ${bizB.token}`);
    const res = await request(app)
      .get('/api/customers')
      .set('Authorization', `Bearer ${bizA.token}`);
    expect(res.body.customers.some((c: { id: string }) => c.id === customerAId)).toBe(true);
  });
});

describe('Tenant isolation — trips', () => {
  let tripAId: string;

  it('driver A submits a trip in biz A', async () => {
    const res = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${driverA.token}`)
      .send({
        customerName: 'TripCust',
        pickupLocation: 'Delhi',
        dropLocation: 'Mumbai',
        vehicleType: 'Truck',
        amount: 5000,
      });
    expect(res.status).toBe(201);
    tripAId = res.body.trip.id;
  });

  it('admin B cannot see biz A trips', async () => {
    const res = await request(app)
      .get('/api/trips')
      .set('Authorization', `Bearer ${bizB.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.trips.map((t: { id: string }) => t.id);
    expect(ids).not.toContain(tripAId);
  });

  it('admin B cannot approve biz A trip', async () => {
    const res = await request(app)
      .post(`/api/trips/${tripAId}/approve`)
      .set('Authorization', `Bearer ${bizB.token}`);
    expect(res.status).toBe(404);
  });
});

describe('Tenant isolation — vehicles', () => {
  let vehicleAId: string;

  it('admin A creates a vehicle', async () => {
    const res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${bizA.token}`)
      .send({ vehicleNumber: 'MH01AB1234' });
    expect(res.status).toBe(201);
    vehicleAId = res.body.vehicle.id;
  });

  it('admin B cannot see biz A vehicles', async () => {
    const res = await request(app)
      .get('/api/vehicles')
      .set('Authorization', `Bearer ${bizB.token}`);
    expect(res.status).toBe(200);
    const ids = res.body.vehicles.map((v: { id: string }) => v.id);
    expect(ids).not.toContain(vehicleAId);
  });

  it('admin B cannot update biz A vehicle', async () => {
    const res = await request(app)
      .patch(`/api/vehicles/${vehicleAId}`)
      .set('Authorization', `Bearer ${bizB.token}`)
      .send({ vehicleNumber: 'HACKED' });
    expect(res.status).toBe(404);
  });
});

describe('Role enforcement', () => {
  it('driver cannot create customers', async () => {
    const res = await request(app)
      .post('/api/customers')
      .set('Authorization', `Bearer ${driverA.token}`)
      .send({ name: 'DriverCustomer' });
    expect(res.status).toBe(403);
  });

  it('driver cannot approve trips', async () => {
    const tripRes = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${driverA.token}`)
      .send({
        customerName: 'C', pickupLocation: 'A', dropLocation: 'B',
        vehicleType: 'Truck', amount: 100,
      });
    const res = await request(app)
      .post(`/api/trips/${tripRes.body.trip.id}/approve`)
      .set('Authorization', `Bearer ${driverA.token}`);
    expect(res.status).toBe(403);
  });

  it('driver cannot create vehicles', async () => {
    const res = await request(app)
      .post('/api/vehicles')
      .set('Authorization', `Bearer ${driverA.token}`)
      .send({ vehicleNumber: 'MH99ZZ0000' });
    expect(res.status).toBe(403);
  });
});
