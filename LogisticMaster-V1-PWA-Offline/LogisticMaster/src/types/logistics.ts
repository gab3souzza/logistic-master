// Compatibilidade de tipos para os dados demonstrativos herdados da primeira versão.
// A aplicação operacional usa os tipos compactos em src/platform/types.ts.
export interface Order { [key: string]: any }
export interface Vehicle { [key: string]: any }
export interface DecisionScenario { [key: string]: any }
export interface TrafficEvent { [key: string]: any }
export interface VehiclePresetSpec { [key: string]: any }
export interface AuditLogEntry { [key: string]: any }
