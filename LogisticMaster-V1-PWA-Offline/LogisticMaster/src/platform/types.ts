export type Role = 'MANAGER' | 'DISPATCHER' | 'DRIVER' | 'SALES_REP';
export interface User { id: string; name: string; email: string; role: Role; distributorId?: string }
export interface OrderItem {
  id?: string; code?: string; sku?: string; name?: string; description?: string; quantity?: number;
  unitWeightKg?: number; unitVolumeM3?: number; lotNumber?: string; expiryDate?: string;
  shelfLifeDays?: number; fefoPriority?: string; stackingClass?: string; isCurveAPerishable?: boolean;
}
export interface Order {
  id: string; nfe?: string; invoiceNumber?: string; customerName?: string; tradeName: string; cnpj?: string;
  address: string; neighborhood?: string; city?: string; state?: string; cep?: string;
  weightKg: number; volumeM3: number; timeWindow?: string; status: string; truckId?: string; routeId?: string;
  lifoPosition?: number; lat?: number | null; lng?: number | null; totalValue?: number;
  items?: OrderItem[]; fefoCompliance?: number; earliestExpiryDate?: string; criticalItemName?: string;
  missingFields?: string[]; deliveredAt?: string; deliveredWeightKg?: number; retainedWeightKg?: number;
  occurrenceReason?: string; createdAt?: string; source?: string;
  nfePdfAvailable?: boolean; nfePdfFilename?: string; nfePdfUploadedAt?: string;
  originalWeightKg?: number; originalVolumeM3?: number; retainedVolumeM3?: number;
}
export interface Vehicle {
  id: string; name: string; model: string; plate: string; driverName: string; driverPhone?: string;
  maxWeightKg: number; maxVolumeM3: number; currentWeightKg: number; currentVolumeM3: number;
  fuelConsumptionKmL?: number; status: string; allocatedOrders: string[]; routeDescription?: string;
  currentLocation?: string; etaNextStop?: string; lat?: number | null; lng?: number | null;
  activeRouteId?: string;
}
export interface Route {
  id: string; vehicleId: string; driverName?: string; status: string; orderIds: string[]; stopCount: number; estimatedKm?: number | null; geographyCoveragePct?: number;
  totalWeightKg: number; totalVolumeM3: number; description?: string; createdAt?: string;
}
export interface Retailer {
  id: string; tradeName: string; cnpj?: string; address: string; neighborhood?: string; city?: string;
  lat?: number | null; lng?: number | null; avgUnloadMinutes?: number; completedDeliveriesCount?: number;
}
export interface Config {
  dieselPricePerLiter: number; crewHourlyRate: number; redeliveryDistanceKm: number; avgFuelEfficiencyKmL: number;
  redeliveryFixedTimeHours: number; reverseProcessingCost: number; minProfitMarginPct: number;
  defaultUnloadMinutes: number; geofenceRadiusMeters: number; trafficDelayThresholdMinutes: number;
  offlineWindowHours: number; maxVehicleUtilizationPct: number;
}


export interface CommunicationMessage {
  id: string;
  clientEventId?: string;
  routeId?: string | null;
  orderId?: string | null;
  senderId: string;
  senderName: string;
  senderRole: Role;
  kind: 'arrived'|'waiting'|'help'|'delay'|'next_stop'|'text'|'central_reply'|string;
  message: string;
  createdAt: string;
}
