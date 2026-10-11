import request from 'supertest';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app, createTestAdmin, createTestDriver, cleanupGroup } from './helpers.js';

let admin: Awaited<ReturnType<typeof createTestAdmin>>;
let driver: Awaited<ReturnType<typeof createTestDriver>>;

beforeAll(async () => {
  admin = await createTestAdmin('TripBiz');
  driver = await createTestDriver(admin.groupCode);
});

afterAll(async () => {
  await cleanupGroup(admin.groupId);
});

describe('Trip lifecycle', () => {
  let tripId: string;

  it('driver submits a pending trip', async () => {
    const res = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${driver.token}`)
      .send({
        customerName: 'TripCustomer',
        pickupLocation: 'Pune',
        dropLocation: 'Nagpur',
        vehicleType: 'Truck',
        amount: 8000,
      });
    expect(res.status).toBe(201);
    expect(res.body.trip.status).toBe('pending');
    tripId = res.body.trip.id;
  });

  it('driver can edit their own pending trip', async () => {
    const res = await request(app)
      .patch(`/api/trips/${tripId}`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ amount: 9000 });
    expect(res.status).toBe(200);
    expect(res.body.trip.amount).toBe(9000);
  });

  it('admin approves the trip', async () => {
    const res = await request(app)
      .post(`/api/trips/${tripId}/approve`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(res.status).toBe(200);
    expect(res.body.trip.status).toBe('approved');
  });

  it('driver cannot directly edit an approved trip', async () => {
    const res = await request(app)
      .patch(`/api/trips/${tripId}`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ amount: 10000 });
    expect(res.status).toBe(403);
  });

  it('driver can submit an edit request for approved trip', async () => {
    const res = await request(app)
      .post(`/api/trips/${tripId}/edit-requests`)
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ message: 'Amount was wrong, should be 10000' });
    expect(res.status).toBe(201);
    expect(res.body.request.status).toBe('pending');
  });
});

describe('Trip validation', () => {
  it('rejects trip without required fields', async () => {
    const res = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${driver.token}`)
      .send({ customerName: 'X' });
    expect(res.status).toBe(400);
  });

  it('rejects trip with zero amount', async () => {
    const res = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${driver.token}`)
      .send({
        customerName: 'X', pickupLocation: 'A', dropLocation: 'B',
        vehicleType: 'Truck', amount: 0,
      });
    expect(res.status).toBe(400);
  });
});

describe('Trip idempotency (clientRequestId)', () => {
  it('replays the same clientRequestId without creating a duplicate', async () => {
    const crid = `test-${Date.now()}`;
    const payload = {
      customerName: 'IdempotentCust', pickupLocation: 'A', dropLocation: 'B',
      vehicleType: 'Truck', amount: 5000, clientRequestId: crid,
    };
    const res1 = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${driver.token}`)
      .send(payload);
    expect(res1.status).toBe(201);

    const res2 = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${driver.token}`)
      .send(payload);
    expect(res2.status).toBe(200);
    expect(res2.body.trip.id).toBe(res1.body.trip.id);
  });
});

describe('Admin-created trips', () => {
  it('admin trip is auto-approved', async () => {
    const res = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        customerName: 'AdminCustomer', pickupLocation: 'Delhi', dropLocation: 'Agra',
        vehicleType: 'Truck', amount: 12000, driverId: 'self',
      });
    expect(res.status).toBe(201);
    expect(res.body.trip.status).toBe('approved');
  });

  it('admin trip requires driverId', async () => {
    const res = await request(app)
      .post('/api/trips')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        customerName: 'NoDrv', pickupLocation: 'A', dropLocation: 'B',
        vehicleType: 'Truck', amount: 100,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/driver/i);
  });
});
