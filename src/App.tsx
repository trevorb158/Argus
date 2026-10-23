import { Fragment, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import { useTheme } from "./useTheme";
import "./App.css";

// --- Types (preserved) ---
type TelemetrySnapshot = {
  cpuUsagePercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
};
type CoreUsageSnapshot = { name: string; usagePercent: number };
type PerformanceSnapshot = {
  cpuUsagePercent: number;
  cores: CoreUsageSnapshot[];
  memoryUsedBytes: number;
  memoryAvailableBytes: number;
  memoryTotalBytes: number;
  swapUsedBytes: number;
  swapTotalBytes: number;
  diskReadBytesPerSecond: number;
  diskWriteBytesPerSecond: number;
};
type TemperatureSnapshot = {
  label: string;
  temperatureCelsius: number;
  criticalCelsius: number | null;
};
type GpuSnapshot = {
  name: string;
  utilizationPercent: number;
  vramUsedBytes: number;
  vramTotalBytes: number;
  temperatureCelsius: number | null;
};
type FanSnapshot = { label: string; rpm: number };
type HardwareExtraSnapshot = { gpus: GpuSnapshot[]; fans: FanSnapshot[] };
type NetworkCountersSnapshot = {
  name: string;
  macAddress: string;
  ipAddresses: string[];
  receivedBytes: number;
  transmittedBytes: number;
  isLoopback: boolean;
};
type NetworkInterfaceSnapshot = NetworkCountersSnapshot & {
  downloadBytesPerSecond: number;
  uploadBytesPerSecond: number;
};
type NetworkRouteSnapshot = {
  defaultGateway: string | null;
  defaultInterface: string | null;
  dnsServers: string[];
  gatewayError: string | null;
  dnsError: string | null;
};
type NetworkConnectionSnapshot = {
  protocol: string;
  state: string;
  localAddress: string;
  remoteAddress: string;
  process: string;
  pid: number | null;
};
type StartupAppSnapshot = {
  id: string;
  name: string;
  command: string;
  source: string;
  enabled: boolean;
  isSystemEntry: boolean;
  hasUserOverride: boolean;
};
type StartupActionStatus = { kind: "success" | "error"; message: string };
type OperationRecord = {
  id: string;
  timestamp: number;
  category: "Process" | "Service" | "Startup" | "Storage" | "Maintenance";
  action: string;
  target: string;
  outcome: "success" | "failed";
  note: string;
};
type OperationDetails = Omit<OperationRecord, "id" | "timestamp">;
type ServiceSnapshot = {
  unit: string;
  description: string;
  scope: "System" | "User";
  activeState: string;
  subState: string;
  startupState: string;
};
type ServiceInventory = { services: ServiceSnapshot[]; warnings: string[] };
type ServiceActionPreview = {
  relationship: string;
  relatedUnits: string[];
  totalUnits: number;
  truncated: boolean;
  note: string;
};
type ServiceFilter = "all" | "active" | "failed" | "enabled";
type BatterySnapshot = {
  name: string;
  capacityPercent: number | null;
  status: string | null;
  healthPercent: number | null;
  cycleCount: number | null;
};
type UsbDeviceSnapshot = {
  path: string;
  manufacturer: string | null;
  product: string | null;
  vendorId: string;
  productId: string;
  busNumber: string | null;
  deviceNumber: string | null;
  speed: string | null;
};
type SystemInfoSnapshot = {
  operatingSystem: string;
  kernelVersion: string | null;
  hostName: string | null;
  architecture: string;
  processor: string | null;
  logicalProcessors: number;
  physicalCores: number | null;
  memoryTotalBytes: number;
  uptimeSeconds: number;
  desktopEnvironment: string | null;
  sessionType: string | null;
  batteries: BatterySnapshot[];
  usbDevices: UsbDeviceSnapshot[];
};
type DiagnosticsSnapshot = Omit<
  SystemInfoSnapshot,
  "hostName" | "batteries"
> & { cpuUsagePercent: number; memoryUsedBytes: number };
type DiagnosticsStatus = { kind: "success" | "error"; message: string };
type LargeFileSnapshot = { path: string; sizeBytes: number };
type LargeFileScanResult = {
  root: string;
  files: LargeFileSnapshot[];
  scannedEntries: number;
  skippedEntries: number;
  scanLimited: boolean;
  resultsLimited: boolean;
};
type CacheEntrySnapshot = {
  name: string;
  sizeBytes: number;
  fileCount: number;
  clearable: boolean;
};
type CacheInventorySnapshot = {
  entries: CacheEntrySnapshot[];
  totalBytes: number;
  filesScanned: number;
  skippedEntries: number;
  scanLimited: boolean;
  available: boolean;
};
type LogFileSnapshot = { path: string; sizeBytes: number };
type LogInventorySnapshot = {
  files: LogFileSnapshot[];
  logBytes: number;
  scannedEntries: number;
  skippedEntries: number;
  scanLimited: boolean;
  logDirectoryAvailable: boolean;
  logError: string | null;
  journalUsage: string | null;
  journalError: string | null;
};
type DriveSnapshot = {
  name: string;
  mountPoint: string;
  fileSystem: string;
  totalBytes: number;
  availableBytes: number;
  isRemovable: boolean;
};
type DriveHealthSnapshot = {
  path: string;
  model: string;
  smartSupported: boolean | null;
  healthState: "healthy" | "warning" | "unsupported" | "unknown";
  temperatureCelsius: number | null;
  powerOnHours: number | null;
  badSectors: number | null;
  attributesFailing: number | null;
  smartUpdatedUnixSeconds: number | null;
};
type PartitionSnapshot = {
  name: string;
  path: string;
  deviceType: string;
  fileSystem: string | null;
  label: string | null;
  sizeBytes: number;
  mountPoints: string[];
  isRemovable: boolean;
};
type SystemLogEntry = {
  timestampMicros: number;
  source: string;
  severity:
    | "Emergency"
    | "Alert"
    | "Critical"
    | "Error"
    | "Warning"
    | "Notice"
    | "Info"
    | "Debug";
  message: string;
};
type LogSeverityFilter = "all" | "errors" | "warnings" | "info" | "debug";
type LogTimeRange = "all" | "1h" | "6h" | "24h";
type ProcessSnapshot = {
  pid: number;
  name: string;
  startTime: number;
  parentPid: number | null;
  status: string;
  runTimeSeconds: number;
  cpuUsagePercent: number;
  memoryBytes: number;
  diskReadTotalBytes: number;
  diskWriteTotalBytes: number;
  diskReadBytesPerSecond: number | null;
  diskWriteBytesPerSecond: number | null;
};
type RawProcessSnapshot = Omit<
  ProcessSnapshot,
  "diskReadBytesPerSecond" | "diskWriteBytesPerSecond"
>;
type PackageSnapshot = {
  name: string;
  version: string;
  architecture: string;
  status: string;
  section: string;
  installedSizeBytes: number | null;
  summary: string;
  automatic: boolean;
  upgradeVersion: string | null;
  source: string;
};
type PackageInventory = {
  backend: string;
  backendDetail: string;
  packages: PackageSnapshot[];
  warnings: string[];
  lastIndexUnixSeconds: number | null;
};
type PackageFilter = "all" | "upgradable" | "automatic";
type PackageSourceFilter = "all" | "APT" | "Flatpak" | "Snap";
type SystemHealthAlert = {
  severity: "critical" | "warning" | "info";
  title: string;
  message: string;
  actionPage: string | null;
  actionLabel: string | null;
};
type SystemHealthSnapshot = { alerts: SystemHealthAlert[]; healthy: boolean };
type ProcessActionStatus = { kind: "success" | "error"; message: string };
type TemperatureUnit = "celsius" | "fahrenheit";
type AppPage =
  | "overview"
  | "processes"
  | "storage"
  | "network"
  | "connections"
  | "startup"
  | "services"
  | "software"
  | "system"
  | "diagnostics"
  | "logs"
  | "activity"
  | "maintenance"
  | "settings"
  | "performance"
  | "sensors";
type ProcessSortKey = "name" | "pid" | "cpu" | "memory" | "read" | "write";
type ProcessSort = { key: ProcessSortKey; direction: "asc" | "desc" };
type ProcessStateFilter = "all" | "running" | "sleeping" | "stopped" | "zombie";
type ProcessViewMode = "list" | "tree";
type ProcessTreeRow = {
  process: ProcessSnapshot;
  depth: number;
  childCount: number;
};
type HistorySample = {
  timestamp: number;
  cpuPercent: number;
  memoryPercent: number;
};
type CommandItem = {
  id: string;
  label: string;
  category: string;
  action: () => void;
  icon: string;
};

// --- Helpers ---
function formatGiB(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(1);
}
function formatSystemLogTimestamp(timestampMicros: number) {
  if (!timestampMicros) return "Time unavailable";
  const date = new Date(timestampMicros / 1000);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : date.toLocaleString();
}
function formatProcessMemory(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}
function formatNetworkRate(bytesPerSecond: number) {
  if (bytesPerSecond >= 1024 ** 2)
    return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MiB/s`;
  if (bytesPerSecond >= 1024)
    return `${(bytesPerSecond / 1024).toFixed(1)} KiB/s`;
  return `${Math.round(bytesPerSecond)} B/s`;
}
function formatProcessRuntime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${remainingSeconds}s`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "Unavailable";
  const gib = bytes / 1024 ** 3;
  return `${gib.toFixed(1)} GiB`;
}
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2];
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
  }
  return d;
}

const OPERATION_HISTORY_KEY = "argus.operation-history";
const MAX_OPERATION_HISTORY = 250;
function readOperationHistory(): OperationRecord[] {
  try {
    const raw = localStorage.getItem(OPERATION_HISTORY_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (entry): entry is OperationRecord =>
          typeof entry === "object" &&
          entry !== null &&
          typeof entry.id === "string" &&
          typeof entry.timestamp === "number" &&
          ["Process", "Service", "Startup", "Storage", "Maintenance"].includes(
            entry.category,
          ) &&
          typeof entry.action === "string" &&
          typeof entry.target === "string" &&
          (entry.outcome === "success" || entry.outcome === "failed") &&
          typeof entry.note === "string",
      )
      .slice(0, MAX_OPERATION_HISTORY);
  } catch {
    return [];
  }
}
function appendOperationHistory(details: OperationDetails): OperationRecord[] {
  const entry: OperationRecord = {
    ...details,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: Date.now(),
  };
  const next = [entry, ...readOperationHistory()].slice(
    0,
    MAX_OPERATION_HISTORY,
  );
  try {
    localStorage.setItem(OPERATION_HISTORY_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private-mode errors
  }
  return next;
}
function readTemperatureUnit(): TemperatureUnit {
  try {
    return localStorage.getItem("argus.temperature-unit") === "fahrenheit"
      ? "fahrenheit"
      : "celsius";
  } catch {
    return "celsius";
  }
}
function readHistoryWindow(): number {
  try {
    const saved = Number(localStorage.getItem("argus.history-window"));
    return [300, 900, 1800].includes(saved) ? saved : 300;
  } catch {
    return 300;
  }
}

// --- Icons ---
const Icon = ({
  path,
  size = 18,
  className = "",
}: {
  path: string;
  size?: number;
  className?: string;
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d={path} />
  </svg>
);
const icons = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
  performance: "M12 20V10M18 20V4M6 20v-4",
  processes: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  storage:
    "M4 6c0 1.1 3.6 2 8 2s8-.9 8-2-3.6-2-8-2-8 .9-8 2zM4 6v12c0 1.1 3.6 2 8 2s8-.9 8-2V6M4 12c0 1.1 3.6 2 8 2s8-.9 8-2",
  sensors: "M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z",
  system: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01",
  network:
    "M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01",
  connections: "M8 12h8M12 8v8",
  startup: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  services:
    "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83",
  software:
    "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
  maintenance:
    "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
  diagnostics: "M22 12h-4l-3 9L9 3l-3 9H2",
  logs: "M4 6h16M4 12h16M4 18h16",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  search: "M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z",
  calendar:
    "M8 2v4M16 2v4M3 10h18M21 6v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",
  arrowUpRight: "M7 17L17 7M7 7h10v10",
  chevronRight: "M9 18l6-6-6-6",
  chevronDown: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
};

function App() {
  const { mode, setMode } = useTheme();

  // --- State ---
  const [page, setPage] = useState<AppPage>("overview");
  const [username, setUsername] = useState("User");
  const [operationHistory, setOperationHistory] =
    useState<OperationRecord[]>(readOperationHistory);
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [temperatures, setTemperatures] = useState<TemperatureSnapshot[]>([]);
  const [temperatureError, setTemperatureError] = useState<string | null>(null);
  const [temperatureLoading, setTemperatureLoading] = useState(false);
  const [hardwareExtra, setHardwareExtra] =
    useState<HardwareExtraSnapshot | null>(null);
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [historyWindow, setHistoryWindow] = useState(readHistoryWindow);
  const [temperatureUnit, setTemperatureUnit] =
    useState<TemperatureUnit>(readTemperatureUnit);
  const [performanceSnapshot, setPerformanceSnapshot] =
    useState<PerformanceSnapshot | null>(null);
  const [performanceError, setPerformanceError] = useState<string | null>(null);
  const [performanceLoading, setPerformanceLoading] = useState(false);
  const [drives, setDrives] = useState<DriveSnapshot[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [driveHealth, setDriveHealth] = useState<DriveHealthSnapshot[]>([]);
  const [driveHealthError, setDriveHealthError] = useState<string | null>(null);
  const [driveHealthLoading, setDriveHealthLoading] = useState(false);
  const [driveHealthRefreshKey, setDriveHealthRefreshKey] = useState(0);
  const [partitions, setPartitions] = useState<PartitionSnapshot[]>([]);
  const [partitionError, setPartitionError] = useState<string | null>(null);
  const [partitionLoading, setPartitionLoading] = useState(false);
  const [partitionRefreshKey, setPartitionRefreshKey] = useState(0);
  const [partitionActionPath, setPartitionActionPath] = useState<string | null>(
    null,
  );
  const [partitionActionStatus, setPartitionActionStatus] =
    useState<StartupActionStatus | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<
    NetworkInterfaceSnapshot[]
  >([]);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkRouteInfo, setNetworkRouteInfo] =
    useState<NetworkRouteSnapshot | null>(null);
  const [networkRouteLoading, setNetworkRouteLoading] = useState(false);
  const [networkRouteError, setNetworkRouteError] = useState<string | null>(
    null,
  );
  const [networkRouteRefreshKey, setNetworkRouteRefreshKey] = useState(0);
  const [connections, setConnections] = useState<NetworkConnectionSnapshot[]>(
    [],
  );
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connectionsError, setConnectionsError] = useState<string | null>(null);
  const [connectionsQuery, setConnectionsQuery] = useState("");
  const [startupApps, setStartupApps] = useState<StartupAppSnapshot[]>([]);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupLoading, setStartupLoading] = useState(false);
  const [startupQuery, setStartupQuery] = useState("");
  const [startupRefreshKey, setStartupRefreshKey] = useState(0);
  const [startupActionId, setStartupActionId] = useState<string | null>(null);
  const [startupActionStatus, setStartupActionStatus] =
    useState<StartupActionStatus | null>(null);
  const [services, setServices] = useState<ServiceSnapshot[]>([]);
  const [serviceWarnings, setServiceWarnings] = useState<string[]>([]);
  const [serviceError, setServiceError] = useState<string | null>(null);
  const [serviceLoading, setServiceLoading] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>("all");
  const [serviceVisibleCount, setServiceVisibleCount] = useState(60);
  const [serviceRefreshKey, setServiceRefreshKey] = useState(0);
  const [serviceActionUnit, setServiceActionUnit] = useState<string | null>(
    null,
  );
  const [serviceActionPhase, setServiceActionPhase] = useState<
    "preview" | "action"
  >("preview");
  const [serviceActionStatus, setServiceActionStatus] =
    useState<StartupActionStatus | null>(null);
  const [serviceLogTarget, setServiceLogTarget] =
    useState<ServiceSnapshot | null>(null);
  const [serviceLogs, setServiceLogs] = useState<SystemLogEntry[]>([]);
  const [serviceLogsLoading, setServiceLogsLoading] = useState(false);
  const [serviceLogsError, setServiceLogsError] = useState<string | null>(null);
  const [packageInventory, setPackageInventory] =
    useState<PackageInventory | null>(null);
  const [packageLoading, setPackageLoading] = useState(false);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [packageQuery, setPackageQuery] = useState("");
  const [packageFilter, setPackageFilter] =
    useState<PackageFilter>("upgradable");
  const [packageSourceFilter, setPackageSourceFilter] =
    useState<PackageSourceFilter>("all");
  const [packageVisibleCount, setPackageVisibleCount] = useState(100);
  const [cleanLoading, setCleanLoading] = useState(false);
  const [cleanStatus, setCleanStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [healthSnapshot, setHealthSnapshot] =
    useState<SystemHealthSnapshot | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfoSnapshot | null>(null);
  const [systemInfoError, setSystemInfoError] = useState<string | null>(null);
  const [systemInfoLoading, setSystemInfoLoading] = useState(false);
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] =
    useState<DiagnosticsSnapshot | null>(null);
  const [diagnosticsReport, setDiagnosticsReport] = useState("");
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsSaving, setDiagnosticsSaving] = useState(false);
  const [diagnosticsStatus, setDiagnosticsStatus] =
    useState<DiagnosticsStatus | null>(null);
  const [largeFileScan, setLargeFileScan] =
    useState<LargeFileScanResult | null>(null);
  const [largeFileMinimum, setLargeFileMinimum] = useState(100 * 1024 * 1024);
  const [largeFileLoading, setLargeFileLoading] = useState(false);
  const [largeFileError, setLargeFileError] = useState<string | null>(null);
  const [cacheInventory, setCacheInventory] =
    useState<CacheInventorySnapshot | null>(null);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [cacheActionName, setCacheActionName] = useState<string | null>(null);
  const [cacheActionStatus, setCacheActionStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [logInventory, setLogInventory] = useState<LogInventorySnapshot | null>(
    null,
  );
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [systemLogsLoading, setSystemLogsLoading] = useState(false);
  const [systemLogsError, setSystemLogsError] = useState<string | null>(null);
  const [systemLogsQuery, setSystemLogsQuery] = useState("");
  const [systemLogsSeverity, setSystemLogsSeverity] =
    useState<LogSeverityFilter>("all");
  const [systemLogsTimeRange, setSystemLogsTimeRange] =
    useState<LogTimeRange>("all");
  const [systemLogsRefreshKey, setSystemLogsRefreshKey] = useState(0);
  const [systemLogsExporting, setSystemLogsExporting] = useState(false);
  const [systemLogsStatus, setSystemLogsStatus] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [driveQuery, setDriveQuery] = useState("");
  const [processes, setProcesses] = useState<ProcessSnapshot[]>([]);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processQuery, setProcessQuery] = useState("");
  const [processStateFilter, setProcessStateFilter] =
    useState<ProcessStateFilter>("all");
  const [processViewMode, setProcessViewMode] =
    useState<ProcessViewMode>("list");
  const [collapsedProcessPids, setCollapsedProcessPids] = useState<number[]>(
    [],
  );
  const [processSort, setProcessSort] = useState<ProcessSort>({
    key: "cpu",
    direction: "desc",
  });
  const [terminatingPid, setTerminatingPid] = useState<number | null>(null);
  const [selectedProcessPid, setSelectedProcessPid] = useState<number | null>(
    null,
  );
  const [processActionStatus, setProcessActionStatus] =
    useState<ProcessActionStatus | null>(null);

  // --- Sidebar State ---
  const [openGroup, setOpenGroup] = useState<string | null>("Dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // --- Command Palette State ---
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const paletteInputRef = useRef<HTMLInputElement>(null);

  // --- Refs ---
  const previousNetworkCounters = useRef<
    Record<
      string,
      { receivedBytes: number; transmittedBytes: number; sampleTime: number }
    >
  >({});
  const previousProcessIoCounters = useRef<
    Record<string, { read: number; write: number; time: number }>
  >({});

  // --- Effects ---
  useEffect(() => {
    invoke<string>("get_username")
      .then(setUsername)
      .catch(() => {});
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("argus.temperature-unit", temperatureUnit);
      localStorage.setItem("argus.history-window", String(historyWindow));
    } catch {}
  }, [temperatureUnit, historyWindow]);

  // Global Keyboard Listener for Command Palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setIsPaletteOpen((prev) => !prev);
        setPaletteQuery("");
        setSelectedCommandIndex(0);
      }
      if (e.key === "Escape" && isPaletteOpen) {
        setIsPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isPaletteOpen]);

  useEffect(() => {
    if (isPaletteOpen && paletteInputRef.current) {
      paletteInputRef.current.focus();
    }
  }, [isPaletteOpen]);

  useEffect(() => {
    let active = true;
    async function refreshTelemetry() {
      try {
        const snapshot = await invoke<TelemetrySnapshot>("get_telemetry");
        if (active) {
          setTelemetry(snapshot);
          setTelemetryError(null);
          setHistory((previous) => {
            const sample: HistorySample = {
              timestamp: Date.now(),
              cpuPercent: Math.max(0, Math.min(100, snapshot.cpuUsagePercent)),
              memoryPercent:
                snapshot.memoryTotalBytes > 0
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        (snapshot.memoryUsedBytes / snapshot.memoryTotalBytes) *
                          100,
                      ),
                    )
                  : 0,
            };
            return [...previous, sample].slice(-1800);
          });
        }
      } catch (error) {
        if (active) setTelemetryError(String(error));
      }
    }
    void refreshTelemetry();
    const intervalId = window.setInterval(() => void refreshTelemetry(), 1000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (page !== "overview" && page !== "sensors" && page !== "performance")
      return;
    let active = true;
    let timeoutId = 0;
    async function refreshHardware() {
      try {
        const extra = await invoke<HardwareExtraSnapshot>("get_hardware_extra");
        if (active) setHardwareExtra(extra);
      } catch {
      } finally {
        if (active)
          timeoutId = window.setTimeout(() => void refreshHardware(), 2000);
      }
    }
    void refreshHardware();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [page]);

  useEffect(() => {
    if (page !== "overview" && page !== "sensors") return;
    let active = true;
    let timeoutId = 0;
    setTemperatureLoading(true);
    async function refreshTemperatures() {
      try {
        const snapshot =
          await invoke<TemperatureSnapshot[]>("get_temperatures");
        if (active) {
          setTemperatures(snapshot);
          setTemperatureError(null);
        }
      } catch (error) {
        if (active) {
          setTemperatures([]);
          setTemperatureError(String(error));
        }
      } finally {
        if (active) {
          setTemperatureLoading(false);
          timeoutId = window.setTimeout(() => void refreshTemperatures(), 5000);
        }
      }
    }
    void refreshTemperatures();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [page]);

  useEffect(() => {
    let active = true;
    async function refreshStorage() {
      try {
        const snapshot = await invoke<DriveSnapshot[]>("get_storage");
        if (active) {
          setDrives(snapshot);
          setStorageError(null);
        }
      } catch (error) {
        if (active) setStorageError(String(error));
      }
    }
    void refreshStorage();
    const intervalId = window.setInterval(() => void refreshStorage(), 5000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (page !== "storage") return;
    let active = true;
    let timeoutId = 0;
    setPartitionLoading(true);
    async function refreshPartitions() {
      try {
        const snapshot = await invoke<PartitionSnapshot[]>("get_partitions");
        if (active) {
          setPartitions(snapshot);
          setPartitionError(null);
        }
      } catch (error) {
        if (active) setPartitionError(String(error));
      } finally {
        if (active) {
          setPartitionLoading(false);
          timeoutId = window.setTimeout(() => void refreshPartitions(), 15000);
        }
      }
    }
    void refreshPartitions();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [page, partitionRefreshKey]);

  useEffect(() => {
    if (page !== "storage") return;
    let active = true;
    let timeoutId = 0;
    setDriveHealthLoading(true);
    async function refreshDriveHealth() {
      try {
        const snapshot =
          await invoke<DriveHealthSnapshot[]>("get_drive_health");
        if (active) {
          setDriveHealth(snapshot);
          setDriveHealthError(null);
        }
      } catch (error) {
        if (active) setDriveHealthError(String(error));
      } finally {
        if (active) {
          setDriveHealthLoading(false);
          timeoutId = window.setTimeout(() => void refreshDriveHealth(), 60000);
        }
      }
    }
    void refreshDriveHealth();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [page, driveHealthRefreshKey]);

  useEffect(() => {
    if (page !== "performance") return;
    let active = true;
    let timeoutId = 0;
    async function refreshPerformance() {
      setPerformanceLoading(true);
      try {
        const snapshot = await invoke<PerformanceSnapshot>(
          "get_performance_snapshot",
        );
        if (active) {
          setPerformanceSnapshot(snapshot);
          setPerformanceError(null);
        }
      } catch (error) {
        if (active) setPerformanceError(String(error));
      } finally {
        if (active) {
          setPerformanceLoading(false);
          timeoutId = window.setTimeout(() => void refreshPerformance(), 1000);
        }
      }
    }
    void refreshPerformance();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [page]);

  useEffect(() => {
    if (page !== "services") return;
    let active = true;
    setServiceLoading(true);
    invoke<ServiceInventory>("get_services")
      .then((inventory) => {
        if (active) {
          setServices(inventory.services);
          setServiceWarnings(inventory.warnings);
          setServiceError(null);
        }
      })
      .catch((error) => {
        if (active) {
          setServices([]);
          setServiceWarnings([]);
          setServiceError(String(error));
        }
      })
      .finally(() => {
        if (active) setServiceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, serviceRefreshKey]);

  useEffect(() => {
    if (page !== "software") return;
    let active = true;
    setPackageLoading(true);
    invoke<PackageInventory>("get_package_inventory")
      .then((inventory) => {
        if (active) {
          setPackageInventory(inventory);
          setPackageError(null);
        }
      })
      .catch((error) => {
        if (active) {
          setPackageInventory(null);
          setPackageError(String(error));
        }
      })
      .finally(() => {
        if (active) setPackageLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page]);

  useEffect(() => {
    if (page !== "diagnostics") return;
    let active = true;
    setHealthLoading(true);
    invoke<SystemHealthSnapshot>("get_system_health")
      .then((snapshot) => {
        if (active) {
          setHealthSnapshot(snapshot);
          setHealthError(null);
        }
      })
      .catch((error) => {
        if (active) {
          setHealthSnapshot(null);
          setHealthError(String(error));
        }
      })
      .finally(() => {
        if (active) setHealthLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page]);

  useEffect(() => {
    if (page !== "system") return;
    let active = true;
    setSystemInfoLoading(true);
    invoke<SystemInfoSnapshot>("get_system_info")
      .then((snapshot) => {
        if (active) {
          setSystemInfo(snapshot);
          setSystemInfoError(null);
        }
      })
      .catch((error) => {
        if (active) setSystemInfoError(String(error));
      })
      .finally(() => {
        if (active) setSystemInfoLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page]);

  useEffect(() => {
    if (page !== "startup") return;
    let active = true;
    setStartupLoading(true);
    invoke<StartupAppSnapshot[]>("get_startup_apps")
      .then((snapshot) => {
        if (active) {
          setStartupApps(snapshot);
          setStartupError(null);
        }
      })
      .catch((error) => {
        if (active) {
          setStartupApps([]);
          setStartupError(String(error));
        }
      })
      .finally(() => {
        if (active) setStartupLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, startupRefreshKey]);

  useEffect(() => {
    if (page !== "network" && page !== "overview") return;
    let active = true;
    let timeoutId = 0;
    previousNetworkCounters.current = {};
    setNetworkLoading(true);
    async function refreshNetworkInterfaces() {
      try {
        const snapshot = await invoke<NetworkCountersSnapshot[]>(
          "get_network_interfaces",
        );
        if (active) {
          const sampleTime = performance.now();
          const nextCounters: typeof previousNetworkCounters.current = {};
          const interfaces = snapshot.map((network) => {
            const previous = previousNetworkCounters.current[network.name];
            const elapsedSeconds = previous
              ? Math.max((sampleTime - previous.sampleTime) / 1000, 0.001)
              : 0;
            const measured: NetworkInterfaceSnapshot = {
              ...network,
              downloadBytesPerSecond:
                previous && network.receivedBytes >= previous.receivedBytes
                  ? (network.receivedBytes - previous.receivedBytes) /
                    elapsedSeconds
                  : 0,
              uploadBytesPerSecond:
                previous &&
                network.transmittedBytes >= previous.transmittedBytes
                  ? (network.transmittedBytes - previous.transmittedBytes) /
                    elapsedSeconds
                  : 0,
            };
            nextCounters[network.name] = {
              receivedBytes: network.receivedBytes,
              transmittedBytes: network.transmittedBytes,
              sampleTime,
            };
            return measured;
          });
          previousNetworkCounters.current = nextCounters;
          setNetworkInterfaces(interfaces);
          setNetworkError(null);
        }
      } catch (error) {
        if (active) {
          setNetworkInterfaces([]);
          setNetworkError(String(error));
        }
      } finally {
        if (active) {
          setNetworkLoading(false);
          timeoutId = window.setTimeout(
            () => void refreshNetworkInterfaces(),
            1000,
          );
        }
      }
    }
    void refreshNetworkInterfaces();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [page]);

  useEffect(() => {
    if (page !== "network") return;
    let active = true;
    setNetworkRouteLoading(true);
    invoke<NetworkRouteSnapshot>("get_network_route_info")
      .then((snapshot) => {
        if (active) {
          setNetworkRouteInfo(snapshot);
          setNetworkRouteError(null);
        }
      })
      .catch((error) => {
        if (active) setNetworkRouteError(String(error));
      })
      .finally(() => {
        if (active) setNetworkRouteLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, networkRouteRefreshKey]);

  useEffect(() => {
    if (page !== "connections") return;
    let active = true;
    setConnectionsLoading(true);
    invoke<NetworkConnectionSnapshot[]>("get_network_connections")
      .then((snapshot) => {
        if (active) {
          setConnections(snapshot);
          setConnectionsError(null);
        }
      })
      .catch((error) => {
        if (active) setConnectionsError(String(error));
      })
      .finally(() => {
        if (active) setConnectionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page]);

  useEffect(() => {
    if (page !== "logs") return;
    let active = true;
    setSystemLogsLoading(true);
    invoke<SystemLogEntry[]>("get_recent_logs")
      .then((entries) => {
        if (active) {
          setSystemLogs(entries);
          setSystemLogsError(null);
        }
      })
      .catch((error) => {
        if (active) setSystemLogsError(String(error));
      })
      .finally(() => {
        if (active) setSystemLogsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, systemLogsRefreshKey]);

  useEffect(() => {
    if (page !== "processes" && page !== "overview") return;
    let active = true;
    let timeoutId = 0;
    previousProcessIoCounters.current = {};
    setProcessLoading(true);
    async function refreshProcesses() {
      try {
        const rawSnapshot = await invoke<RawProcessSnapshot[]>("get_processes");
        if (active) {
          const sampleTime = performance.now();
          const nextCounters: Record<
            string,
            { read: number; write: number; time: number }
          > = {};
          const snapshot: ProcessSnapshot[] = rawSnapshot.map((process) => {
            const key = `${process.pid}:${process.startTime}`;
            const previous = previousProcessIoCounters.current[key];
            const elapsedSeconds = previous
              ? Math.max((sampleTime - previous.time) / 1000, 0.001)
              : 0;
            const diskReadBytesPerSecond =
              previous && process.diskReadTotalBytes >= previous.read
                ? Math.round(
                    (process.diskReadTotalBytes - previous.read) /
                      elapsedSeconds,
                  )
                : null;
            const diskWriteBytesPerSecond =
              previous && process.diskWriteTotalBytes >= previous.write
                ? Math.round(
                    (process.diskWriteTotalBytes - previous.write) /
                      elapsedSeconds,
                  )
                : null;
            nextCounters[key] = {
              read: process.diskReadTotalBytes,
              write: process.diskWriteTotalBytes,
              time: sampleTime,
            };
            return {
              ...process,
              diskReadBytesPerSecond,
              diskWriteBytesPerSecond,
            };
          });
          previousProcessIoCounters.current = nextCounters;
          setProcesses(snapshot);
          setProcessError(null);
        }
      } catch (error) {
        if (active) setProcessError(String(error));
      } finally {
        if (active) {
          setProcessLoading(false);
          timeoutId = window.setTimeout(() => void refreshProcesses(), 2500);
        }
      }
    }
    void refreshProcesses();
    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [page]);

  // --- Derived State ---
  const memoryPercent =
    telemetry && telemetry.memoryTotalBytes > 0
      ? Math.round(
          (telemetry.memoryUsedBytes / telemetry.memoryTotalBytes) * 100,
        )
      : 0;
  const nonLoopbackInterfaces = networkInterfaces.filter(
    (network) => !network.isLoopback,
  );
  const totalDownloadRate = nonLoopbackInterfaces.reduce(
    (total, network) => total + network.downloadBytesPerSecond,
    0,
  );
  const totalUploadRate = nonLoopbackInterfaces.reduce(
    (total, network) => total + network.uploadBytesPerSecond,
    0,
  );
  const hottestTemperature = temperatures.reduce<TemperatureSnapshot | null>(
    (hottest, sensor) =>
      !hottest || sensor.temperatureCelsius > hottest.temperatureCelsius
        ? sensor
        : hottest,
    null,
  );

  const metrics = [
    {
      label: "Processor",
      value: telemetry
        ? `${Math.round(telemetry.cpuUsagePercent)}%`
        : "Unavailable",
      detail: "Current total CPU usage",
      page: "performance" as AppPage,
    },
    {
      label: "Memory",
      value: telemetry
        ? `${formatGiB(telemetry.memoryUsedBytes)} GiB`
        : "Unavailable",
      detail: telemetry
        ? `of ${formatGiB(telemetry.memoryTotalBytes)} GiB · ${memoryPercent}% used`
        : "Waiting for telemetry",
      page: "performance" as AppPage,
    },
    {
      label: "Temperature",
      value: hottestTemperature
        ? temperatureUnit === "celsius"
          ? `${Math.round(hottestTemperature.temperatureCelsius)}°C`
          : `${Math.round((hottestTemperature.temperatureCelsius * 9) / 5 + 32)}°F`
        : "Unavailable",
      detail: hottestTemperature
        ? hottestTemperature.label
        : "No readable sensors",
      page: "sensors" as AppPage,
    },
  ];
  if (hardwareExtra && hardwareExtra.gpus.length > 0) {
    const gpu = hardwareExtra.gpus[0];
    metrics.push({
      label: gpu.name,
      value: `${Math.round(gpu.utilizationPercent)}%`,
      detail: `${formatProcessMemory(gpu.vramUsedBytes)} / ${formatProcessMemory(gpu.vramTotalBytes)} VRAM`,
      page: "performance" as AppPage,
    });
  }

  const visibleHistory = history.slice(-historyWindow);
  const chartWidth = 800;
  const chartHeight = 200;
  const cpuData = visibleHistory.map((sample, index) => ({
    x: (index / (visibleHistory.length - 1 || 1)) * chartWidth,
    y: chartHeight - (sample.cpuPercent / 100) * chartHeight,
  }));
  const memData = visibleHistory.map((sample, index) => ({
    x: (index / (visibleHistory.length - 1 || 1)) * chartWidth,
    y: chartHeight - (sample.memoryPercent / 100) * chartHeight,
  }));
  const cpuPath = buildSmoothPath(cpuData);
  const memPath = buildSmoothPath(memData);
  const cpuAreaPath =
    cpuData.length > 0
      ? `${cpuPath} L ${chartWidth},${chartHeight} L 0,${chartHeight} Z`
      : "";
  const memAreaPath =
    memData.length > 0
      ? `${memPath} L ${chartWidth},${chartHeight} L 0,${chartHeight} Z`
      : "";

  // --- Sorting / Filtering ---
  const filteredDrives = drives
    .filter((d) =>
      d.mountPoint.toLowerCase().includes(driveQuery.toLowerCase()),
    )
    .sort((a, b) => a.mountPoint.localeCompare(b.mountPoint));
  const filteredServices = services.filter((s) => {
    const matchesQuery =
      s.unit.toLowerCase().includes(serviceQuery.toLowerCase()) ||
      s.description.toLowerCase().includes(serviceQuery.toLowerCase());
    const matchesFilter =
      serviceFilter === "all" ||
      (serviceFilter === "active" && s.activeState === "active") ||
      (serviceFilter === "failed" && s.activeState === "failed") ||
      (serviceFilter === "enabled" && s.startupState.startsWith("enabled"));
    return matchesQuery && matchesFilter;
  });
  const visibleServices = filteredServices.slice(0, serviceVisibleCount);
  const filteredPackages = (packageInventory?.packages || []).filter((p) => {
    const matchesQuery =
      p.name.toLowerCase().includes(packageQuery.toLowerCase()) ||
      p.summary.toLowerCase().includes(packageQuery.toLowerCase());
    const matchesFilter =
      packageFilter === "all" ||
      (packageFilter === "upgradable" && p.upgradeVersion !== null) ||
      (packageFilter === "automatic" && p.automatic);
    const matchesSource =
      packageSourceFilter === "all" || p.source === packageSourceFilter;
    return matchesQuery && matchesFilter && matchesSource;
  });
  const visiblePackages = filteredPackages.slice(0, packageVisibleCount);
  const filteredStartupApps = startupApps.filter(
    (s) =>
      s.name.toLowerCase().includes(startupQuery.toLowerCase()) ||
      s.command.toLowerCase().includes(startupQuery.toLowerCase()),
  );
  const filteredConnections = connections.filter(
    (c) =>
      c.localAddress.toLowerCase().includes(connectionsQuery.toLowerCase()) ||
      c.process.toLowerCase().includes(connectionsQuery.toLowerCase()),
  );
  const filteredPartitions = partitions.filter(
    (p) =>
      p.name.toLowerCase().includes(driveQuery.toLowerCase()) ||
      p.path.toLowerCase().includes(driveQuery.toLowerCase()),
  );
  const filteredSystemLogs = systemLogs.filter((e) => {
    const rangeHours =
      systemLogsTimeRange === "1h"
        ? 1
        : systemLogsTimeRange === "6h"
          ? 6
          : systemLogsTimeRange === "24h"
            ? 24
            : null;
    const inTimeRange =
      rangeHours === null ||
      (e.timestampMicros > 0 &&
        e.timestampMicros >=
          Date.now() * 1000 - rangeHours * 60 * 60 * 1_000_000);
    const matchesQuery =
      e.message.toLowerCase().includes(systemLogsQuery.toLowerCase()) ||
      e.source.toLowerCase().includes(systemLogsQuery.toLowerCase());
    const priority = ["Emergency", "Alert", "Critical", "Error"].includes(
      e.severity,
    )
      ? "errors"
      : e.severity === "Warning"
        ? "warnings"
        : e.severity === "Debug"
          ? "debug"
          : "info";
    return (
      inTimeRange &&
      matchesQuery &&
      (systemLogsSeverity === "all" || priority === systemLogsSeverity)
    );
  });
  const filteredProcesses = processes
    .filter((p) => {
      const matchesSearch =
        p.name.toLowerCase().includes(processQuery.toLowerCase()) ||
        String(p.pid).includes(processQuery);
      const status = p.status.toLowerCase();
      const matchesState =
        processStateFilter === "all" ||
        (processStateFilter === "running" && status === "run") ||
        (processStateFilter === "sleeping" &&
          (status === "sleep" || status === "idle")) ||
        (processStateFilter === "stopped" && status === "stop") ||
        (processStateFilter === "zombie" && status === "zombie");
      return matchesSearch && matchesState;
    })
    .sort((a, b) => {
      let cmp = 0;
      if (processSort.key === "name") cmp = a.name.localeCompare(b.name);
      else if (processSort.key === "pid") cmp = a.pid - b.pid;
      else if (processSort.key === "cpu")
        cmp = a.cpuUsagePercent - b.cpuUsagePercent;
      else if (processSort.key === "memory")
        cmp = a.memoryBytes - b.memoryBytes;
      else if (processSort.key === "read")
        cmp =
          (a.diskReadBytesPerSecond ?? -1) - (b.diskReadBytesPerSecond ?? -1);
      else if (processSort.key === "write")
        cmp =
          (a.diskWriteBytesPerSecond ?? -1) - (b.diskWriteBytesPerSecond ?? -1);
      return processSort.direction === "asc" ? cmp : -cmp;
    });

  const processTreeRows: ProcessTreeRow[] = [];
  if (processViewMode === "list") {
    filteredProcesses.forEach((p) =>
      processTreeRows.push({ process: p, depth: 0, childCount: 0 }),
    );
  } else {
    const processByPid = new Map(filteredProcesses.map((p) => [p.pid, p]));
    const childrenByParent = new Map<number, ProcessSnapshot[]>();
    const roots: ProcessSnapshot[] = [];
    for (const p of filteredProcesses) {
      const parent =
        p.parentPid === null ? undefined : processByPid.get(p.parentPid);
      if (parent && parent.pid !== p.pid) {
        const children = childrenByParent.get(parent.pid) ?? [];
        children.push(p);
        childrenByParent.set(parent.pid, children);
      } else roots.push(p);
    }
    const visited = new Set<number>();
    const hiddenByCollapse = new Set<number>();
    const markDescendantsHidden = (p: ProcessSnapshot) => {
      for (const child of childrenByParent.get(p.pid) ?? []) {
        if (hiddenByCollapse.has(child.pid)) continue;
        hiddenByCollapse.add(child.pid);
        markDescendantsHidden(child);
      }
    };
    const appendProcess = (p: ProcessSnapshot, depth: number) => {
      if (visited.has(p.pid)) return;
      visited.add(p.pid);
      const children = childrenByParent.get(p.pid) ?? [];
      processTreeRows.push({ process: p, depth, childCount: children.length });
      if (collapsedProcessPids.includes(p.pid)) markDescendantsHidden(p);
      else children.forEach((c) => appendProcess(c, depth + 1));
    };
    roots.forEach((p) => appendProcess(p, 0));
    filteredProcesses.forEach((p) => {
      if (!visited.has(p.pid) && !hiddenByCollapse.has(p.pid))
        appendProcess(p, 0);
    });
  }

  // --- Actions ---
  function recordOperation(details: OperationDetails) {
    setOperationHistory(appendOperationHistory(details));
  }
  function clearOperationHistory() {
    if (window.confirm("Clear Argus’s local operation history?")) {
      try {
        localStorage.removeItem(OPERATION_HISTORY_KEY);
      } catch {}
      setOperationHistory([]);
    }
  }

  async function requestPartitionMount(
    partition: PartitionSnapshot,
    mount: boolean,
  ) {
    if (partition.deviceType !== "part" || partitionActionPath) return;
    if (
      !mount &&
      !window.confirm(
        `Unmount ${partition.path}? Files and apps using it may become unavailable.`,
      )
    )
      return;
    setPartitionActionPath(partition.path);
    setPartitionActionStatus(null);
    try {
      const result = await invoke<string>("set_partition_mounted", {
        path: partition.path,
        mount,
      });
      setPartitionActionStatus({
        kind: "success",
        message:
          result ||
          `${partition.path} ${mount ? "mounted" : "unmounted"} successfully.`,
      });
      recordOperation({
        category: "Storage",
        action: mount ? "Mount volume" : "Unmount volume",
        target: partition.path,
        outcome: "success",
        note: "Linux completed the requested volume action.",
      });
      setPartitionRefreshKey((k) => k + 1);
    } catch (error) {
      setPartitionActionStatus({ kind: "error", message: String(error) });
      recordOperation({
        category: "Storage",
        action: mount ? "Mount volume" : "Unmount volume",
        target: partition.path,
        outcome: "failed",
        note: "Argus could not complete the requested volume action.",
      });
    } finally {
      setPartitionActionPath(null);
    }
  }
  async function requestStartupToggle(app: StartupAppSnapshot) {
    if (!app.command.trim()) return;
    const enabled = !app.enabled;
    if (
      !window.confirm(
        `${enabled ? "Enable" : "Disable"} ${app.name} at sign-in?`,
      )
    )
      return;
    setStartupActionId(app.id);
    setStartupActionStatus(null);
    try {
      const updated = await invoke<StartupAppSnapshot>("set_startup_enabled", {
        id: app.id,
        enabled,
        expectedEnabled: app.enabled,
        isSystemEntry: app.isSystemEntry,
      });
      setStartupApps((current) =>
        current.map((e) => (e.id === updated.id ? updated : e)),
      );
      setStartupActionStatus({
        kind: "success",
        message: `${app.name} will ${enabled ? "enable" : "disable"} at your next sign-in.`,
      });
      recordOperation({
        category: "Startup",
        action: `${enabled ? "Enable" : "Disable"} at sign-in`,
        target: app.name,
        outcome: "success",
        note: "Changed this account’s startup entry.",
      });
    } catch (error) {
      setStartupActionStatus({
        kind: "error",
        message: `Could not update ${app.name}: ${String(error)}`,
      });
      recordOperation({
        category: "Startup",
        action: `${enabled ? "Enable" : "Disable"} at sign-in`,
        target: app.name,
        outcome: "failed",
        note: "Argus could not update the startup entry.",
      });
    } finally {
      setStartupActionId(null);
    }
  }
  async function requestProcessEnd(process: ProcessSnapshot) {
    if (!window.confirm(`End ${process.name} (PID ${process.pid})?`)) return;
    setTerminatingPid(process.pid);
    setProcessActionStatus(null);
    try {
      await invoke("terminate_process", {
        pid: process.pid,
        expectedName: process.name,
        expectedStartTime: process.startTime,
      });
      setProcessActionStatus({
        kind: "success",
        message: `Termination requested for ${process.name}.`,
      });
      recordOperation({
        category: "Process",
        action: "End process",
        target: `${process.name} (PID ${process.pid})`,
        outcome: "success",
        note: "A normal termination signal was sent.",
      });
    } catch (error) {
      setProcessActionStatus({
        kind: "error",
        message: `Could not end ${process.name}: ${String(error)}`,
      });
      recordOperation({
        category: "Process",
        action: "End process",
        target: `${process.name} (PID ${process.pid})`,
        outcome: "failed",
        note: "Linux did not complete the non-administrator termination request.",
      });
      if (String(error).includes("higher privileges")) {
        if (window.confirm(`Retry with administrator authorization?`)) {
          try {
            await invoke("signal_process_with_authorization", {
              pid: process.pid,
              expectedName: process.name,
              expectedStartTime: process.startTime,
              signal: "term",
            });
            setProcessActionStatus({
              kind: "success",
              message: `Administrator-authorized termination signal sent.`,
            });
            recordOperation({
              category: "Process",
              action: "End process (admin)",
              target: `${process.name} (PID ${process.pid})`,
              outcome: "success",
              note: "Administrator-authorized termination signal was sent.",
            });
          } catch (e) {
            setProcessActionStatus({
              kind: "error",
              message: `Authorization failed: ${String(e)}`,
            });
            recordOperation({
              category: "Process",
              action: "End process (admin)",
              target: `${process.name} (PID ${process.pid})`,
              outcome: "failed",
              note: "Administrator-authorized termination failed.",
            });
          }
        }
      }
    } finally {
      setTerminatingPid(null);
    }
  }
  async function requestProcessForceStop(process: ProcessSnapshot) {
    if (
      !window.confirm(
        `Force stop ${process.name} (PID ${process.pid})? Unsaved data may be lost.`,
      )
    )
      return;
    setTerminatingPid(process.pid);
    setProcessActionStatus(null);
    try {
      await invoke("force_stop_process", {
        pid: process.pid,
        expectedName: process.name,
        expectedStartTime: process.startTime,
      });
      setProcessActionStatus({
        kind: "success",
        message: `Force-stop signal sent to ${process.name}.`,
      });
      recordOperation({
        category: "Process",
        action: "Force stop process",
        target: `${process.name} (PID ${process.pid})`,
        outcome: "success",
        note: "An immediate kill signal was sent.",
      });
    } catch (error) {
      setProcessActionStatus({
        kind: "error",
        message: `Could not force stop ${process.name}: ${String(error)}`,
      });
      recordOperation({
        category: "Process",
        action: "Force stop process",
        target: `${process.name} (PID ${process.pid})`,
        outcome: "failed",
        note: "Linux did not complete the non-administrator force-stop request.",
      });
      if (String(error).includes("higher privileges")) {
        if (window.confirm(`Retry with administrator authorization?`)) {
          try {
            await invoke("signal_process_with_authorization", {
              pid: process.pid,
              expectedName: process.name,
              expectedStartTime: process.startTime,
              signal: "kill",
            });
            setProcessActionStatus({
              kind: "success",
              message: `Administrator-authorized kill signal sent.`,
            });
            recordOperation({
              category: "Process",
              action: "Force stop process (admin)",
              target: `${process.name} (PID ${process.pid})`,
              outcome: "success",
              note: "Administrator-authorized kill signal was sent.",
            });
          } catch (e) {
            setProcessActionStatus({
              kind: "error",
              message: `Authorization failed: ${String(e)}`,
            });
            recordOperation({
              category: "Process",
              action: "Force stop process (admin)",
              target: `${process.name} (PID ${process.pid})`,
              outcome: "failed",
              note: "Administrator-authorized force-stop failed.",
            });
          }
        }
      }
    } finally {
      setTerminatingPid(null);
    }
  }
  async function requestServiceAction(
    service: ServiceSnapshot,
    action: "start" | "stop" | "enable" | "disable",
  ) {
    if (serviceActionUnit !== null) return;
    if (
      !window.confirm(
        `${action.charAt(0).toUpperCase() + action.slice(1)} ${service.unit}?`,
      )
    )
      return;
    setServiceActionUnit(service.unit);
    setServiceActionStatus(null);
    try {
      await invoke("set_service_state", {
        scope: service.scope,
        unit: service.unit,
        action,
      });
      setServiceActionStatus({
        kind: "success",
        message: `${service.unit}: ${action} request completed.`,
      });
      recordOperation({
        category: "Service",
        action: `${action} service`,
        target: service.unit,
        outcome: "success",
        note: "The service manager completed the request.",
      });
      setServiceRefreshKey((k) => k + 1);
    } catch (error) {
      setServiceActionStatus({
        kind: "error",
        message: `Could not ${action} ${service.unit}: ${String(error)}`,
      });
      recordOperation({
        category: "Service",
        action: `${action} service`,
        target: service.unit,
        outcome: "failed",
        note: "The service manager did not complete the request.",
      });
    } finally {
      setServiceActionUnit(null);
    }
  }
  async function showServiceLogs(service: ServiceSnapshot) {
    setServiceLogTarget(service);
    setServiceLogs([]);
    setServiceLogsLoading(true);
    try {
      setServiceLogs(
        await invoke<SystemLogEntry[]>("get_service_logs", {
          scope: service.scope,
          unit: service.unit,
        }),
      );
    } catch (e) {
      setServiceLogsError(String(e));
    } finally {
      setServiceLogsLoading(false);
    }
  }
  async function buildDiagnosticsReport() {
    setDiagnosticsLoading(true);
    try {
      const snap = await invoke<DiagnosticsSnapshot>(
        "get_diagnostics_snapshot",
      );
      setDiagnosticsSnapshot(snap);
      setDiagnosticsReport(
        `Argus Diagnostics\nGenerated: ${new Date().toISOString()}\n\nOS: ${snap.operatingSystem}\nKernel: ${snap.kernelVersion}\nArch: ${snap.architecture}\nProcessor: ${snap.processor}\nCores: ${snap.logicalProcessors}\nCPU Usage: ${snap.cpuUsagePercent.toFixed(1)}%\nMemory: ${formatBytes(snap.memoryUsedBytes)} / ${formatBytes(snap.memoryTotalBytes)}\nUptime: ${formatUptime(snap.uptimeSeconds)}`,
      );
      setDiagnosticsStatus({ kind: "success", message: "Report ready." });
    } catch (e) {
      setDiagnosticsStatus({ kind: "error", message: String(e) });
    } finally {
      setDiagnosticsLoading(false);
    }
  }
  async function saveDiagnosticsReport() {
    if (!diagnosticsReport) return;
    try {
      const path = await save({
        title: "Save Report",
        defaultPath: "argus-diagnostics.txt",
        filters: [{ name: "Text", extensions: ["txt"] }],
      });
      if (path) {
        await invoke("save_text_file", { path, contents: diagnosticsReport });
        setDiagnosticsStatus({ kind: "success", message: "Saved." });
      }
    } catch (e) {
      setDiagnosticsStatus({ kind: "error", message: String(e) });
    }
  }
  async function inspectLogSizes() {
    setLogLoading(true);
    try {
      setLogInventory(await invoke<LogInventorySnapshot>("get_log_inventory"));
    } catch (e) {
      setLogError(String(e));
    } finally {
      setLogLoading(false);
    }
  }
  async function inspectCacheSizes() {
    setCacheLoading(true);
    try {
      setCacheInventory(
        await invoke<CacheInventorySnapshot>("get_cache_inventory"),
      );
    } catch (e) {
      setCacheError(String(e));
    } finally {
      setCacheLoading(false);
    }
  }
  async function clearCacheEntry(entry: CacheEntrySnapshot) {
    if (!window.confirm(`Clear ${entry.name} cache?`)) return;
    try {
      await invoke("clear_cache_entry", { directoryName: entry.name });
      recordOperation({
        category: "Maintenance",
        action: "Clear cache",
        target: entry.name,
        outcome: "success",
        note: "Application cache folder was cleared.",
      });
      await inspectCacheSizes();
    } catch (e) {
      recordOperation({
        category: "Maintenance",
        action: "Clear cache",
        target: entry.name,
        outcome: "failed",
        note: "Could not clear the cache folder.",
      });
      setCacheError(String(e));
    }
  }
  async function chooseAndScanLargeFiles() {
    try {
      const selected = await openDialog({
        title: "Select Folder",
        directory: true,
        multiple: false,
      });
      if (typeof selected === "string") {
        setLargeFileLoading(true);
        setLargeFileScan(
          await invoke<LargeFileScanResult>("scan_large_files", {
            root: selected,
            minimumSizeBytes: largeFileMinimum,
          }),
        );
      }
    } catch (e) {
      setLargeFileError(String(e));
    } finally {
      setLargeFileLoading(false);
    }
  }

  // --- Command Palette Data ---
  const allCommands: CommandItem[] = [
    {
      id: "nav-overview",
      label: "Go to Overview",
      category: "Navigation",
      icon: icons.overview,
      action: () => setPage("overview"),
    },
    {
      id: "nav-performance",
      label: "Go to Performance",
      category: "Navigation",
      icon: icons.performance,
      action: () => setPage("performance"),
    },
    {
      id: "nav-processes",
      label: "Go to Processes",
      category: "Navigation",
      icon: icons.processes,
      action: () => setPage("processes"),
    },
    {
      id: "nav-activity",
      label: "Go to Activity",
      category: "Navigation",
      icon: icons.activity,
      action: () => setPage("activity"),
    },
    {
      id: "nav-storage",
      label: "Go to Storage",
      category: "Navigation",
      icon: icons.storage,
      action: () => setPage("storage"),
    },
    {
      id: "nav-sensors",
      label: "Go to Sensors",
      category: "Navigation",
      icon: icons.sensors,
      action: () => setPage("sensors"),
    },
    {
      id: "nav-system",
      label: "Go to System",
      category: "Navigation",
      icon: icons.system,
      action: () => setPage("system"),
    },
    {
      id: "nav-network",
      label: "Go to Network",
      category: "Navigation",
      icon: icons.network,
      action: () => setPage("network"),
    },
    {
      id: "nav-connections",
      label: "Go to Connections",
      category: "Navigation",
      icon: icons.connections,
      action: () => setPage("connections"),
    },
    {
      id: "nav-startup",
      label: "Go to Startup",
      category: "Navigation",
      icon: icons.startup,
      action: () => setPage("startup"),
    },
    {
      id: "nav-services",
      label: "Go to Services",
      category: "Navigation",
      icon: icons.services,
      action: () => setPage("services"),
    },
    {
      id: "nav-software",
      label: "Go to Software",
      category: "Navigation",
      icon: icons.software,
      action: () => setPage("software"),
    },
    {
      id: "nav-maintenance",
      label: "Go to Maintenance",
      category: "Navigation",
      icon: icons.maintenance,
      action: () => setPage("maintenance"),
    },
    {
      id: "nav-diagnostics",
      label: "Go to Diagnostics",
      category: "Navigation",
      icon: icons.diagnostics,
      action: () => setPage("diagnostics"),
    },
    {
      id: "nav-logs",
      label: "Go to Recent Logs",
      category: "Navigation",
      icon: icons.logs,
      action: () => setPage("logs"),
    },
    {
      id: "nav-settings",
      label: "Go to Settings",
      category: "Navigation",
      icon: icons.settings,
      action: () => setPage("settings"),
    },
    {
      id: "action-theme-dark",
      label: "Switch to Dark Theme",
      category: "Actions",
      icon: icons.moon,
      action: () => setMode("dark"),
    },
    {
      id: "action-theme-light",
      label: "Switch to Light Theme",
      category: "Actions",
      icon: icons.sun,
      action: () => setMode("light"),
    },
    {
      id: "action-scan",
      label: "Run Quick Scan",
      category: "Actions",
      icon: icons.plus,
      action: () => {
        setPage("diagnostics");
        void buildDiagnosticsReport();
      },
    },
    {
      id: "action-clean",
      label: "Free up space",
      category: "Actions",
      icon: icons.plus,
      action: () => setPage("maintenance"),
    },
  ];

  const filteredCommands = allCommands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(paletteQuery.toLowerCase()) ||
      cmd.category.toLowerCase().includes(paletteQuery.toLowerCase()),
  );

  // Reset selection if the query changes
  useEffect(() => {
    setSelectedCommandIndex(0);
  }, [paletteQuery]);

  const handlePaletteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedCommandIndex((prev) => (prev + 1) % filteredCommands.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedCommandIndex(
        (prev) =>
          (prev - 1 + filteredCommands.length) % filteredCommands.length,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCommands[selectedCommandIndex]) {
        filteredCommands[selectedCommandIndex].action();
        setIsPaletteOpen(false);
      }
    }
  };

  // --- UI Components ---
  const renderSidebar = () => {
    const groups = [
      {
        id: "Dashboard",
        icon: icons.overview,
        items: [{ id: "overview", label: "Overview" }],
      },
      {
        id: "Monitor",
        icon: icons.performance,
        items: [
          { id: "performance", label: "Performance" },
          { id: "processes", label: "Processes" },
          { id: "activity", label: "Activity" },
        ],
      },
      {
        id: "Hardware",
        icon: icons.storage,
        items: [
          { id: "storage", label: "Storage" },
          { id: "sensors", label: "Sensors" },
          { id: "system", label: "System" },
        ],
      },
      {
        id: "Network",
        icon: icons.network,
        items: [
          { id: "network", label: "Network" },
          { id: "connections", label: "Connections" },
        ],
      },
      {
        id: "Manage",
        icon: icons.startup,
        items: [
          { id: "startup", label: "Startup" },
          { id: "services", label: "Services" },
          { id: "software", label: "Software" },
        ],
      },
      {
        id: "Tools",
        icon: icons.maintenance,
        items: [
          { id: "maintenance", label: "Maintenance" },
          { id: "diagnostics", label: "Diagnostics" },
          { id: "logs", label: "Recent Logs" },
        ],
      },
    ];

    return (
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Icon path={icons.activity} size={20} />
          </div>
          {!sidebarCollapsed && (
            <div className="brand-text">
              <strong>Argus</strong>
              <span>Workstation</span>
            </div>
          )}
        </div>
        {!sidebarCollapsed && (
          <div className="sidebar-quick-actions">
            <button
              onClick={() => setPage("diagnostics")}
              className="quick-action-pill"
            >
              <Icon path={icons.plus} size={14} /> Quick scan
            </button>
            <button
              onClick={() => setPage("maintenance")}
              className="quick-action-pill"
            >
              <Icon path={icons.plus} size={14} /> Free up space
            </button>
          </div>
        )}
        <nav className="navigation">
          {groups.map((group) => {
            const isOpen = openGroup === group.id;
            const hasActiveChild = group.items.some((i) => i.id === page);
            return (
              <div key={group.id} className="nav-group">
                <button
                  className={`nav-group-header ${hasActiveChild ? "active-group" : ""}`}
                  onClick={() => setOpenGroup(isOpen ? null : group.id)}
                  aria-expanded={isOpen}
                >
                  <Icon path={group.icon} />
                  {!sidebarCollapsed && <span>{group.id}</span>}
                  {!sidebarCollapsed && (
                    <Icon
                      path={icons.chevronDown}
                      className={`chevron ${isOpen ? "open" : ""}`}
                      size={14}
                    />
                  )}
                </button>
                {!sidebarCollapsed && (
                  <div className={`nav-group-children ${isOpen ? "open" : ""}`}>
                    <div className="nav-group-children-inner">
                      {group.items.map((item) => (
                        <button
                          key={item.id}
                          className={`nav-child ${page === item.id ? "active" : ""}`}
                          onClick={() => setPage(item.id as AppPage)}
                        >
                          {item.label}
                          {page === item.id && (
                            <Icon path={icons.chevronRight} size={14} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <button
            className={`nav-item ${page === "settings" ? "active" : ""}`}
            onClick={() => setPage("settings")}
          >
            <Icon path={icons.settings} /> {!sidebarCollapsed && "Settings"}
          </button>
          <div className="sidebar-bottom-row">
            {!sidebarCollapsed && (
              <div className="sidebar-status">
                <span className="status-dot" /> Local session
              </div>
            )}
            <button
              className="collapse-btn"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              <Icon
                path={sidebarCollapsed ? icons.chevronRight : icons.chevronDown}
                size={16}
              />
            </button>
          </div>
        </div>
      </aside>
    );
  };

  const renderHeader = () => {
    const hour = new Date().getHours();
    const greeting =
      hour < 12
        ? "Good Morning"
        : hour < 18
          ? "Good Afternoon"
          : "Good Evening";
    const dateStr = new Date().toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    return (
      <header className="topbar">
        <h1 className="greeting">
          {greeting}, {username}!
        </h1>
        <div className="topbar-actions">
          <div
            className="search-pill"
            onClick={() => setIsPaletteOpen(true)}
            style={{ cursor: "pointer" }}
          >
            <Icon path={icons.search} size={16} />
            <input type="text" placeholder="Search..." readOnly />
            <span className="search-shortcut">⌘K</span>
          </div>
          <div className="date-pill">
            <Icon path={icons.calendar} size={16} />
            {dateStr}
          </div>
          <div className="theme-toggle-pill">
            <button
              className={mode === "light" ? "active" : ""}
              onClick={() => setMode("light")}
              title="Light Theme"
            >
              <Icon path={icons.sun} size={16} />
            </button>
            <button
              className={mode === "dark" ? "active" : ""}
              onClick={() => setMode("dark")}
              title="Dark Theme"
            >
              <Icon path={icons.moon} size={16} />
            </button>
          </div>
          <div className="avatar">{username.charAt(0).toUpperCase()}</div>
        </div>
      </header>
    );
  };

  const renderDonutChart = () => {
    const totalUsed = drives.reduce(
      (acc, d) => acc + (d.totalBytes - d.availableBytes),
      0,
    );
    const radius = 60;
    const strokeWidth = 20;
    const circumference = 2 * Math.PI * radius;
    const colors = ["#a78bfa", "#6ee7b7", "#fbbf24", "#38bdf8"];
    let currentOffset = 0;
    if (drives.length === 0)
      return (
        <div className="text-muted text-center mt-4">No volumes found</div>
      );

    return (
      <div className="donut-container">
        <svg
          width="160"
          height="160"
          viewBox="0 0 160 160"
          className="donut-svg"
        >
          {drives.map((drive, i) => {
            const used = drive.totalBytes - drive.availableBytes;
            let percent = totalUsed > 0 ? (used / totalUsed) * 100 : 0;
            if (percent < 3 && percent > 0) percent = 3;
            const strokeDasharray = `${(percent / 100) * circumference} ${circumference}`;
            const strokeDashoffset = -((currentOffset / 100) * circumference);
            currentOffset += percent;
            return (
              <circle
                key={drive.mountPoint}
                cx="80"
                cy="80"
                r={radius}
                fill="transparent"
                stroke={colors[i % colors.length]}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                style={{ transition: "stroke-dasharray 0.5s ease" }}
              />
            );
          })}
        </svg>
        <div className="donut-center">
          <strong>{formatGiB(totalUsed)}</strong>
          <span>GiB Used</span>
        </div>
      </div>
    );
  };

  // --- Page Renderers ---
  const renderOverview = () => (
    <div className="overview-layout">
      <div className="overview-left">
        <div className="stats-row">
          {metrics.map((m) => (
            <article className="stat-card" key={m.label}>
              <div className="stat-card-header">
                <span className="stat-label">{m.label}</span>
                <button className="stat-link" onClick={() => setPage(m.page)}>
                  <Icon path={icons.arrowUpRight} size={14} />
                </button>
              </div>
              <div className="stat-value">{m.value}</div>
              <div className="stat-detail">{m.detail}</div>
            </article>
          ))}
        </div>
        <article className="chart-card">
          <div className="chart-header">
            <h2>System activity</h2>
            <div className="chart-legend">
              <span className="legend-item">
                <span className="legend-chip cpu" /> CPU usage
              </span>
              <span className="legend-item">
                <span className="legend-chip mem" /> Memory usage
              </span>
            </div>
            <select
              className="period-select"
              value={historyWindow}
              onChange={(e) => setHistoryWindow(Number(e.target.value))}
            >
              <option value={300}>Last 5 minutes</option>
              <option value={900}>Last 15 minutes</option>
              <option value={1800}>Last 30 minutes</option>
            </select>
          </div>
          <div className="chart-body">
            <svg
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="none"
              className="main-chart"
            >
              <defs>
                <linearGradient id="cpuGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--accent-violet)"
                    stopOpacity="0.3"
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--accent-violet)"
                    stopOpacity="0"
                  />
                </linearGradient>
                <linearGradient id="memGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="0%"
                    stopColor="var(--accent-amber)"
                    stopOpacity="0.15"
                  />
                  <stop
                    offset="100%"
                    stopColor="var(--accent-amber)"
                    stopOpacity="0"
                  />
                </linearGradient>
              </defs>
              <line
                x1="0"
                y1={chartHeight * 0.25}
                x2={chartWidth}
                y2={chartHeight * 0.25}
                stroke="var(--border-subtle)"
                strokeDasharray="4 4"
              />
              <line
                x1="0"
                y1={chartHeight * 0.5}
                x2={chartWidth}
                y2={chartHeight * 0.5}
                stroke="var(--border-subtle)"
                strokeDasharray="4 4"
              />
              <line
                x1="0"
                y1={chartHeight * 0.75}
                x2={chartWidth}
                y2={chartHeight * 0.75}
                stroke="var(--border-subtle)"
                strokeDasharray="4 4"
              />
              {visibleHistory.length > 1 && (
                <>
                  <path d={cpuAreaPath} fill="url(#cpuGrad)" />
                  <path
                    d={cpuPath}
                    fill="none"
                    stroke="var(--accent-violet)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                  <path d={memAreaPath} fill="url(#memGrad)" />
                  <path
                    d={memPath}
                    fill="none"
                    stroke="var(--accent-amber)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </>
              )}
            </svg>
          </div>
        </article>
        <div className="bottom-cards-row">
          <article className="network-card">
            <div className="card-header">
              <span className="card-label">Network</span>
              <button className="stat-link" onClick={() => setPage("network")}>
                <Icon path={icons.arrowUpRight} size={14} />
              </button>
            </div>
            <div className="network-rates">
              <div className="rate-block">
                <span>↓ Download</span>
                <strong>{formatNetworkRate(totalDownloadRate)}</strong>
              </div>
              <div className="rate-block">
                <span>↑ Upload</span>
                <strong>{formatNetworkRate(totalUploadRate)}</strong>
              </div>
            </div>
            <div className="network-interface">
              {nonLoopbackInterfaces[0]?.name || "No active interface"}
            </div>
          </article>
          <article className="storage-bars-card">
            <div className="card-header">
              <span className="card-label">Storage</span>
              <button className="stat-link" onClick={() => setPage("storage")}>
                <Icon path={icons.arrowUpRight} size={14} />
              </button>
            </div>
            <div className="storage-bars-list">
              {drives.slice(0, 2).map((d) => {
                const used = d.totalBytes - d.availableBytes;
                const pct = d.totalBytes > 0 ? (used / d.totalBytes) * 100 : 0;
                return (
                  <div className="storage-bar-item" key={d.mountPoint}>
                    <div className="storage-bar-labels">
                      <span>{d.mountPoint}</span>
                      <span>{Math.round(pct)}%</span>
                    </div>
                    <div className="storage-bar-track">
                      <div
                        className="storage-bar-fill"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </article>
        </div>
      </div>
      <div className="overview-right">
        <article className="process-list-card">
          <div className="card-header">
            <span className="card-label">Top processes</span>
          </div>
          <div className="process-mini-list">
            {processes.slice(0, 5).map((p) => (
              <div className="process-mini-item" key={p.pid}>
                <div className="process-mini-icon">
                  <Icon path={icons.processes} size={14} />
                </div>
                <div className="process-mini-info">
                  <strong>{p.name}</strong>
                  <span>PID {p.pid}</span>
                </div>
                <div
                  className="process-mini-value"
                  style={{
                    color:
                      p.cpuUsagePercent > 50
                        ? "var(--accent-red)"
                        : "var(--accent-teal)",
                  }}
                >
                  {p.cpuUsagePercent.toFixed(1)}%
                </div>
              </div>
            ))}
          </div>
        </article>
        <article className="donut-card">
          <div className="card-header">
            <span className="card-label">Storage by volume</span>
          </div>
          {renderDonutChart()}
          <div className="donut-legend">
            {drives.slice(0, 4).map((d, i) => (
              <div className="legend-row" key={d.mountPoint}>
                <span
                  className="legend-dot"
                  style={{
                    background: ["#a78bfa", "#6ee7b7", "#fbbf24", "#38bdf8"][
                      i % 4
                    ],
                  }}
                />
                <span className="legend-name">{d.mountPoint}</span>
                <span className="legend-value">
                  {formatGiB(d.totalBytes - d.availableBytes)} GiB
                </span>
              </div>
            ))}
          </div>
        </article>
      </div>
    </div>
  );

  const renderProcesses = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Processes</h2>
          <p>See which programs are using your system resources.</p>
        </div>
        <div className="flex gap-4">
          <select
            value={processStateFilter}
            onChange={(e) =>
              setProcessStateFilter(e.target.value as ProcessStateFilter)
            }
          >
            <option value="all">All states</option>
            <option value="running">Running</option>
            <option value="sleeping">Sleeping</option>
            <option value="stopped">Stopped</option>
          </select>
          <div className="search-bar">
            <Icon path={icons.search} size={14} />
            <input
              type="search"
              placeholder="Search processes..."
              value={processQuery}
              onChange={(e) => setProcessQuery(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="panel-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <button
                    onClick={() => {
                      setProcessSort((s) => ({
                        key: "name",
                        direction:
                          s.key === "name" && s.direction === "desc"
                            ? "asc"
                            : "desc",
                      }));
                    }}
                  >
                    Name ↕
                  </button>
                </th>
                <th>
                  <button
                    onClick={() => {
                      setProcessSort((s) => ({
                        key: "pid",
                        direction:
                          s.key === "pid" && s.direction === "desc"
                            ? "asc"
                            : "desc",
                      }));
                    }}
                  >
                    PID ↕
                  </button>
                </th>
                <th>
                  <button
                    onClick={() => {
                      setProcessSort((s) => ({
                        key: "cpu",
                        direction:
                          s.key === "cpu" && s.direction === "desc"
                            ? "asc"
                            : "desc",
                      }));
                    }}
                  >
                    CPU ↕
                  </button>
                </th>
                <th>
                  <button
                    onClick={() => {
                      setProcessSort((s) => ({
                        key: "memory",
                        direction:
                          s.key === "memory" && s.direction === "desc"
                            ? "asc"
                            : "desc",
                      }));
                    }}
                  >
                    Memory ↕
                  </button>
                </th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {processTreeRows.map(({ process, depth, childCount }) => (
                <tr key={process.pid}>
                  <td>
                    <span
                      style={{
                        paddingLeft:
                          processViewMode === "tree" ? `${depth * 16}px` : 0,
                      }}
                    >
                      {processViewMode === "tree" && childCount > 0 ? "▾ " : ""}
                      {process.name}
                    </span>
                  </td>
                  <td>{process.pid}</td>
                  <td>
                    <strong>{process.cpuUsagePercent.toFixed(1)}%</strong>
                  </td>
                  <td>{formatProcessMemory(process.memoryBytes)}</td>
                  <td>
                    <button
                      className="btn btn-danger"
                      onClick={() => void requestProcessEnd(process)}
                      disabled={terminatingPid !== null}
                    >
                      End
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderStorage = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Storage</h2>
          <p>Review mounted volumes, partitions, and drive health.</p>
        </div>
        <div className="search-bar">
          <Icon path={icons.search} size={14} />
          <input
            type="search"
            placeholder="Search partitions..."
            value={driveQuery}
            onChange={(e) => setDriveQuery(e.target.value)}
          />
        </div>
      </div>

      {partitionActionStatus && (
        <div
          className={`panel-card mt-4 ${partitionActionStatus.kind === "error" ? "status-error" : "status-success"}`}
          style={{ marginBottom: 16 }}
        >
          {partitionActionStatus.message}
        </div>
      )}

      <div className="stats-row">
        {drives.map((d) => {
          const used = d.totalBytes - d.availableBytes;
          const pct = d.totalBytes > 0 ? (used / d.totalBytes) * 100 : 0;
          return (
            <article className="stat-card" key={d.mountPoint}>
              <div className="stat-card-header">
                <span className="stat-label">{d.mountPoint}</span>
                <span className="badge neutral">{d.fileSystem}</span>
              </div>
              <div className="stat-value">{formatGiB(d.totalBytes)} GiB</div>
              <div className="stat-detail">
                {formatGiB(used)} GiB used · {formatGiB(d.availableBytes)} GiB
                free
              </div>
              <div className="storage-bar-track mt-4">
                <div
                  className="storage-bar-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </article>
          );
        })}
      </div>

      <div className="panel-card mt-4">
        <div className="flex justify-between items-center mb-4">
          <h3>Partitions</h3>
          {partitionLoading && <span className="text-faint">Refreshing…</span>}
        </div>
        {partitionError && (
          <p className="text-muted" style={{ marginBottom: 12 }}>
            {partitionError}
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Device</th>
                <th>Label</th>
                <th>Filesystem</th>
                <th>Size</th>
                <th>Mounted at</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredPartitions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted">
                    {partitionLoading
                      ? "Loading partitions…"
                      : "No partitions found."}
                  </td>
                </tr>
              ) : (
                filteredPartitions.map((p) => {
                  const isMounted = p.mountPoints.some(
                    (m) => m && m !== "[SWAP]",
                  );
                  const isSwap = p.mountPoints.includes("[SWAP]");
                  const canAct =
                    p.deviceType === "part" &&
                    !isSwap &&
                    partitionActionPath === null;
                  const busy = partitionActionPath === p.path;

                  return (
                    <tr key={p.path || p.name}>
                      <td>
                        <strong>{p.path || p.name}</strong>
                        <div className="text-faint">{p.deviceType}</div>
                      </td>
                      <td>{p.label || "—"}</td>
                      <td>
                        <span className="badge neutral">
                          {p.fileSystem || "—"}
                        </span>
                      </td>
                      <td>{formatGiB(p.sizeBytes)} GiB</td>
                      <td>
                        {isSwap
                          ? "[SWAP]"
                          : isMounted
                            ? p.mountPoints
                                .filter((m) => m !== "[SWAP]")
                                .join(", ")
                            : "—"}
                      </td>
                      <td>
                        {isSwap ? (
                          <span className="text-faint">Swap</span>
                        ) : isMounted ? (
                          <button
                            className="btn btn-secondary"
                            disabled={!canAct || busy}
                            onClick={() => void requestPartitionMount(p, false)}
                          >
                            {busy ? "Working…" : "Unmount"}
                          </button>
                        ) : (
                          <button
                            className="btn btn-primary"
                            disabled={!canAct || busy}
                            onClick={() => void requestPartitionMount(p, true)}
                          >
                            {busy ? "Working…" : "Mount"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel-card mt-4">
        <h3>Physical drive health</h3>
        <div className="mt-4">
          {driveHealthLoading && driveHealth.length === 0 ? (
            <p className="text-muted">Loading drive health…</p>
          ) : driveHealthError ? (
            <p className="text-muted">{driveHealthError}</p>
          ) : driveHealth.length === 0 ? (
            <p className="text-muted">No drive health data available.</p>
          ) : (
            driveHealth.map((d) => (
              <div
                className="flex justify-between items-center"
                key={d.path}
                style={{
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <div>
                  <strong>{d.model}</strong>
                  <div className="text-faint">{d.path}</div>
                </div>
                <span
                  className={`badge ${
                    d.healthState === "healthy"
                      ? "success"
                      : d.healthState === "warning"
                        ? "warning"
                        : "neutral"
                  }`}
                >
                  {d.healthState}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );

  const renderNetwork = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Network</h2>
          <p>Live traffic and addresses for this device.</p>
        </div>
      </div>
      <div className="stats-row">
        {networkInterfaces.map((n) => (
          <article className="stat-card" key={n.name}>
            <div className="stat-card-header">
              <span className="stat-label">{n.name}</span>
              <span className="badge neutral">{n.macAddress}</span>
            </div>
            <div className="flex justify-between mt-4">
              <div className="flex-col">
                <span className="text-muted">↓ Download</span>
                <strong>{formatNetworkRate(n.downloadBytesPerSecond)}</strong>
              </div>
              <div className="flex-col">
                <span className="text-muted">↑ Upload</span>
                <strong>{formatNetworkRate(n.uploadBytesPerSecond)}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );

  const renderConnections = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Connections</h2>
          <p>Active listening ports and owning processes.</p>
        </div>
        <div className="search-bar">
          <Icon path={icons.search} size={14} />
          <input
            type="search"
            placeholder="Search connections..."
            value={connectionsQuery}
            onChange={(e) => setConnectionsQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="panel-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Protocol</th>
                <th>State</th>
                <th>Local Address</th>
                <th>Process</th>
                <th>PID</th>
              </tr>
            </thead>
            <tbody>
              {filteredConnections.map((c, i) => (
                <tr key={i}>
                  <td>
                    <span className="badge neutral">{c.protocol}</span>
                  </td>
                  <td>{c.state}</td>
                  <td>{c.localAddress}</td>
                  <td>{c.process}</td>
                  <td>{c.pid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderServices = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Services</h2>
          <p>System and user services.</p>
        </div>
        <div className="flex gap-4">
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value as ServiceFilter)}
          >
            <option value="all">All states</option>
            <option value="active">Active</option>
            <option value="failed">Failed</option>
          </select>
          <div className="search-bar">
            <Icon path={icons.search} size={14} />
            <input
              type="search"
              placeholder="Search services..."
              value={serviceQuery}
              onChange={(e) => setServiceQuery(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="panel-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Unit</th>
                <th>Scope</th>
                <th>State</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleServices.map((s) => (
                <tr key={s.unit}>
                  <td>
                    <strong>{s.unit}</strong>
                    <div className="text-faint">{s.description}</div>
                  </td>
                  <td>
                    <span className="badge neutral">{s.scope}</span>
                  </td>
                  <td>
                    <span
                      className={`badge ${s.activeState === "active" ? "success" : "warning"}`}
                    >
                      {s.activeState}
                    </span>
                  </td>
                  <td>
                    {s.activeState === "active" ? (
                      <button
                        className="btn btn-danger"
                        onClick={() => void requestServiceAction(s, "stop")}
                      >
                        Stop
                      </button>
                    ) : (
                      <button
                        className="btn btn-primary"
                        onClick={() => void requestServiceAction(s, "start")}
                      >
                        Start
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderSoftware = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Software</h2>
          <p>Installed packages and updates.</p>
        </div>
        <div className="flex gap-4">
          <select
            value={packageFilter}
            onChange={(e) => setPackageFilter(e.target.value as PackageFilter)}
          >
            <option value="upgradable">Updates available</option>
            <option value="all">All installed</option>
          </select>
          <div className="search-bar">
            <Icon path={icons.search} size={14} />
            <input
              type="search"
              placeholder="Search packages..."
              value={packageQuery}
              onChange={(e) => setPackageQuery(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="panel-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Source</th>
                <th>Version</th>
              </tr>
            </thead>
            <tbody>
              {visiblePackages.map((p) => (
                <tr key={`${p.name}:${p.architecture}`}>
                  <td>
                    <strong>{p.name}</strong>
                    <div className="text-faint">{p.summary}</div>
                  </td>
                  <td>
                    <span className="badge neutral">{p.source}</span>
                  </td>
                  <td>
                    {p.version}{" "}
                    {p.upgradeVersion && (
                      <span className="badge success">
                        Update to {p.upgradeVersion}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Settings</h2>
          <p>Preferences for this Argus installation.</p>
        </div>
      </div>
      <div className="panel-card">
        <div
          className="flex justify-between items-center"
          style={{
            padding: "16px 0",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div>
            <strong>Temperature units</strong>
            <div className="text-faint">
              Choose how temperatures are displayed.
            </div>
          </div>
          <select
            value={temperatureUnit}
            onChange={(e) =>
              setTemperatureUnit(e.target.value as TemperatureUnit)
            }
          >
            <option value="celsius">Celsius (°C)</option>
            <option value="fahrenheit">Fahrenheit (°F)</option>
          </select>
        </div>
        <div
          className="flex justify-between items-center"
          style={{ padding: "16px 0" }}
        >
          <div>
            <strong>Performance chart range</strong>
            <div className="text-faint">
              Default time range for the overview chart.
            </div>
          </div>
          <select
            value={historyWindow}
            onChange={(e) => setHistoryWindow(Number(e.target.value))}
          >
            <option value={300}>5 minutes</option>
            <option value={900}>15 minutes</option>
            <option value={1800}>30 minutes</option>
          </select>
        </div>
      </div>
      <div className="panel-card mt-4">
        <h3>About Argus</h3>
        <p className="text-muted mt-4">
          Version 0.1.0 · A local-first, AI-free Linux workstation utility.
        </p>
      </div>
    </div>
  );

  const renderMaintenance = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Maintenance</h2>
          <p>Clean caches, find large files, and inspect logs.</p>
        </div>
      </div>
      <div className="panel-card">
        <div className="flex justify-between items-center mb-4">
          <h3>Application cache usage</h3>
          <button
            className="btn btn-primary"
            onClick={() => void inspectCacheSizes()}
          >
            Inspect cache sizes
          </button>
        </div>
        {cacheInventory &&
          cacheInventory.entries.map((e) => (
            <div
              className="flex justify-between items-center"
              key={e.name}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <div>
                <strong>{e.name}</strong>
                <div className="text-faint">{e.fileCount} files</div>
              </div>
              <div className="flex gap-4 items-center">
                <span>{formatProcessMemory(e.sizeBytes)}</span>
                {e.clearable && (
                  <button
                    className="btn btn-danger"
                    onClick={() => void clearCacheEntry(e)}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
    </div>
  );

  const renderDiagnostics = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Diagnostics</h2>
          <p>System health and support reports.</p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => void buildDiagnosticsReport()}
        >
          Collect report
        </button>
      </div>
      <div className="panel-card">
        <h3>System Health</h3>
        {healthSnapshot && !healthSnapshot.healthy ? (
          healthSnapshot.alerts.map((a, i) => (
            <div
              className={`badge ${a.severity === "critical" ? "danger" : "warning"}`}
              key={i}
              style={{
                display: "block",
                padding: "16px",
                marginTop: "16px",
                borderRadius: "10px",
              }}
            >
              <strong>{a.title}</strong>
              <p>{a.message}</p>
            </div>
          ))
        ) : (
          <p className="text-muted mt-4">System is healthy.</p>
        )}
      </div>
      {diagnosticsReport && (
        <div className="panel-card mt-4">
          <pre
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "monospace",
              fontSize: "12px",
              color: "var(--text-muted)",
            }}
          >
            {diagnosticsReport}
          </pre>
          <button
            className="btn btn-secondary mt-4"
            onClick={() => void saveDiagnosticsReport()}
          >
            Save Report
          </button>
        </div>
      )}
    </div>
  );

  const renderPerformance = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Performance</h2>
          <p>Live processor, memory, and GPU usage.</p>
        </div>
      </div>
      {performanceSnapshot && (
        <div className="stats-row">
          <article className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Total CPU</span>
            </div>
            <div className="stat-value">
              {Math.round(performanceSnapshot.cpuUsagePercent)}%
            </div>
          </article>
          <article className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Memory</span>
            </div>
            <div className="stat-value">
              {formatProcessMemory(performanceSnapshot.memoryUsedBytes)}
            </div>
            <div className="stat-detail">
              of {formatProcessMemory(performanceSnapshot.memoryTotalBytes)}
            </div>
          </article>
          <article className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Swap</span>
            </div>
            <div className="stat-value">
              {formatProcessMemory(performanceSnapshot.swapUsedBytes)}
            </div>
            <div className="stat-detail">
              of {formatProcessMemory(performanceSnapshot.swapTotalBytes)}
            </div>
          </article>
        </div>
      )}
      {hardwareExtra && hardwareExtra.gpus.length > 0 && (
        <div className="stats-row mt-4">
          {hardwareExtra.gpus.map((gpu, i) => (
            <article className="stat-card" key={i}>
              <div className="stat-card-header">
                <span className="stat-label">{gpu.name}</span>
              </div>
              <div className="stat-value">
                {Math.round(gpu.utilizationPercent)}%
              </div>
              <div className="stat-detail">
                {formatProcessMemory(gpu.vramUsedBytes)} /{" "}
                {formatProcessMemory(gpu.vramTotalBytes)} VRAM
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="panel-card mt-4">
        <h3>Logical processor usage</h3>
        <div className="mt-4">
          {performanceSnapshot?.cores.map((core) => (
            <div
              className="flex justify-between items-center"
              key={core.name}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border-subtle)",
              }}
            >
              <span>{core.name}</span>
              <strong>{Math.round(core.usagePercent)}%</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderSensors = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Sensors</h2>
          <p>Hardware temperatures and fan speeds.</p>
        </div>
      </div>
      <div className="stats-row">
        {temperatures.map((s, i) => (
          <article className="stat-card" key={i}>
            <div className="stat-card-header">
              <span className="stat-label">{s.label || "Sensor"}</span>
            </div>
            <div className="stat-value">
              {Math.round(s.temperatureCelsius)}°C
            </div>
            <div className="stat-detail">
              {s.criticalCelsius
                ? `Critical at ${s.criticalCelsius}°C`
                : "No critical limit"}
            </div>
          </article>
        ))}
      </div>
      {hardwareExtra && hardwareExtra.fans.length > 0 && (
        <div className="panel-card mt-4">
          <h3>Cooling fans</h3>
          <div className="mt-4">
            {hardwareExtra.fans.map((f, i) => (
              <div
                className="flex justify-between items-center"
                key={i}
                style={{
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <span>{f.label}</span>
                <strong>{f.rpm} RPM</strong>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const renderSystem = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>System</h2>
          <p>Device information and hardware details.</p>
        </div>
      </div>
      {systemInfo && (
        <div className="stats-row">
          <article className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Operating System</span>
            </div>
            <div className="stat-value" style={{ fontSize: "20px" }}>
              {systemInfo.operatingSystem}
            </div>
            <div className="stat-detail">Kernel {systemInfo.kernelVersion}</div>
          </article>
          <article className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Processor</span>
            </div>
            <div className="stat-value" style={{ fontSize: "16px" }}>
              {systemInfo.processor}
            </div>
            <div className="stat-detail">
              {systemInfo.logicalProcessors} logical processors
            </div>
          </article>
          <article className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Memory</span>
            </div>
            <div className="stat-value">
              {formatBytes(systemInfo.memoryTotalBytes)}
            </div>
          </article>
          <article className="stat-card">
            <div className="stat-card-header">
              <span className="stat-label">Uptime</span>
            </div>
            <div className="stat-value">
              {formatUptime(systemInfo.uptimeSeconds)}
            </div>
          </article>
        </div>
      )}
      {systemInfo && systemInfo.usbDevices.length > 0 && (
        <div className="panel-card mt-4">
          <h3>USB Devices</h3>
          <div className="mt-4">
            {systemInfo.usbDevices.map((d) => (
              <div
                className="flex justify-between items-center"
                key={d.path}
                style={{
                  padding: "12px 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <div>
                  <strong>{d.product}</strong>
                  <div className="text-faint">{d.manufacturer}</div>
                </div>
                <span className="badge neutral">
                  {d.vendorId}:{d.productId}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
  const renderActivity = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Activity</h2>
          <p>Review local records of system actions.</p>
        </div>
        <div className="flex gap-4">
          <button className="btn btn-secondary" onClick={clearOperationHistory}>
            Clear history
          </button>
        </div>
      </div>
      <div className="panel-card">
        {operationHistory.length === 0 ? (
          <p className="text-muted">No actions recorded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Category</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Outcome</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {operationHistory.map((o) => (
                  <tr key={o.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {new Date(o.timestamp).toLocaleString()}
                    </td>
                    <td>
                      <span className="badge neutral">{o.category}</span>
                    </td>
                    <td>{o.action}</td>
                    <td>{o.target}</td>
                    <td>
                      <span
                        className={`badge ${o.outcome === "success" ? "success" : "danger"}`}
                      >
                        {o.outcome}
                      </span>
                    </td>
                    <td className="text-faint">{o.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
  const renderStartup = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Startup</h2>
          <p>Applications configured to start at sign-in.</p>
        </div>
        <div className="search-bar">
          <Icon path={icons.search} size={14} />
          <input
            type="search"
            placeholder="Search startup apps..."
            value={startupQuery}
            onChange={(e) => setStartupQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="panel-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Command</th>
                <th>Source</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredStartupApps.map((s) => (
                <tr key={s.id}>
                  <td>
                    <strong>{s.name}</strong>
                  </td>
                  <td className="text-faint">{s.command}</td>
                  <td>
                    <span className="badge neutral">{s.source}</span>
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      onClick={() => void requestStartupToggle(s)}
                    >
                      {s.enabled ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderLogs = () => (
    <div className="page-wrapper">
      <div className="page-header">
        <div>
          <h2>Recent Logs</h2>
          <p>System journal entries from this boot.</p>
        </div>
        <div className="flex gap-4">
          <select
            value={systemLogsSeverity}
            onChange={(e) =>
              setSystemLogsSeverity(e.target.value as LogSeverityFilter)
            }
          >
            <option value="all">All</option>
            <option value="errors">Errors</option>
            <option value="warnings">Warnings</option>
          </select>
          <div className="search-bar">
            <Icon path={icons.search} size={14} />
            <input
              type="search"
              placeholder="Search logs..."
              value={systemLogsQuery}
              onChange={(e) => setSystemLogsQuery(e.target.value)}
            />
          </div>
        </div>
      </div>
      <div className="panel-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Source</th>
                <th>Severity</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {filteredSystemLogs.slice(0, 100).map((l, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {formatSystemLogTimestamp(l.timestampMicros)}
                  </td>
                  <td>{l.source}</td>
                  <td>
                    <span
                      className={`badge ${l.severity === "Error" ? "danger" : l.severity === "Warning" ? "warning" : "neutral"}`}
                    >
                      {l.severity}
                    </span>
                  </td>
                  <td>{l.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // --- Main Render ---
  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {renderSidebar()}
      <main className="main-content">
        {renderHeader()}
        <div className="content-container">
          {page === "overview" && renderOverview()}
          {page === "processes" && renderProcesses()}
          {page === "storage" && renderStorage()}
          {page === "network" && renderNetwork()}
          {page === "connections" && renderConnections()}
          {page === "services" && renderServices()}
          {page === "software" && renderSoftware()}
          {page === "settings" && renderSettings()}
          {page === "maintenance" && renderMaintenance()}
          {page === "diagnostics" && renderDiagnostics()}
          {page === "performance" && renderPerformance()}
          {page === "sensors" && renderSensors()}
          {page === "system" && renderSystem()}
          {page === "activity" && renderActivity()}
          {page === "startup" && renderStartup()}
          {page === "logs" && renderLogs()}
        </div>
      </main>

      {/* Command Palette Modal */}
      {isPaletteOpen && (
        <div
          className="palette-overlay"
          onClick={() => setIsPaletteOpen(false)}
        >
          <div className="palette-modal" onClick={(e) => e.stopPropagation()}>
            <div className="palette-search">
              <Icon path={icons.search} size={20} />
              <input
                ref={paletteInputRef}
                type="text"
                placeholder="Search pages, actions, and settings..."
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
                onKeyDown={handlePaletteKeyDown}
              />
              <span className="palette-esc">ESC</span>
            </div>
            <div className="palette-results">
              {filteredCommands.length === 0 ? (
                <div className="palette-empty">No results found.</div>
              ) : (
                filteredCommands.map((cmd, idx) => (
                  <button
                    key={cmd.id}
                    className={`palette-item ${idx === selectedCommandIndex ? "active" : ""}`}
                    onClick={() => {
                      cmd.action();
                      setIsPaletteOpen(false);
                    }}
                    onMouseEnter={() => setSelectedCommandIndex(idx)}
                  >
                    <div className="palette-item-icon">
                      <Icon path={cmd.icon} size={18} />
                    </div>
                    <div className="palette-item-text">
                      <strong>{cmd.label}</strong>
                      <span>{cmd.category}</span>
                    </div>
                    {idx === selectedCommandIndex && (
                      <span className="palette-enter">↵</span>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
