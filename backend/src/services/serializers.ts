// Shapes Prisma model instances into the exact JSON the frontend already expects (see
// src/types/index.ts) — the frontend contract predates this rebuild and is left unchanged, so
// this is the one place that bridges Prisma's schema (groupId FKs, Decimal fields, camelCase
// relation names) back to the legacy groupCode-keyed, plain-number shape the UI was built against.
import type {
  User, Group, Customer, AdvanceEntry, Trip, Bill, BillTripLine, Vehicle, VehicleDocument, VehicleMaintenance,
  TripEditRequest, DriverTransaction, DriverTransactionCategory, Prisma,
} from '@prisma/client';

function dec(value: Prisma.Decimal | number): number {
  return typeof value === 'number' ? value : value.toNumber();
}

function iso(value: Date | null | undefined): string | undefined {
  return value ? value.toISOString() : undefined;
}

export function serializeUser(user: User, groupCode: string) {
  return {
    id: user.id,
    groupCode,
    role: user.role,
    name: user.name,
    phone: user.phone,
    email: user.email || undefined,
    userCode: user.userCode || undefined,
    active: user.active,
    baseSalary: dec(user.baseSalary),
    joiningDate: iso(user.joiningDate),
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export function serializeGroup(group: Pick<Group, 'code' | 'name' | 'createdAt' | 'frozen'>) {
  return { code: group.code, name: group.name, createdAt: group.createdAt.toISOString(), frozen: group.frozen };
}

export function serializeAdvanceEntry(entry: AdvanceEntry) {
  return {
    id: entry.id,
    amount: dec(entry.amount),
    note: entry.note,
    date: entry.date.toISOString(),
    createdAt: entry.createdAt.toISOString(),
    deleted: entry.deleted || undefined,
    deletedAt: iso(entry.deletedAt),
    usedInBillNo: entry.usedInBillNo || undefined,
  };
}

export function serializeDriverTransaction(entry: DriverTransaction & { category?: { name: string } | null }) {
  return {
    id: entry.id,
    categoryId: entry.categoryId || undefined,
    categoryName: entry.category?.name ?? 'Other',
    amount: dec(entry.amount),
    note: entry.note,
    date: entry.date.toISOString(),
    deductFromSalary: entry.deductFromSalary,
    businessEffect: entry.businessEffect,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function serializeDriverTransactionCategory(category: DriverTransactionCategory) {
  return { id: category.id, name: category.name, isDefault: category.isDefault };
}

export function serializeCustomer(
  customer: Customer & { advanceEntries?: AdvanceEntry[] },
  groupCode: string,
) {
  return {
    id: customer.id,
    groupCode,
    name: customer.name,
    phone: customer.phone,
    address: customer.address,
    email: customer.email || undefined,
    gstNumber: customer.gstNumber || undefined,
    advanceBalance: dec(customer.advanceBalance),
    advanceHistory: (customer.advanceEntries || []).map(serializeAdvanceEntry),
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

export function serializeTrip(trip: Trip, groupCode: string) {
  return {
    id: trip.id,
    groupCode,
    customerId: trip.customerId || '',
    customerName: trip.customerName,
    customerPhone: trip.customerPhone,
    customerAddress: trip.customerAddress,
    driverId: trip.driverId,
    driverName: trip.driverName,
    driverCode: trip.driverCode,
    date: trip.date.toISOString(),
    pickupLocation: trip.pickupLocation,
    dropLocation: trip.dropLocation,
    amount: dec(trip.amount),
    advanceAmount: dec(trip.advanceAmount),
    isPaid: trip.isPaid,
    paidAmount: dec(trip.paidAmount),
    paymentMode: trip.paymentMode,
    paymentNote: trip.paymentNote || undefined,
    paidAt: iso(trip.paidAt),
    vehicleType: trip.vehicleType,
    vehicleNumber: trip.vehicleNumber,
    materialType: trip.materialType,
    status: trip.status,
    rejectionReason: trip.rejectionReason,
    submittedAt: trip.submittedAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
    approvedAt: iso(trip.approvedAt),
    approvedBy: trip.approvedById || undefined,
    clientRequestId: trip.clientRequestId || undefined,
  };
}

export function serializeBill(bill: Bill & { tripLines?: BillTripLine[] }, groupCode: string) {
  return {
    id: bill.id,
    groupCode,
    customerId: bill.customerId || '',
    customerName: bill.customerName,
    billNo: bill.billNo,
    billDate: bill.billDate.toISOString(),
    isGstBill: bill.isGstBill,
    gstPercent: dec(bill.gstPercent),
    discount: dec(bill.discount),
    subTotal: dec(bill.subTotal),
    received: dec(bill.received),
    gstAmount: dec(bill.gstAmount),
    grandTotal: dec(bill.grandTotal),
    advanceApplied: dec(bill.advanceApplied),
    netPayable: dec(bill.netPayable),
    amountInWords: bill.amountInWords,
    trips: (bill.tripLines || []).map((line) => ({
      tripId: line.tripId || '',
      date: iso(line.date) || '',
      pickupLocation: line.pickupLocation,
      dropLocation: line.dropLocation,
      amount: dec(line.amount),
      paidAmount: dec(line.paidAmount),
    })),
    createdAt: bill.createdAt.toISOString(),
    createdBy: bill.createdBy,
    deleted: bill.deleted || undefined,
    deletedAt: iso(bill.deletedAt),
    customerPhone: bill.customerPhone,
    customerAddress: bill.customerAddress,
    customerGst: bill.customerGst,
    bankName: bill.bankName,
    bankBranch: bill.bankBranch,
    accountNumber: bill.accountNumber,
    ifscCode: bill.ifscCode,
  };
}

export function serializeVehicleDocument(document: VehicleDocument) {
  return {
    id: document.id,
    label: document.label,
    expiryDate: document.expiryDate.toISOString(),
    reminderDaysBefore: document.reminderDaysBefore,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

export function serializeVehicleMaintenance(entry: VehicleMaintenance) {
  return {
    id: entry.id,
    type: entry.type,
    date: entry.date.toISOString(),
    odometer: entry.odometer ?? undefined,
    cost: dec(entry.cost),
    notes: entry.notes || undefined,
    createdAt: entry.createdAt.toISOString(),
  };
}

export function serializeVehicle(
  vehicle: Vehicle & {
    documents?: VehicleDocument[];
    maintenance?: VehicleMaintenance[];
    assignedDriver?: { id: string; name: string } | null;
  },
  groupCode: string,
) {
  return {
    id: vehicle.id,
    groupCode,
    vehicleNumber: vehicle.vehicleNumber,
    assignedDriverId: vehicle.assignedDriverId || undefined,
    assignedDriverName: vehicle.assignedDriver?.name || undefined,
    documents: (vehicle.documents || []).map(serializeVehicleDocument),
    maintenance: (vehicle.maintenance || []).map(serializeVehicleMaintenance),
    createdAt: vehicle.createdAt.toISOString(),
    updatedAt: vehicle.updatedAt.toISOString(),
  };
}

export function serializeTripEditRequest(request: TripEditRequest) {
  return {
    id: request.id,
    tripId: request.tripId,
    driverId: request.driverId,
    driverName: request.driverName,
    message: request.message,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
    resolvedAt: iso(request.resolvedAt),
  };
}
