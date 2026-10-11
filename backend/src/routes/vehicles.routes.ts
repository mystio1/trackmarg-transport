import { Router } from 'express';
import { prisma } from '../db/prisma.js';
import * as vehiclesRepo from '../db/repositories/vehicles.repository.js';
import * as usersRepo from '../db/repositories/users.repository.js';
import * as auditLogsRepo from '../db/repositories/auditLogs.repository.js';
import { serializeVehicle } from '../services/serializers.js';
import { toNumber } from '../services/util.js';
import { broadcast } from '../services/sse.js';
import { requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';

export const vehiclesRouter = Router();

// Vehicles, their assigned driver, maintenance log, and document-expiry reminders (insurance, PUC,
// and any other segment the admin wants to track) — readable by any authenticated user in the
// group, but only an admin can add/edit them.

function parseExpiryDate(value: unknown): Date {
  const expiryDate = String(value || '').trim();
  if (!expiryDate) throw new HttpError(400, 'Expiry date is required');
  const parsed = new Date(expiryDate);
  if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'Enter a valid expiry date');
  return parsed;
}

// null/'' unassigns; anything else must be a driver in the caller's own group.
async function resolveAssignedDriverId(value: unknown, groupId: string): Promise<string | null> {
  const driverId = String(value || '').trim();
  if (!driverId) return null;
  const driver = await usersRepo.findActiveDriverByIdAndGroup(driverId, groupId);
  if (!driver) throw new HttpError(404, 'Driver not found');
  return driver.id;
}

vehiclesRouter.get('/', async (req, res, next) => {
  try {
    const vehicles = await vehiclesRepo.listByGroup(req.auth!.groupId);
    res.status(200).json({ vehicles: vehicles.map((v) => serializeVehicle(v, req.auth!.groupCode)) });
  } catch (err) { next(err); }
});

vehiclesRouter.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const vehicleNumber = String(req.body?.vehicleNumber || '').trim().toUpperCase();
    if (!vehicleNumber) throw new HttpError(400, 'Vehicle number is required');
    // Optional up-front documents (the Add Vehicle form's PUC / Insurance / Fitness / Permit
    // expiry fields) — created together with the vehicle so a half-saved truck can't exist.
    const rawDocuments: unknown[] = Array.isArray(req.body?.documents) ? req.body.documents : [];
    const documents = rawDocuments.map((raw) => {
      const doc = (raw ?? {}) as Record<string, unknown>;
      const label = String(doc.label || '').trim();
      if (!label) throw new HttpError(400, 'Document name is required');
      return {
        label,
        expiryDate: parseExpiryDate(doc.expiryDate),
        reminderDaysBefore: Math.max(0, Math.round(toNumber(doc.reminderDaysBefore) || 7)),
      };
    });
    const assignedDriverId = await resolveAssignedDriverId(req.body?.assignedDriverId, req.auth!.groupId);
    const result = await vehiclesRepo.create(req.auth!.groupId, vehicleNumber, { assignedDriverId, documents });
    if (result === 'duplicate') throw new HttpError(409, 'A vehicle with this number already exists');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'vehicle.create', result.id, { vehicleNumber });
    const serialized = serializeVehicle(result, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'vehicle.create', vehicle: serialized });
    res.status(201).json({ vehicle: serialized });
  } catch (err) { next(err); }
});

vehiclesRouter.patch('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const patch: { vehicleNumber?: string; assignedDriverId?: string | null } = {};
    if (Object.prototype.hasOwnProperty.call(body, 'vehicleNumber')) {
      const vehicleNumber = String(body.vehicleNumber || '').trim().toUpperCase();
      if (!vehicleNumber) throw new HttpError(400, 'Vehicle number is required');
      patch.vehicleNumber = vehicleNumber;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'assignedDriverId')) {
      patch.assignedDriverId = await resolveAssignedDriverId(body.assignedDriverId, req.auth!.groupId);
    }
    if (!Object.keys(patch).length) throw new HttpError(400, 'Vehicle number is required');
    const result = await vehiclesRepo.update(String(req.params.id), req.auth!.groupId, patch);
    if (result === null) throw new HttpError(404, 'Vehicle not found');
    if (result === 'duplicate') throw new HttpError(409, 'A vehicle with this number already exists');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'vehicle.edit', result.id, patch);
    const serialized = serializeVehicle(result, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'vehicle.edit', vehicle: serialized });
    res.status(200).json({ vehicle: serialized });
  } catch (err) { next(err); }
});

vehiclesRouter.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const removed = await vehiclesRepo.remove(id, req.auth!.groupId);
    if (!removed) throw new HttpError(404, 'Vehicle not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'vehicle.delete', id);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'vehicle.delete', vehicleId: id });
    res.status(200).json({ ok: true });
  } catch (err) { next(err); }
});

// A "document" here is one expiry-tracked segment on a vehicle — Insurance and PUC are just the
// two suggested first; `label` is free text so the admin can add any number of other segments.

vehiclesRouter.post('/:id/documents', requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const label = String(body.label || '').trim();
    const expiryDate = String(body.expiryDate || '').trim();
    if (!label) throw new HttpError(400, 'Document name is required');
    if (!expiryDate) throw new HttpError(400, 'Expiry date is required');
    const parsedExpiry = new Date(expiryDate);
    if (Number.isNaN(parsedExpiry.getTime())) throw new HttpError(400, 'Enter a valid expiry date');
    const reminderDaysBefore = Math.max(0, Math.round(toNumber(body.reminderDaysBefore) || 7));

    const result = await vehiclesRepo.addDocument(String(req.params.id), req.auth!.groupId, {
      label, expiryDate: parsedExpiry, reminderDaysBefore,
    });
    if (!result) throw new HttpError(404, 'Vehicle not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'vehicle.document.add', result.id, { label, expiryDate });
    const serialized = serializeVehicle(result, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'vehicle.edit', vehicle: serialized });
    res.status(201).json({ vehicle: serialized });
  } catch (err) { next(err); }
});

vehiclesRouter.patch('/:id/documents/:docId', requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const patch: { label?: string; expiryDate?: Date; reminderDaysBefore?: number } = {};
    if (Object.prototype.hasOwnProperty.call(body, 'label')) {
      const label = String(body.label || '').trim();
      if (!label) throw new HttpError(400, 'Document name is required');
      patch.label = label;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'expiryDate')) {
      const expiryDate = String(body.expiryDate || '').trim();
      if (!expiryDate) throw new HttpError(400, 'Expiry date is required');
      const parsedExpiry = new Date(expiryDate);
      if (Number.isNaN(parsedExpiry.getTime())) throw new HttpError(400, 'Enter a valid expiry date');
      patch.expiryDate = parsedExpiry;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'reminderDaysBefore')) {
      patch.reminderDaysBefore = Math.max(0, Math.round(toNumber(body.reminderDaysBefore) || 0));
    }

    const result = await vehiclesRepo.updateDocument(
      String(req.params.id), req.auth!.groupId, String(req.params.docId), patch,
    );
    if (result === null) throw new HttpError(404, 'Vehicle not found');
    if (result === 'document-not-found') throw new HttpError(404, 'Document not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'vehicle.document.edit', result.id, { documentId: req.params.docId });
    const serialized = serializeVehicle(result, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'vehicle.edit', vehicle: serialized });
    res.status(200).json({ vehicle: serialized });
  } catch (err) { next(err); }
});

vehiclesRouter.delete('/:id/documents/:docId', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await vehiclesRepo.removeDocument(String(req.params.id), req.auth!.groupId, String(req.params.docId));
    if (result === null) throw new HttpError(404, 'Vehicle not found');
    if (result === 'document-not-found') throw new HttpError(404, 'Document not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'vehicle.document.delete', result.id, { documentId: req.params.docId });
    const serialized = serializeVehicle(result, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'vehicle.edit', vehicle: serialized });
    res.status(200).json({ vehicle: serialized });
  } catch (err) { next(err); }
});

// Maintenance log — one entry per job done on the truck (tyre change, service, repair, ...) with
// the odometer reading and cost at the time.

vehiclesRouter.post('/:id/maintenance', requireRole('admin'), async (req, res, next) => {
  try {
    const body = req.body ?? {};
    const type = String(body.type || '').trim();
    if (!type) throw new HttpError(400, 'Maintenance type is required');
    const date = new Date(String(body.date || '').trim());
    if (Number.isNaN(date.getTime())) throw new HttpError(400, 'Enter a valid date');
    const hasOdometer = body.odometer !== undefined && body.odometer !== null && String(body.odometer).trim() !== '';
    const odometer = hasOdometer ? Math.round(toNumber(body.odometer)) : null;
    if (odometer !== null && (odometer < 0 || odometer > 2_000_000_000)) throw new HttpError(400, 'Enter a valid odometer reading');
    const cost = toNumber(body.cost);
    if (cost < 0) throw new HttpError(400, 'Cost cannot be negative');
    const notes = String(body.notes || '').trim();

    const result = await vehiclesRepo.addMaintenance(String(req.params.id), req.auth!.groupId, {
      type, date, odometer, cost, notes,
    });
    if (!result) throw new HttpError(404, 'Vehicle not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'vehicle.maintenance.add', result.id, { type, odometer, cost });
    const serialized = serializeVehicle(result, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'vehicle.edit', vehicle: serialized });
    res.status(201).json({ vehicle: serialized });
  } catch (err) { next(err); }
});

vehiclesRouter.delete('/:id/maintenance/:maintenanceId', requireRole('admin'), async (req, res, next) => {
  try {
    const result = await vehiclesRepo.removeMaintenance(String(req.params.id), req.auth!.groupId, String(req.params.maintenanceId));
    if (result === null) throw new HttpError(404, 'Vehicle not found');
    if (result === 'maintenance-not-found') throw new HttpError(404, 'Maintenance entry not found');
    await auditLogsRepo.create(prisma, req.auth!.user, req.auth!.groupId, 'vehicle.maintenance.delete', result.id, { maintenanceId: req.params.maintenanceId });
    const serialized = serializeVehicle(result, req.auth!.groupCode);
    broadcast(req.auth!.groupId, 'data-changed', { type: 'vehicle.edit', vehicle: serialized });
    res.status(200).json({ vehicle: serialized });
  } catch (err) { next(err); }
});
