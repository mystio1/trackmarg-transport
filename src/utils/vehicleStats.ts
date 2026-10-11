import type { Trip, Vehicle } from '../types';

// Trips carry the vehicle as free text typed by whoever entered the trip, so "MH 12 AB-1234" and
// "mh12ab1234" have to count as the same truck — compare on letters and digits only.
export function normalizeVehicleNumber(value: string | undefined): string {
  return (value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Shared by the Vehicles list and the vehicle details page so both report the same numbers.
// Rejected trips never happened as far as income goes, so they're left out.
export function tripsForVehicle(vehicle: Vehicle, trips: Trip[]): Trip[] {
  const number = normalizeVehicleNumber(vehicle.vehicleNumber);
  if (!number) return [];
  return trips.filter(t => t.status !== 'rejected' && normalizeVehicleNumber(t.vehicleNumber) === number);
}

export function tripIncome(trips: Trip[]): number {
  return trips.reduce((sum, t) => sum + Number(t.amount || 0), 0);
}

// The vehicle's latest known odometer — the highest reading logged against any maintenance entry.
export function currentOdometer(vehicle: Vehicle): number | undefined {
  const readings = vehicle.maintenance.map(m => m.odometer).filter((o): o is number => typeof o === 'number');
  return readings.length ? Math.max(...readings) : undefined;
}

export function maintenanceCost(vehicle: Vehicle): number {
  return vehicle.maintenance.reduce((sum, m) => sum + Number(m.cost || 0), 0);
}
