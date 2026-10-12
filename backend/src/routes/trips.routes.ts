import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import * as tripsRepo from '../db/repositories/trips.repository.js';
import * as customersRepo from '../db/repositories/customers.repository.js';
import * as usersRepo from '../db/repositories/users.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import * as tripEditRequestsRepo from '../db/repositories/tripEditRequests.repository.js';
import { serializeTrip, serializeTripEditRequest } from '../services/serializers.js';
import { toNumber } from '../services/util.js';
import { broadcast } from '../services/sse.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';

export const tripsRouter = Router();

function validateTripInput(body: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (!String(body.customerName || '').trim() && !String(body.customerId || '').trim()) {
    errors.push('Customer is required');
  }
  if (!String(body.pickupLocation || '').trim()) errors.push('Pickup location is required');
  if (!String(body.dropLocation || '').trim()) errors.push('Drop location is required');
  if (toNumber(body.amount) <= 0) errors.push('Amount must be greater than zero');
  if (toNumber(body.advanceAmount) < 0) errors.push('Advance amount cannot be negative');
  return errors;
}

tripsRouter.get('/', async (req, res, next) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const isAdmin = req.auth!.user.role === 'admin';
    const trips = await tripsRepo.listByGroup(req.auth!.groupId, {
      status,
      driverId: isAdmin ? undefined : req.auth!.user.id,
    });
    res.status(200).json({ trips: trips.map((t) => serializeTrip(t, req.auth!.groupCode)) });
  } catch (err) { next(err); }
});

tripsRouter.post('/', async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const errors = validateTripInput(body);
    if (errors.length) throw new HttpError(400, errors.join(', '));

    const isAdmin = req.auth!.user.role === 'admin';
    let customerId: string | null = null;
    let customerName = String(body.customerName || '').trim();
    let customerPhone = String(body.customerPhone || '').trim();
    let customerAddress = String(body.customerAddress || '').trim();

    if (body.customerId) {
      const existing = await customersRepo.findByIdAndGroup(String(body.customerId), req.auth!.groupId);
      if (existing) {
        customerId = existing.id;
        customerName = existing.name;
        customerPhone = existing.phone;
        customerAddress = existing.address;
      }
    }

    // Admin-direct entries are auto-approved and immediately attached to a real customer record
    // (creating one on the fly if the typed name doesn't match anything yet); driver submissions
    // stay unlinked until an admin approves them (see /:id/approve below), matching the original
    // app's "customer picking happens at approval time for driver submissions" behavior.
    if (isAdmin) {
      const customer = await customersRepo.findOrCreate(req.auth!.groupId, {
        customerId: customerId || undefined, customerName, customerPhone, customerAddress,
      });
      customerId = customer.id;
      customerName = customer.name;
    }

    // Admin-created trips must be explicitly attributed to a driver or to the admin themself
    // ("Self") — the UI makes this a required field so a trip is never silently misattributed.
    // Driver-submitted trips skip this: they're always attributed to the submitting driver.
    let driverId = req.auth!.user.id;
    let driverName = req.auth!.user.name;
    let driverCode = req.auth!.user.userCode || '';
    if (isAdmin) {
      const selectedDriverId = String(body.driverId || '').trim();
      if (!selectedDriverId) throw new HttpError(400, 'Select a driver (or Self) for this trip');
      if (selectedDriverId !== 'self') {
        const selectedDriver = await usersRepo.findActiveDriverByIdAndGroup(selectedDriverId, req.auth!.groupId);
        if (!selectedDriver) throw new HttpError(400, 'Selected driver not found');
        driverId = selectedDriver.id;
        driverName = selectedDriver.name;
        driverCode = selectedDriver.userCode || '';
      }
    }

    const { trip, replayed } = await tripsRepo.create({
      groupId: req.auth!.groupId,
      customerId,
      customerName,
      customerPhone,
      customerAddress,
      driverId,
      driverName,
      driverCode,
      date: body.date ? new Date(String(body.date)) : new Date(),
      pickupLocation: String(body.pickupLocation || '').trim(),
      dropLocation: String(body.dropLocation || '').trim(),
      amount: toNumber(body.amount),
      advanceAmount: toNumber(body.advanceAmount),
      isPaid: Boolean(body.isPaid),
      paymentMode: String(body.paymentMode || '').trim(),
      vehicleType: String(body.vehicleType || '').trim(),
      vehicleNumber: String(body.vehicleNumber || '').trim(),
      materialType: String(body.materialType || '').trim(),
      status: isAdmin ? 'approved' : 'pending',
      approvedById: isAdmin ? req.auth!.user.id : null,
      clientRequestId: body.clientRequestId ? String(body.clientRequestId).trim() : null,
    });

    if (!replayed) {
      await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, isAdmin ? 'trip.create.approved' : 'trip.submit', trip.id);
      const serialized = serializeTrip(trip, req.auth!.groupCode);
      broadcast(req.auth!.groupId, 'trip-submitted', { trip: serialized });
      broadcast(req.auth!.groupId, 'data-changed', { type: 'trip.create', trip: serialized });
    }
    res.status(replayed ? 200 : 201).json({ trip: serializeTrip(trip, req.auth!.groupCode) });
  } catch (err) { next(err); }
});

// A driver can edit their own trip directly ONLY while it's still pending admin review — once
// approved, the numbers may already be reflected in billing, so a driver-side change instead
// goes through the edit-request flow below for an admin to apply deliberately.
tripsRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const isAdmin = req.auth!.user.role === 'admin';
    if (!isAdmin) {
      const existing = await tripsRepo.findByIdAndGroup(id, req.auth!.groupId);
      if (!existing) throw new HttpError(404, 'Trip not found');
      if (existing.driverId !== req.auth!.user.id || existing.status !== 'pending') {
        throw new HttpError(403, 'You can only edit your own trip while it is still pending approval');
      }
    }
    let trip;
    try {
      trip = await tripsRepo.update(id, req.auth!.groupId, req.body ?? {}, { isAdmin });
    } catch (err) {
      if (err instanceof RangeError) throw new HttpError(400, err.message);
      throw err;
    }
    if (!trip) throw new HttpError(404, 'Trip not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, isAdmin ? 'trip.edit' : 'trip.edit.driver', trip.id);
    const serialized = serializeTrip(trip, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'trip-updated', { trip: serialized });
    broadcast(req.auth!.groupId, 'data-changed', { type: 'trip.edit', trip: serialized });
    res.status(200).json({ trip: serialized });
  } catch (err) { next(err); }
});

// A driver's ask for a change to a trip that's already approved (and so can't be edited
// directly anymore, per the rule above) — an admin reviews the message and applies it
// themself via the PATCH route above, then resolves this request.
tripsRouter.post('/:id/edit-requests', requireRole('driver'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const trip = await tripsRepo.findByIdAndGroup(id, req.auth!.groupId);
    if (!trip) throw new HttpError(404, 'Trip not found');
    if (trip.driverId !== req.auth!.user.id) throw new HttpError(403, 'You can only request changes to your own trips');
    if (trip.status !== 'approved') {
      throw new HttpError(400, 'Only approved trips need an update request — pending trips can be edited directly');
    }
    const message = String(req.body?.message || '').trim();
    if (!message) throw new HttpError(400, 'Describe what needs to change');

    const request = await tripEditRequestsRepo.create({
      groupId: req.auth!.groupId, tripId: trip.id,
      driverId: req.auth!.user.id, driverName: req.auth!.user.name, message,
    });
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'trip.editRequest.create', trip.id, { message });
    const serialized = serializeTripEditRequest(request);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'tripEditRequest.create', request: serialized });
    res.status(201).json({ request: serialized });
  } catch (err) { next(err); }
});

// Record a payment against a trip — supports partial payments (admin types an amount) or "mark
// fully paid" (fills in whatever balance remains). Optionally draws the amount down from the
// customer's pre-paid advance balance instead of treating it as a fresh payment.
tripsRouter.post('/:id/payment', requireRole('admin'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const body = req.body ?? {};
    const result = await prisma.$transaction((tx) =>
      tripsRepo.recordPayment(id, req.auth!.groupId, {
        amount: toNumber(body.amount),
        fullyPaid: Boolean(body.fullyPaid),
        fromAdvance: Boolean(body.fromAdvance),
        paymentMode: body.paymentMode,
        note: body.note,
      }, tx),
    );
    if (result === 'not-found') throw new HttpError(404, 'Trip not found');
    if (result === 'zero-amount') throw new HttpError(400, 'Enter an amount greater than zero');
    if (result === 'insufficient-advance') throw new HttpError(400, 'Not enough advance balance available for this payment');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'trip.payment', result.trip.id, { fromAdvance: Boolean(body.fromAdvance) });
    const serialized = serializeTrip(result.trip, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'trip-updated', { trip: serialized });
    broadcast(req.auth!.groupId, 'data-changed', { type: 'trip.edit', trip: serialized });
    res.status(200).json({ trip: serialized });
  } catch (err) { next(err); }
});

tripsRouter.post('/:id/approve', requireRole('admin'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const existing = await tripsRepo.findByIdAndGroup(id, req.auth!.groupId);
    if (!existing) throw new HttpError(404, 'Trip not found');
    const customer = await customersRepo.findOrCreate(req.auth!.groupId, {
      customerId: existing.customerId || undefined,
      customerName: existing.customerName,
      customerPhone: existing.customerPhone,
      customerAddress: existing.customerAddress,
    });
    const trip = await tripsRepo.approve(id, req.auth!.groupId, req.auth!.user.id, customer);
    if (!trip) throw new HttpError(404, 'Trip not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'trip.approve', trip.id);
    const serialized = serializeTrip(trip, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'trip-updated', { trip: serialized });
    broadcast(req.auth!.groupId, 'data-changed', { type: 'trip.approve', trip: serialized });
    res.status(200).json({ trip: serialized });
  } catch (err) { next(err); }
});

tripsRouter.post('/:id/reject', requireRole('admin'), async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || 'Rejected by admin').trim();
    const trip = await tripsRepo.reject(String(req.params.id), req.auth!.groupId, reason);
    if (!trip) throw new HttpError(404, 'Trip not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'trip.reject', trip.id, { reason });
    const serialized = serializeTrip(trip, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'trip-updated', { trip: serialized });
    broadcast(req.auth!.groupId, 'data-changed', { type: 'trip.reject', trip: serialized });
    res.status(200).json({ trip: serialized });
  } catch (err) { next(err); }
});
