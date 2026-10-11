import type { Vehicle, VehicleDocument, VehicleMaintenance } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma, type DbClient } from '../prisma.js';

export type VehicleWithDocuments = Vehicle & {
  documents: VehicleDocument[];
  maintenance: VehicleMaintenance[];
  assignedDriver: { id: string; name: string } | null;
};

export type NewVehicleDocument = { label: string; expiryDate: Date; reminderDaysBefore: number };

const withDocuments = {
  documents: { orderBy: { createdAt: 'asc' as const } },
  maintenance: { orderBy: [{ date: 'desc' as const }, { createdAt: 'desc' as const }] },
  assignedDriver: { select: { id: true, name: true } },
};

export function listByGroup(groupId: string, client: DbClient = prisma): Promise<VehicleWithDocuments[]> {
  return client.vehicle.findMany({
    where: { groupId },
    include: withDocuments,
    orderBy: { vehicleNumber: 'asc' },
  });
}

export function findByIdAndGroup(
  id: string,
  groupId: string,
  client: DbClient = prisma,
): Promise<VehicleWithDocuments | null> {
  return client.vehicle.findFirst({ where: { id, groupId }, include: withDocuments });
}

export async function create(
  groupId: string,
  vehicleNumber: string,
  extras: { assignedDriverId?: string | null; documents?: NewVehicleDocument[] } = {},
  client: DbClient = prisma,
): Promise<VehicleWithDocuments | 'duplicate'> {
  try {
    return await client.vehicle.create({
      data: {
        groupId,
        vehicleNumber,
        assignedDriverId: extras.assignedDriverId ?? null,
        documents: extras.documents?.length ? { create: extras.documents } : undefined,
      },
      include: withDocuments,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'duplicate';
    throw err;
  }
}

export async function update(
  id: string,
  groupId: string,
  patch: { vehicleNumber?: string; assignedDriverId?: string | null },
  client: DbClient = prisma,
): Promise<VehicleWithDocuments | null | 'duplicate'> {
  const existing = await client.vehicle.findFirst({ where: { id, groupId } });
  if (!existing) return null;
  try {
    return await client.vehicle.update({ where: { id }, data: patch, include: withDocuments });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return 'duplicate';
    throw err;
  }
}

export async function remove(id: string, groupId: string, client: DbClient = prisma): Promise<boolean> {
  const { count } = await client.vehicle.deleteMany({ where: { id, groupId } });
  return count > 0;
}

export async function addDocument(
  vehicleId: string,
  groupId: string,
  data: NewVehicleDocument,
  client: DbClient = prisma,
): Promise<VehicleWithDocuments | null> {
  const vehicle = await client.vehicle.findFirst({ where: { id: vehicleId, groupId } });
  if (!vehicle) return null;
  await client.vehicleDocument.create({ data: { vehicleId, ...data } });
  return findByIdAndGroup(vehicleId, groupId, client);
}

export async function updateDocument(
  vehicleId: string,
  groupId: string,
  documentId: string,
  patch: { label?: string; expiryDate?: Date; reminderDaysBefore?: number },
  client: DbClient = prisma,
): Promise<VehicleWithDocuments | null | 'document-not-found'> {
  const vehicle = await client.vehicle.findFirst({ where: { id: vehicleId, groupId } });
  if (!vehicle) return null;
  const document = await client.vehicleDocument.findFirst({ where: { id: documentId, vehicleId } });
  if (!document) return 'document-not-found';
  await client.vehicleDocument.update({ where: { id: documentId }, data: patch });
  return findByIdAndGroup(vehicleId, groupId, client);
}

export async function removeDocument(
  vehicleId: string,
  groupId: string,
  documentId: string,
  client: DbClient = prisma,
): Promise<VehicleWithDocuments | null | 'document-not-found'> {
  const vehicle = await client.vehicle.findFirst({ where: { id: vehicleId, groupId } });
  if (!vehicle) return null;
  const { count } = await client.vehicleDocument.deleteMany({ where: { id: documentId, vehicleId } });
  if (!count) return 'document-not-found';
  return findByIdAndGroup(vehicleId, groupId, client);
}

export async function addMaintenance(
  vehicleId: string,
  groupId: string,
  data: { type: string; date: Date; odometer: number | null; cost: number; notes: string },
  client: DbClient = prisma,
): Promise<VehicleWithDocuments | null> {
  const vehicle = await client.vehicle.findFirst({ where: { id: vehicleId, groupId } });
  if (!vehicle) return null;
  await client.vehicleMaintenance.create({ data: { vehicleId, ...data } });
  return findByIdAndGroup(vehicleId, groupId, client);
}

export async function removeMaintenance(
  vehicleId: string,
  groupId: string,
  maintenanceId: string,
  client: DbClient = prisma,
): Promise<VehicleWithDocuments | null | 'maintenance-not-found'> {
  const vehicle = await client.vehicle.findFirst({ where: { id: vehicleId, groupId } });
  if (!vehicle) return null;
  const { count } = await client.vehicleMaintenance.deleteMany({ where: { id: maintenanceId, vehicleId } });
  if (!count) return 'maintenance-not-found';
  return findByIdAndGroup(vehicleId, groupId, client);
}
