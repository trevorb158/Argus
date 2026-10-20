import { Fragment, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog, save } from "@tauri-apps/plugin-dialog";
import "./App.css";

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

type StartupAppSnapshot = {
  id: string;
  name: string;
  command: string;
  source: string;
  enabled: boolean;
};

type StartupActionStatus = { kind: "success" | "error"; message: string };

type ServiceSnapshot = {
  unit: string;
  description: string;
  scope: "System" | "User";
  activeState: string;
  subState: string;
  startupState: string;
  protected: boolean;
};

type ServiceInventory = { services: ServiceSnapshot[]; warnings: string[] };
type ServiceFilter = "all" | "active" | "failed" | "enabled";
type BatterySnapshot = {
  name: string;
  capacityPercent: number | null;
  status: string | null;
  healthPercent: number | null;
  cycleCount: number | null;
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
};
type DiagnosticsSnapshot = Omit<SystemInfoSnapshot, "hostName" | "batteries"> & {
  cpuUsagePercent: number;
  memoryUsedBytes: number;
};
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
type CacheEntrySnapshot = { name: string; sizeBytes: number; fileCount: number; clearable: boolean };
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
  severity: "Emergency" | "Alert" | "Critical" | "Error" | "Warning" | "Notice" | "Info" | "Debug";
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
type RawProcessSnapshot = Omit<ProcessSnapshot, "diskReadBytesPerSecond" | "diskWriteBytesPerSecond">;

type ProcessActionStatus = { kind: "success" | "error"; message: string };
type TemperatureUnit = "celsius" | "fahrenheit";

type AppPage = "overview" | "processes" | "storage" | "network" | "startup" | "services" | "system" | "diagnostics" | "logs" | "maintenance" | "settings" | "performance" | "sensors";
type ProcessSortKey = "name" | "pid" | "cpu" | "memory" | "read" | "write";
type ProcessSort = { key: ProcessSortKey; direction: "asc" | "desc" };
type ProcessStateFilter = "all" | "running" | "sleeping" | "stopped" | "zombie";
type ProcessViewMode = "list" | "tree";
type ProcessTreeRow = { process: ProcessSnapshot; depth: number; childCount: number };

type HistorySample = {
  timestamp: number;
  cpuPercent: number;
  memoryPercent: number;
};

function formatGiB(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(1);
}

function formatSystemLogTimestamp(timestampMicros: number) {
  if (!timestampMicros) return "Time unavailable";
  const date = new Date(timestampMicros / 1000);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

function formatProcessMemory(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} B`;
}

function formatNetworkRate(bytesPerSecond: number) {
  if (bytesPerSecond >= 1024 ** 2) return `${(bytesPerSecond / 1024 ** 2).toFixed(1)} MiB/s`;
  if (bytesPerSecond >= 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KiB/s`;
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
  const gib = bytes / (1024 ** 3);
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

function readTemperatureUnit(): TemperatureUnit {
  try {
    return localStorage.getItem("kestrel.temperature-unit") === "fahrenheit" ? "fahrenheit" : "celsius";
  } catch {
    return "celsius";
  }
}

function readHistoryWindow(): number {
  try {
    const saved = Number(localStorage.getItem("kestrel.history-window"));
    return [300, 900, 1800].includes(saved) ? saved : 300;
  } catch {
    return 300;
  }
}

function App() {
  const [page, setPage] = useState<AppPage>("overview");
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [temperatures, setTemperatures] = useState<TemperatureSnapshot[]>([]);
  const [temperatureError, setTemperatureError] = useState<string | null>(null);
  const [temperatureLoading, setTemperatureLoading] = useState(false);
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [historyWindow, setHistoryWindow] = useState(readHistoryWindow);
  const [temperatureUnit, setTemperatureUnit] = useState<TemperatureUnit>(readTemperatureUnit);
  const [performanceSnapshot, setPerformanceSnapshot] = useState<PerformanceSnapshot | null>(null);
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
  const [partitionActionPath, setPartitionActionPath] = useState<string | null>(null);
  const [partitionActionStatus, setPartitionActionStatus] = useState<StartupActionStatus | null>(null);
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterfaceSnapshot[]>([]);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkRouteInfo, setNetworkRouteInfo] = useState<NetworkRouteSnapshot | null>(null);
  const [networkRouteLoading, setNetworkRouteLoading] = useState(false);
  const [networkRouteError, setNetworkRouteError] = useState<string | null>(null);
  const [networkRouteRefreshKey, setNetworkRouteRefreshKey] = useState(0);
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
  const [serviceActionUnit, setServiceActionUnit] = useState<string | null>(null);
  const [serviceActionStatus, setServiceActionStatus] = useState<StartupActionStatus | null>(null);
  const [serviceLogTarget, setServiceLogTarget] = useState<ServiceSnapshot | null>(null);
  const [serviceLogs, setServiceLogs] = useState<SystemLogEntry[]>([]);
  const [serviceLogsLoading, setServiceLogsLoading] = useState(false);
  const [serviceLogsError, setServiceLogsError] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfoSnapshot | null>(null);
  const [systemInfoError, setSystemInfoError] = useState<string | null>(null);
  const [systemInfoLoading, setSystemInfoLoading] = useState(false);
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] = useState<DiagnosticsSnapshot | null>(null);
  const [diagnosticsReport, setDiagnosticsReport] = useState("");
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false);
  const [diagnosticsSaving, setDiagnosticsSaving] = useState(false);
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<DiagnosticsStatus | null>(null);
  const [largeFileScan, setLargeFileScan] = useState<LargeFileScanResult | null>(null);
  const [largeFileMinimum, setLargeFileMinimum] = useState(100 * 1024 * 1024);
  const [largeFileLoading, setLargeFileLoading] = useState(false);
  const [largeFileError, setLargeFileError] = useState<string | null>(null);
  const [cacheInventory, setCacheInventory] = useState<CacheInventorySnapshot | null>(null);
  const [cacheLoading, setCacheLoading] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [cacheActionName, setCacheActionName] = useState<string | null>(null);
  const [cacheActionStatus, setCacheActionStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const [logInventory, setLogInventory] = useState<LogInventorySnapshot | null>(null);
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [systemLogs, setSystemLogs] = useState<SystemLogEntry[]>([]);
  const [systemLogsLoading, setSystemLogsLoading] = useState(false);
  const [systemLogsError, setSystemLogsError] = useState<string | null>(null);
  const [systemLogsQuery, setSystemLogsQuery] = useState("");
  const [systemLogsSeverity, setSystemLogsSeverity] = useState<LogSeverityFilter>("all");
  const [systemLogsTimeRange, setSystemLogsTimeRange] = useState<LogTimeRange>("all");
  const [systemLogsRefreshKey, setSystemLogsRefreshKey] = useState(0);
  const [systemLogsExporting, setSystemLogsExporting] = useState(false);
  const [systemLogsStatus, setSystemLogsStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null);
  const previousNetworkCounters = useRef<Record<string, {
    receivedBytes: number;
    transmittedBytes: number;
    sampleTime: number;
  }>>({});
  const [driveQuery, setDriveQuery] = useState("");
  const [processes, setProcesses] = useState<ProcessSnapshot[]>([]);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processQuery, setProcessQuery] = useState("");
  const [processStateFilter, setProcessStateFilter] = useState<ProcessStateFilter>("all");
  const [processViewMode, setProcessViewMode] = useState<ProcessViewMode>("list");
  const [collapsedProcessPids, setCollapsedProcessPids] = useState<number[]>([]);
  const [processSort, setProcessSort] = useState<ProcessSort>({
    key: "cpu",
    direction: "desc",
  });
  const [terminatingPid, setTerminatingPid] = useState<number | null>(null);
  const [selectedProcessPid, setSelectedProcessPid] = useState<number | null>(null);
  const [processActionStatus, setProcessActionStatus] =
    useState<ProcessActionStatus | null>(null);
  const previousProcessIoCounters = useRef<Record<string, { read: number; write: number; time: number }>>({});

  useEffect(() => {
    try {
      localStorage.setItem("kestrel.temperature-unit", temperatureUnit);
      localStorage.setItem("kestrel.history-window", String(historyWindow));
    } catch {
      // Preferences still work for this session if local storage is unavailable.
    }
  }, [temperatureUnit, historyWindow]);

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
                        (snapshot.memoryUsedBytes / snapshot.memoryTotalBytes) * 100,
                      ),
                    )
                  : 0,
            };
            return [...previous, sample].slice(-1800);
          });
        }
      } catch (error) {
        if (active) {
          setTelemetryError(String(error));
        }
      }
    }

    void refreshTelemetry();

    const intervalId = window.setInterval(() => {
      void refreshTelemetry();
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (page !== "overview" && page !== "sensors") return;

    let active = true;
    let timeoutId = 0;
    setTemperatureLoading(true);

    async function refreshTemperatures() {
      try {
        const snapshot = await invoke<TemperatureSnapshot[]>("get_temperatures");
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
        if (active) {
          setStorageError(String(error));
        }
      }
    }

    void refreshStorage();

    const intervalId = window.setInterval(() => {
      void refreshStorage();
    }, 5000);

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
        const snapshot = await invoke<DriveHealthSnapshot[]>("get_drive_health");
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
        const snapshot = await invoke<PerformanceSnapshot>("get_performance_snapshot");
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
    if (page !== "network") return;

    let active = true;
    let timeoutId = 0;
    previousNetworkCounters.current = {};
    setNetworkLoading(true);

    async function refreshNetworkInterfaces() {
      try {
        const snapshot = await invoke<NetworkCountersSnapshot[]>("get_network_interfaces");
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
              downloadBytesPerSecond: previous && network.receivedBytes >= previous.receivedBytes
                ? (network.receivedBytes - previous.receivedBytes) / elapsedSeconds
                : 0,
              uploadBytesPerSecond: previous && network.transmittedBytes >= previous.transmittedBytes
                ? (network.transmittedBytes - previous.transmittedBytes) / elapsedSeconds
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
          timeoutId = window.setTimeout(() => void refreshNetworkInterfaces(), 1000);
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
    return () => { active = false; };
  }, [page, networkRouteRefreshKey]);

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

    return () => { active = false; };
  }, [page, systemLogsRefreshKey]);

  useEffect(() => {
    if (page !== "processes") return;

    let active = true;
    let timeoutId = 0;
    previousProcessIoCounters.current = {};
    setProcessLoading(true);

    async function refreshProcesses() {
      try {
        const rawSnapshot = await invoke<RawProcessSnapshot[]>("get_processes");
        if (active) {
          const sampleTime = performance.now();
          const nextCounters: Record<string, { read: number; write: number; time: number }> = {};
          const snapshot: ProcessSnapshot[] = rawSnapshot.map((process) => {
            const key = `${process.pid}:${process.startTime}`;
            const previous = previousProcessIoCounters.current[key];
            const elapsedSeconds = previous ? Math.max((sampleTime - previous.time) / 1000, 0.001) : 0;
            const diskReadBytesPerSecond = previous && process.diskReadTotalBytes >= previous.read
              ? Math.round((process.diskReadTotalBytes - previous.read) / elapsedSeconds)
              : null;
            const diskWriteBytesPerSecond = previous && process.diskWriteTotalBytes >= previous.write
              ? Math.round((process.diskWriteTotalBytes - previous.write) / elapsedSeconds)
              : null;
            nextCounters[key] = { read: process.diskReadTotalBytes, write: process.diskWriteTotalBytes, time: sampleTime };
            return { ...process, diskReadBytesPerSecond, diskWriteBytesPerSecond };
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

  const memoryPercent =
    telemetry && telemetry.memoryTotalBytes > 0
      ? Math.round(
          (telemetry.memoryUsedBytes / telemetry.memoryTotalBytes) * 100,
        )
      : 0;

  const nonLoopbackInterfaces = networkInterfaces.filter((network) => !network.isLoopback);
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
      value: telemetry ? `${Math.round(telemetry.cpuUsagePercent)}%` : "—",
      detail: telemetry ? "Current total CPU usage" : "Waiting for telemetry",
      icon: "CPU",
    },
    {
      label: "Memory",
      value: telemetry ? `${formatGiB(telemetry.memoryUsedBytes)} GiB` : "—",
      detail: telemetry
        ? `of ${formatGiB(telemetry.memoryTotalBytes)} GiB · ${memoryPercent}% used`
        : "Waiting for telemetry",
      icon: "RAM",
    },
    {
      label: "Temperature",
      value: hottestTemperature
        ? temperatureUnit === "celsius"
          ? `${Math.round(hottestTemperature.temperatureCelsius)}°C`
          : `${Math.round((hottestTemperature.temperatureCelsius * 9) / 5 + 32)}°F`
        : "Unavailable",
      detail: hottestTemperature
        ? `${hottestTemperature.label || "System sensor"} · highest available reading`
        : temperatureError
          ? "Could not read hardware sensors"
          : temperatureLoading
            ? "Checking for sensors"
            : "No readable temperature sensors",
      icon: temperatureUnit === "celsius" ? "°C" : "°F",
    },
  ];

  const visibleHistory = history.slice(-historyWindow);
  const cpuPoints = visibleHistory
    .map((sample, index) => {
      const x = visibleHistory.length > 1 ? (index / (visibleHistory.length - 1)) * 1000 : 1000;
      const y = 190 - (sample.cpuPercent / 100) * 180;
      return `${x},${y}`;
    })
    .join(" ");
  const memoryPoints = visibleHistory
    .map((sample, index) => {
      const x = visibleHistory.length > 1 ? (index / (visibleHistory.length - 1)) * 1000 : 1000;
      const y = 190 - (sample.memoryPercent / 100) * 180;
      return `${x},${y}`;
    })
    .join(" ");
  const latestSample = visibleHistory[visibleHistory.length - 1];
  const historyRangeLabel =
    historyWindow === 300 ? "5 minutes" : historyWindow === 900 ? "15 minutes" : "30 minutes";
  const sampleProgress = Math.min(history.length, historyWindow);

  const filteredDrives = drives
    .filter((drive) => {
      const query = driveQuery.trim().toLocaleLowerCase();
      return (
        !query ||
        drive.name.toLocaleLowerCase().includes(query) ||
        drive.mountPoint.toLocaleLowerCase().includes(query) ||
        drive.fileSystem.toLocaleLowerCase().includes(query)
      );
    })
    .sort((a, b) => a.mountPoint.localeCompare(b.mountPoint));

  const filteredServices = services.filter((service) => {
    const query = serviceQuery.trim().toLocaleLowerCase();
    const matchesQuery = !query ||
      service.unit.toLocaleLowerCase().includes(query) ||
      service.description.toLocaleLowerCase().includes(query) ||
      service.scope.toLocaleLowerCase().includes(query);
    const matchesFilter = serviceFilter === "all" ||
      (serviceFilter === "active" && service.activeState === "active") ||
      (serviceFilter === "failed" && service.activeState === "failed") ||
      (serviceFilter === "enabled" && service.startupState.startsWith("enabled"));
    return matchesQuery && matchesFilter;
  });
  const visibleServices = filteredServices.slice(0, serviceVisibleCount);

  const filteredStartupApps = startupApps.filter((startupApp) => {
    const query = startupQuery.trim().toLocaleLowerCase();
    return (
      !query ||
      startupApp.name.toLocaleLowerCase().includes(query) ||
      startupApp.command.toLocaleLowerCase().includes(query) ||
      startupApp.source.toLocaleLowerCase().includes(query)
    );
  });

  const filteredPartitions = partitions.filter((partition) => {
    const query = driveQuery.trim().toLocaleLowerCase();
    return (
      !query ||
      partition.name.toLocaleLowerCase().includes(query) ||
      partition.path.toLocaleLowerCase().includes(query) ||
      (partition.label ?? "").toLocaleLowerCase().includes(query) ||
      (partition.fileSystem ?? "").toLocaleLowerCase().includes(query)
    );
  });

  const filteredSystemLogs = systemLogs.filter((entry) => {
    const query = systemLogsQuery.trim().toLocaleLowerCase();
    const rangeHours = systemLogsTimeRange === "1h" ? 1 : systemLogsTimeRange === "6h" ? 6 : systemLogsTimeRange === "24h" ? 24 : null;
    const inTimeRange = rangeHours === null || (entry.timestampMicros > 0 && entry.timestampMicros >= Date.now() * 1000 - rangeHours * 60 * 60 * 1_000_000);
    const matchesQuery = !query || entry.message.toLocaleLowerCase().includes(query) || entry.source.toLocaleLowerCase().includes(query);
    const priority = ["Emergency", "Alert", "Critical", "Error"].includes(entry.severity)
      ? "errors"
      : entry.severity === "Warning"
        ? "warnings"
        : entry.severity === "Debug"
          ? "debug"
          : "info";
    return inTimeRange && matchesQuery && (systemLogsSeverity === "all" || priority === systemLogsSeverity);
  });

  const filteredProcesses = processes
    .filter((process) => {
      const query = processQuery.trim().toLocaleLowerCase();
      const matchesSearch =
        !query ||
        process.name.toLocaleLowerCase().includes(query) ||
        String(process.pid).includes(query);
      const status = process.status.toLocaleLowerCase();
      const matchesState =
        processStateFilter === "all" ||
        (processStateFilter === "running" && status === "run") ||
        (processStateFilter === "sleeping" && (status === "sleep" || status === "idle")) ||
        (processStateFilter === "stopped" && status === "stop") ||
        (processStateFilter === "zombie" && status === "zombie");
      return matchesSearch && matchesState;
    })
    .sort((a, b) => {
      let comparison = 0;
      switch (processSort.key) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "pid":
          comparison = a.pid - b.pid;
          break;
        case "cpu":
          comparison = a.cpuUsagePercent - b.cpuUsagePercent;
          break;
        case "memory":
          comparison = a.memoryBytes - b.memoryBytes;
          break;
        case "read":
          comparison = (a.diskReadBytesPerSecond ?? -1) - (b.diskReadBytesPerSecond ?? -1);
          break;
        case "write":
          comparison = (a.diskWriteBytesPerSecond ?? -1) - (b.diskWriteBytesPerSecond ?? -1);
          break;
      }
      return processSort.direction === "asc" ? comparison : -comparison;
    });

  const processTreeRows: ProcessTreeRow[] = [];
  if (processViewMode === "list") {
    filteredProcesses.forEach((process) => processTreeRows.push({ process, depth: 0, childCount: 0 }));
  } else {
    const processByPid = new Map(filteredProcesses.map((process) => [process.pid, process]));
    const childrenByParent = new Map<number, ProcessSnapshot[]>();
    const roots: ProcessSnapshot[] = [];
    for (const process of filteredProcesses) {
      const parent = process.parentPid === null ? undefined : processByPid.get(process.parentPid);
      if (parent && parent.pid !== process.pid) {
        const children = childrenByParent.get(parent.pid) ?? [];
        children.push(process);
        childrenByParent.set(parent.pid, children);
      } else {
        roots.push(process);
      }
    }
    const visited = new Set<number>();
    const hiddenByCollapse = new Set<number>();
    const markDescendantsHidden = (process: ProcessSnapshot) => {
      for (const child of childrenByParent.get(process.pid) ?? []) {
        if (hiddenByCollapse.has(child.pid)) continue;
        hiddenByCollapse.add(child.pid);
        markDescendantsHidden(child);
      }
    };
    const appendProcess = (process: ProcessSnapshot, depth: number) => {
      if (visited.has(process.pid)) return;
      visited.add(process.pid);
      const children = childrenByParent.get(process.pid) ?? [];
      processTreeRows.push({ process, depth, childCount: children.length });
      if (collapsedProcessPids.includes(process.pid)) {
        markDescendantsHidden(process);
      } else {
        children.forEach((child) => appendProcess(child, depth + 1));
      }
    };
    roots.forEach((process) => appendProcess(process, 0));
    filteredProcesses.forEach((process) => {
      if (!visited.has(process.pid) && !hiddenByCollapse.has(process.pid)) appendProcess(process, 0);
    });
  }

  function toggleProcessCollapsed(pid: number) {
    setCollapsedProcessPids((current) =>
      current.includes(pid) ? current.filter((value) => value !== pid) : [...current, pid],
    );
  }

  function sortProcesses(key: ProcessSortKey) {
    setProcessSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  }

  async function requestPartitionMount(partition: PartitionSnapshot, mount: boolean) {
    if (partition.deviceType !== "part" || partitionActionPath) return;
    if (!mount) {
      const mountPoints = partition.mountPoints.filter((point) => point !== "[SWAP]");
      const confirmed = window.confirm(
        `Unmount ${partition.path}?\n\nFiles and apps using ${mountPoints.join(", ") || "this volume"} may become unavailable. Kestrel will use Linux’s normal unmount process and will not force it.`,
      );
      if (!confirmed) return;
    }

    setPartitionActionPath(partition.path);
    setPartitionActionStatus(null);
    try {
      const result = await invoke<string>("set_partition_mounted", { path: partition.path, mount });
      setPartitionActionStatus({
        kind: "success",
        message: result || `${partition.path} ${mount ? "mounted" : "unmounted"} successfully.`,
      });
      setPartitionRefreshKey((current) => current + 1);
    } catch (error) {
      setPartitionActionStatus({ kind: "error", message: String(error) });
    } finally {
      setPartitionActionPath(null);
    }
  }

  async function requestStartupToggle(startupApp: StartupAppSnapshot) {
    if (startupApp.source !== "User" || !startupApp.command.trim()) return;
    const enabled = !startupApp.enabled;
    const action = enabled ? "enable" : "disable";
    const confirmed = window.confirm(
      `${enabled ? "Enable" : "Disable"} ${startupApp.name} at sign-in?\n\nThis changes only your account’s startup entry. It takes effect the next time you sign in and will not start or close the app now.`,
    );
    if (!confirmed) return;

    setStartupActionId(startupApp.id);
    setStartupActionStatus(null);
    try {
      const updated = await invoke<StartupAppSnapshot>("set_startup_enabled", {
        id: startupApp.id,
        enabled,
        expectedEnabled: startupApp.enabled,
      });
      setStartupApps((current) => current.map((entry) => entry.id === updated.id ? updated : entry));
      setStartupActionStatus({
        kind: "success",
        message: `${startupApp.name} will ${action} at your next sign-in.`,
      });
    } catch (error) {
      setStartupActionStatus({
        kind: "error",
        message: `Could not ${action} ${startupApp.name}: ${String(error)}`,
      });
    } finally {
      setStartupActionId(null);
    }
  }

  async function requestProcessEnd(process: ProcessSnapshot) {
    const name = process.name || "Unnamed process";
    const confirmed = window.confirm(
      `End ${name} (PID ${process.pid})?\n\nKestrel will request normal termination. Unsaved work in this process may be lost.`,
    );
    if (!confirmed) return;

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
        message: `Termination requested for ${name} (PID ${process.pid}). It may take a moment to exit.`,
      });
    } catch (error) {
      setProcessActionStatus({
        kind: "error",
        message: `Could not end ${name} (PID ${process.pid}): ${String(error)}`,
      });
    } finally {
      setTerminatingPid(null);
    }
  }

  async function requestProcessForceStop(process: ProcessSnapshot) {
    if (terminatingPid !== null) return;
    const name = process.name || "Unnamed process";
    const confirmed = window.confirm(
      `Force stop ${name} (PID ${process.pid})?\n\nThis sends an immediate kill signal. The app cannot save work or clean up, and unsaved data may be lost. Use this only if normal End did not work.`,
    );
    if (!confirmed) return;

    setTerminatingPid(process.pid);
    setProcessActionStatus(null);
    try {
      await invoke("force_stop_process", {
        pid: process.pid,
        expectedName: process.name,
        expectedStartTime: process.startTime,
      });
      setProcessActionStatus({ kind: "success", message: `Force-stop signal sent to ${name} (PID ${process.pid}).` });
    } catch (error) {
      setProcessActionStatus({ kind: "error", message: `Could not force stop ${name} (PID ${process.pid}): ${String(error)}` });
    } finally {
      setTerminatingPid(null);
    }
  }

  async function requestServiceAction(service: ServiceSnapshot, action: "start" | "stop" | "enable" | "disable") {
    if (serviceActionUnit !== null) return;
    const actionLabel = action.charAt(0).toUpperCase() + action.slice(1);
    const scopeDescription = service.scope === "System" ? "system-wide" : "user session";
    const detail = action === "stop"
      ? "This may interrupt apps or system functions that depend on it."
      : action === "disable"
        ? `This prevents it from starting automatically in your ${scopeDescription}. It will not stop a running instance.`
        : action === "enable"
          ? `This allows it to start automatically in your ${scopeDescription}.`
          : `This starts it in your ${scopeDescription} now.`;
    const authorization = service.scope === "System" ? " Linux may ask for administrator authorization." : "";
    if (!window.confirm(`${actionLabel} ${service.scope === "System" ? "system" : "user"} service ${service.unit}?\n\n${detail}${authorization}`)) return;

    setServiceActionUnit(service.unit);
    setServiceActionStatus(null);
    try {
      await invoke("set_service_state", { scope: service.scope, unit: service.unit, action });
      setServiceActionStatus({ kind: "success", message: `${service.unit}: ${actionLabel.toLowerCase()} request completed.` });
      setServiceRefreshKey((key) => key + 1);
    } catch (error) {
      setServiceActionStatus({ kind: "error", message: `Could not ${action} ${service.unit}: ${String(error)}` });
    } finally {
      setServiceActionUnit(null);
    }
  }

  async function showServiceLogs(service: ServiceSnapshot) {
    setServiceLogTarget(service);
    setServiceLogs([]);
    setServiceLogsError(null);
    setServiceLogsLoading(true);
    try {
      const entries = await invoke<SystemLogEntry[]>("get_service_logs", { scope: service.scope, unit: service.unit });
      setServiceLogs(entries);
    } catch (error) {
      setServiceLogsError(String(error));
    } finally {
      setServiceLogsLoading(false);
    }
  }

  const statusText = telemetryError
    ? "Telemetry unavailable"
    : telemetry
      ? "Telemetry active"
      : "Preparing telemetry";

  const statusClass =
    telemetry && !telemetryError ? "status-dot" : "status-dot muted";

  async function buildDiagnosticsReport() {
    setDiagnosticsLoading(true);
    setDiagnosticsStatus(null);
    try {
      const snapshot = await invoke<DiagnosticsSnapshot>("get_diagnostics_snapshot");
      const lines = [
        "Kestrel diagnostics summary",
        `Generated: ${new Date().toISOString()}`,
        "",
        "System",
        `Operating system: ${snapshot.operatingSystem}`,
        `Kernel: ${snapshot.kernelVersion ?? "Unavailable"}`,
        `Architecture: ${snapshot.architecture}`,
        `Processor: ${snapshot.processor ?? "Unavailable"}`,
        `Logical processors: ${snapshot.logicalProcessors}`,
        `Physical cores: ${snapshot.physicalCores ?? "Unavailable"}`,
        `Desktop environment: ${snapshot.desktopEnvironment ?? "Unavailable"}`,
        `Session type: ${snapshot.sessionType ?? "Unavailable"}`,
        "",
        "Current readings",
        `CPU usage: ${snapshot.cpuUsagePercent.toFixed(1)}%`,
        `Memory in use: ${formatBytes(snapshot.memoryUsedBytes)} of ${formatBytes(snapshot.memoryTotalBytes)}`,
        `System uptime: ${formatUptime(snapshot.uptimeSeconds)}`,
        "",
        "Privacy: This report excludes the device name, account name, IP addresses, process names, and file paths.",
      ].join("\n");
      setDiagnosticsSnapshot(snapshot);
      setDiagnosticsReport(lines);
      setDiagnosticsStatus({ kind: "success", message: "Report ready to review. Nothing has been saved yet." });
    } catch (error) {
      setDiagnosticsStatus({ kind: "error", message: `Could not collect diagnostics: ${String(error)}` });
    } finally {
      setDiagnosticsLoading(false);
    }
  }

  async function saveDiagnosticsReport() {
    if (!diagnosticsReport) return;
    setDiagnosticsSaving(true);
    setDiagnosticsStatus(null);
    try {
      const path = await save({
        title: "Save Kestrel diagnostics report",
        defaultPath: "kestrel-diagnostics.txt",
        filters: [{ name: "Text report", extensions: ["txt"] }],
      });
      if (!path) {
        setDiagnosticsStatus({ kind: "success", message: "Save cancelled. The report has not been written." });
        return;
      }
      await invoke("save_text_file", { path, contents: diagnosticsReport });
      setDiagnosticsStatus({ kind: "success", message: "Diagnostics report saved." });
    } catch (error) {
      setDiagnosticsStatus({ kind: "error", message: `Could not save the report: ${String(error)}` });
    } finally {
      setDiagnosticsSaving(false);
    }
  }

  async function exportSystemLogs() {
    if (filteredSystemLogs.length === 0) return;
    setSystemLogsExporting(true);
    setSystemLogsStatus(null);
    try {
      const path = await save({
        title: "Export filtered Kestrel system logs",
        defaultPath: "kestrel-system-logs.txt",
        filters: [{ name: "Text log", extensions: ["txt"] }],
      });
      if (!path) return;
      const lines = [
        "Kestrel recent system logs",
        `Exported: ${new Date().toLocaleString()}`,
        `Entries: ${filteredSystemLogs.length}`,
        "",
        ...filteredSystemLogs.map((entry) => {
          const date = entry.timestampMicros ? new Date(entry.timestampMicros / 1000).toISOString() : "Time unavailable";
          return `[${date}] [${entry.severity}] ${entry.source}: ${entry.message}`;
        }),
      ].join("\n");
      await invoke("save_text_file", { path, contents: lines });
      setSystemLogsStatus({ kind: "success", message: "Filtered log entries saved." });
    } catch (error) {
      setSystemLogsStatus({ kind: "error", message: `Could not export log entries: ${String(error)}` });
    } finally {
      setSystemLogsExporting(false);
    }
  }

  async function inspectLogSizes() {
    setLogLoading(true);
    setLogError(null);
    try {
      setLogInventory(await invoke<LogInventorySnapshot>("get_log_inventory"));
    } catch (error) {
      setLogInventory(null);
      setLogError(String(error));
    } finally {
      setLogLoading(false);
    }
  }

  async function clearCacheEntry(entry: CacheEntrySnapshot) {
    if (!entry.clearable || cacheActionName) return;
    const confirmed = window.confirm(
      `Clear the “${entry.name}” cache folder? This permanently removes its contents (${formatProcessMemory(entry.sizeBytes)} as measured). Close the related app first; it may need to rebuild its cache.`,
    );
    if (!confirmed) return;

    setCacheActionName(entry.name);
    setCacheActionStatus(null);
    try {
      await invoke("clear_cache_entry", { directoryName: entry.name });
      setCacheActionStatus({ kind: "success", message: `Cleared the ${entry.name} cache folder.` });
      await inspectCacheSizes();
    } catch (error) {
      setCacheActionStatus({ kind: "error", message: `Could not clear ${entry.name}: ${String(error)}` });
    } finally {
      setCacheActionName(null);
    }
  }

  async function inspectCacheSizes() {
    setCacheLoading(true);
    setCacheError(null);
    try {
      const inventory = await invoke<CacheInventorySnapshot>("get_cache_inventory");
      setCacheInventory(inventory);
    } catch (error) {
      setCacheError(String(error));
      setCacheInventory(null);
    } finally {
      setCacheLoading(false);
    }
  }

  async function chooseAndScanLargeFiles() {
    setLargeFileError(null);
    try {
      const selected = await openDialog({
        title: "Choose a folder to scan for large files",
        directory: true,
        multiple: false,
      });
      if (typeof selected !== "string") return;
      setLargeFileLoading(true);
      setLargeFileScan(null);
      const result = await invoke<LargeFileScanResult>("scan_large_files", {
        root: selected,
        minimumSizeBytes: largeFileMinimum,
      });
      setLargeFileScan(result);
    } catch (error) {
      setLargeFileError(String(error));
    } finally {
      setLargeFileLoading(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">K</div>
          <div>
            <strong>Kestrel</strong>
            <span>Workstation</span>
          </div>
        </div>

        <div className="nav-label">WORKSPACE</div>
        <nav className="navigation" aria-label="Main navigation">
          <button
            className={`nav-item${page === "overview" ? " active" : ""}`}
            aria-current={page === "overview" ? "page" : undefined}
            onClick={() => setPage("overview")}
          >
            <span>◫</span> Overview
          </button>
          <button
            className={`nav-item${page === "performance" ? " active" : ""}`}
            aria-current={page === "performance" ? "page" : undefined}
            onClick={() => setPage("performance")}
          >
            <span>▥</span> Performance
          </button>
          <button
            className={`nav-item${page === "storage" ? " active" : ""}`}
            aria-current={page === "storage" ? "page" : undefined}
            onClick={() => setPage("storage")}
          >
            <span>▤</span> Storage
          </button>
          <button
            className={`nav-item${page === "network" ? " active" : ""}`}
            aria-current={page === "network" ? "page" : undefined}
            onClick={() => setPage("network")}
          >
            <span>⌁</span> Network
          </button>
          <button
            className={`nav-item${page === "processes" ? " active" : ""}`}
            aria-current={page === "processes" ? "page" : undefined}
            onClick={() => setPage("processes")}
          >
            <span>⌘</span> Processes
          </button>
          <button
            className={`nav-item${page === "startup" ? " active" : ""}`}
            aria-current={page === "startup" ? "page" : undefined}
            onClick={() => setPage("startup")}
          >
            <span>◷</span> Startup
          </button>
          <button
            className={`nav-item${page === "services" ? " active" : ""}`}
            aria-current={page === "services" ? "page" : undefined}
            onClick={() => setPage("services")}
          >
            <span>⚙</span> Services
          </button>
          <button
            className={`nav-item${page === "system" ? " active" : ""}`}
            aria-current={page === "system" ? "page" : undefined}
            onClick={() => setPage("system")}
          >
            <span>ⓘ</span> System
          </button>
          <button
            className={`nav-item${page === "diagnostics" ? " active" : ""}`}
            aria-current={page === "diagnostics" ? "page" : undefined}
            onClick={() => setPage("diagnostics")}
          >
            <span>▤</span> Diagnostics
          </button>
          <button
            className={`nav-item${page === "logs" ? " active" : ""}`}
            aria-current={page === "logs" ? "page" : undefined}
            onClick={() => setPage("logs")}
          >
            <span>≡</span> Recent Logs
          </button>
          <button
            className={`nav-item${page === "maintenance" ? " active" : ""}`}
            aria-current={page === "maintenance" ? "page" : undefined}
            onClick={() => setPage("maintenance")}
          >
            <span>⌕</span> Maintenance
          </button>
          <button
            className={`nav-item${page === "sensors" ? " active" : ""}`}
            aria-current={page === "sensors" ? "page" : undefined}
            onClick={() => setPage("sensors")}
          >
            <span>°</span> Sensors
          </button>
          <button
            className={`nav-item${page === "settings" ? " active" : ""}`}
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => setPage("settings")}
          >
            <span>⚙</span> Settings
          </button>
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          <span>Local session</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            KESTREL <span>/</span> {page.toUpperCase()}
          </div>
          <button className="device-button">
            <span className="status-dot" /> This device <span>⌄</span>
          </button>
        </header>

        <section className="page-heading">
          <div>
            <p className="eyebrow">
              {page === "overview"
                ? "SYSTEM DASHBOARD"
                : page === "processes"
                  ? "RUNNING APPLICATIONS AND SERVICES"
                  : page === "storage"
                    ? "DISKS AND VOLUMES"
                    : page === "network"
                      ? "NETWORK INTERFACES"
                      : page === "startup"
                        ? "LOGIN APPLICATIONS"
                        : page === "services"
                          ? "BACKGROUND SERVICES"
                          : page === "system"
                            ? "DEVICE INFORMATION"
                            : page === "diagnostics"
                              ? "SUPPORT TOOLS"
                              : page === "logs"
                              ? "SYSTEM JOURNAL"
                              : page === "maintenance"
                                ? "STORAGE TOOLS"
                                : page === "settings"
                                  ? "PREFERENCES"
                                  : page === "sensors"
                                    ? "HARDWARE TEMPERATURES"
                                    : "LIVE TELEMETRY"}
            </p>
            <h1>{page === "overview" ? "Overview" : page === "processes" ? "Processes" : page === "storage" ? "Storage" : page === "network" ? "Network" : page === "startup" ? "Startup" : page === "services" ? "Services" : page === "system" ? "System" : page === "diagnostics" ? "Diagnostics" : page === "logs" ? "Recent Logs" : page === "maintenance" ? "Maintenance" : page === "settings" ? "Settings" : page === "sensors" ? "Sensors" : "Performance"}</h1>
            <p className="subheading">
              {page === "overview"
                ? "A clear view of your workstation, at a glance."
                : page === "processes"
                  ? "See which programs are using your system resources."
                  : page === "storage"
                    ? "Review mounted volumes and how their space is being used."
                    : page === "network"
                      ? "See live traffic and addresses for this device’s network interfaces."
                      : page === "startup"
                        ? "Review applications configured to start when you sign in."
                        : page === "services"
                          ? "Review service activity and its configured startup mode."
                          : page === "system"
                            ? "Review operating system, hardware, and desktop session details."
                            : page === "diagnostics"
                            ? "Create a local support summary and review it before saving."
                            : page === "logs"
                              ? "Review recent system messages from this boot. Entries are read-only and stay on this device."
                              : page === "maintenance"
                              ? "Review large files and application cache usage without changing anything."
                              : page === "settings"
                                ? "Choose how Kestrel displays information on this device."
                                : page === "sensors"
                                  ? "Review temperatures reported by the available hardware sensors."
                                  : "Inspect live processor, memory, and swap usage."}
            </p>
          </div>
          <div className="refresh-state">
            <span
              className={
                page === "overview"
                  ? statusClass
                  : page === "processes"
                    ? processError
                      ? "status-dot muted"
                      : "status-dot"
                    : page === "storage"
                      ? storageError || partitionError
                        ? "status-dot muted"
                        : "status-dot"
                      : page === "network"
                        ? networkError
                          ? "status-dot muted"
                          : "status-dot"
                        : page === "startup"
                          ? startupError
                            ? "status-dot muted"
                            : "status-dot"
                          : page === "services"
                            ? serviceError
                              ? "status-dot muted"
                              : "status-dot"
                            : page === "system"
                              ? systemInfoError
                                ? "status-dot muted"
                                : "status-dot"
                              : page === "diagnostics"
                                ? diagnosticsStatus?.kind === "error"
                                  ? "status-dot muted"
                                  : "status-dot"
                                : page === "logs"
                                ? systemLogsError ? "status-dot muted" : "status-dot"
                              : page === "maintenance"
                                  ? largeFileError || cacheError || logError
                                    ? "status-dot muted"
                                    : "status-dot"
                                  : page === "performance"
                                    ? performanceError
                                      ? "status-dot muted"
                                      : "status-dot"
                                    : page === "sensors"
                                      ? temperatureError ? "status-dot muted" : "status-dot"
                                      : "status-dot"
              }
            />
            {page === "overview"
              ? statusText
              : page === "processes"
                ? processError
                  ? "Process list unavailable"
                  : processLoading
                    ? "Reading processes"
                    : `${processes.length} processes`
                : page === "storage"
                  ? storageError || partitionError
                    ? "Storage information unavailable"
                    : `${drives.length} mounted volumes`
                  : page === "network"
                    ? networkError
                      ? "Network information unavailable"
                      : networkLoading
                        ? "Reading interfaces"
                        : `${networkInterfaces.length} interfaces`
                      : page === "startup"
                        ? startupError
                          ? "Startup information unavailable"
                          : startupLoading
                            ? "Reading startup entries"
                            : `${startupApps.filter((startupApp) => startupApp.enabled).length} enabled entries`
                        : page === "services"
                          ? serviceError
                            ? "Service information unavailable"
                            : serviceLoading
                              ? "Reading services"
                              : `${services.length} services`
                          : page === "system"
                            ? systemInfoError
                              ? "System information unavailable"
                              : systemInfoLoading
                                ? "Reading device information"
                                : systemInfo?.operatingSystem ?? "System information unavailable"
                            : page === "diagnostics"
                              ? diagnosticsStatus?.message ?? (diagnosticsLoading ? "Collecting local details" : diagnosticsSnapshot ? "Report ready for review" : "No report collected")
                              : page === "logs"
                                ? systemLogsError ? "System journal unavailable" : systemLogsLoading ? "Reading system journal" : `${systemLogs.length} recent entries`
                              : page === "maintenance"
                                ? largeFileError || cacheError || logError ? "Maintenance scan unavailable" : largeFileLoading || cacheLoading || logLoading ? "Scanning local files" : largeFileScan ? (largeFileScan.files.length + " large files found") : cacheInventory ? (formatProcessMemory(cacheInventory.totalBytes) + " in caches") : logInventory ? "Log sizes inspected" : "No folder scanned"
                                : page === "settings"
                                  ? "Preferences saved locally"
                                  : page === "sensors"
                                    ? temperatureError ? "Sensors unavailable" : temperatureLoading ? "Reading sensors" : `${temperatures.length} sensors`
                                  : performanceError
                                    ? "Performance information unavailable"
                                    : performanceSnapshot
                                    ? performanceSnapshot.cores.length + " logical processors"
                                    : performanceLoading
                                      ? "Reading performance"
                                      : "Performance data unavailable"}
          </div>
        </section>

        {page === "overview" ? (
          <>
        <section className="metric-grid" aria-label="System metrics">
          {metrics.map((metric) => (
            <article className="metric-card" key={metric.label}>
              <div className="metric-top">
                <span className="metric-icon">{metric.icon}</span>
                <span className="metric-menu">•••</span>
              </div>
              <p className="metric-label">{metric.label}</p>
              <div className="metric-value">{metric.value}</div>
              <p className="metric-detail">{metric.detail}</p>
            </article>
          ))}
        </section>

        <section className="content-grid">
          <article className="panel activity-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">PERFORMANCE</p>
                <h2>System activity</h2>
              </div>
              <label className="range-control">
                <span className="sr-only">Chart time range</span>
                <select
                  className="period-select"
                  value={historyWindow}
                  onChange={(event) => setHistoryWindow(Number(event.target.value))}
                >
                  <option value={300}>Last 5 minutes</option>
                  <option value={900}>Last 15 minutes</option>
                  <option value={1800}>Last 30 minutes</option>
                </select>
              </label>
            </div>
            <div className="activity-chart">
              <div className="chart-y-labels" aria-hidden="true">
                <span>100%</span>
                <span>50%</span>
                <span>0%</span>
              </div>
              <div className="chart-plot">
                <div className="chart-grid-lines" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                {visibleHistory.length > 1 ? (
                  <svg
                    className="chart-svg"
                    viewBox="0 0 1000 200"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`CPU ${Math.round(latestSample?.cpuPercent ?? 0)} percent; memory ${Math.round(latestSample?.memoryPercent ?? 0)} percent over the last ${historyRangeLabel}`}
                  >
                    <polyline className="chart-line cpu-line" points={cpuPoints} />
                    <polyline className="chart-line memory-line" points={memoryPoints} />
                  </svg>
                ) : latestSample ? (
                  <div
                    className="chart-waiting"
                    role="status"
                  >
                    Collecting the next sample to draw the chart…
                  </div>
                ) : (
                  <div className="chart-waiting" role="status">
                    Waiting for the first sample…
                  </div>
                )}
              </div>
            </div>
            <div className="chart-footer">
              <div className="chart-legend">
                <span className="legend-cpu" /> CPU usage
                <span className="legend-memory" /> Memory usage
              </div>
              <span className="chart-sample-count">
                {latestSample
                  ? `${sampleProgress} ${sampleProgress === 1 ? "sample" : "samples"} · ${historyRangeLabel}`
                  : "Samples are collected once per second"}
              </span>
            </div>
          </article>

          <article className="panel storage-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">DISKS & VOLUMES</p>
                <h2>Storage</h2>
              </div>
              <button className="icon-button" aria-label="Storage options">
                •••
              </button>
            </div>

            {storageError ? (
              <p className="metric-detail">
                Could not load storage: {storageError}
              </p>
            ) : drives.length === 0 ? (
              <p className="metric-detail">Looking for mounted drives…</p>
            ) : (
              <div className="drive-list">
                {drives.map((drive) => {
                  const usedBytes = Math.max(
                    0,
                    drive.totalBytes - drive.availableBytes,
                  );
                  const usedPercent =
                    drive.totalBytes > 0
                      ? Math.min(
                          100,
                          Math.round((usedBytes / drive.totalBytes) * 100),
                        )
                      : 0;
                  const driveName =
                    drive.name.trim() || drive.mountPoint || "Storage volume";

                  return (
                    <div className="drive-entry" key={drive.mountPoint}>
                      <div className="drive-row">
                        <div className="drive-icon">▰</div>
                        <div className="drive-info">
                          <strong>{driveName}</strong>
                          <span>
                            {drive.mountPoint}
                            {drive.fileSystem ? ` · ${drive.fileSystem}` : ""}
                          </span>
                        </div>
                        <span className="drive-state">{usedPercent}% used</span>
                      </div>

                      <div
                        className="drive-track"
                        aria-label={`${usedPercent}% of ${driveName} used`}
                      >
                        <span
                          className="drive-fill"
                          style={{ width: `${usedPercent}%` }}
                        />
                      </div>

                      <p className="drive-capacity">
                        {formatGiB(usedBytes)} GiB used of{" "}
                        {formatGiB(drive.totalBytes)} GiB
                        {" · "}
                        {formatGiB(drive.availableBytes)} GiB free
                        {drive.isRemovable ? " · Removable" : ""}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}

            <p className="metric-detail storage-refresh-note">
              Drive information refreshes every 5 seconds.
            </p>
          </article>
        </section>

        <footer className="bottom-note">
          <span className="note-icon">i</span>
          {telemetryError
            ? `Telemetry error: ${telemetryError}`
            : telemetry
              ? "CPU and memory are updating from this device."
              : "Connecting to the local telemetry service..."}
        </footer>
          </>
        ) : page === "processes" ? (
          <section className="process-page" aria-labelledby="process-list-title">
            <div className="process-toolbar">
              <div>
                <h2 id="process-list-title">Process list</h2>
                <p>{filteredProcesses.length} of {processes.length} processes · refreshed every 2.5 seconds</p>
              </div>
              <div className="process-toolbar-controls">
                <div className="process-view-switch" role="group" aria-label="Process list view">
                  <button
                    className={processViewMode === "list" ? "active" : ""}
                    aria-pressed={processViewMode === "list"}
                    onClick={() => setProcessViewMode("list")}
                  >List</button>
                  <button
                    className={processViewMode === "tree" ? "active" : ""}
                    aria-pressed={processViewMode === "tree"}
                    onClick={() => setProcessViewMode("tree")}
                  >Tree</button>
                </div>
                <label className="process-filter-label">
                  <span className="sr-only">Filter processes by state</span>
                  <select
                    className="process-filter"
                    value={processStateFilter}
                    onChange={(event) => setProcessStateFilter(event.target.value as ProcessStateFilter)}
                  >
                    <option value="all">All states</option>
                    <option value="running">Running</option>
                    <option value="sleeping">Sleeping / idle</option>
                    <option value="stopped">Stopped</option>
                    <option value="zombie">Zombie</option>
                  </select>
                </label>
              <label className="process-search">
                <span className="sr-only">Search by process name or PID</span>
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={processQuery}
                  onChange={(event) => setProcessQuery(event.target.value)}
                  placeholder="Search processes…"
                />
              </label>
              </div>
            </div>

            {processActionStatus && (
              <div
                className={`process-action-message ${processActionStatus.kind}`}
                role={processActionStatus.kind === "error" ? "alert" : "status"}
              >
                {processActionStatus.message}
              </div>
            )}

            {processError ? (
              <div className="process-message" role="alert">
                Could not read the process list: {processError}
              </div>
            ) : processLoading && processes.length === 0 ? (
              <div className="process-message" role="status">
                Reading running processes…
              </div>
            ) : filteredProcesses.length === 0 ? (
              <div className="process-message" role="status">
                {processQuery || processStateFilter !== "all" ? "No processes match these filters." : "No processes were found."}
              </div>
            ) : (
              <div className="process-table-wrap">
                <table className="process-table">
                  <thead>
                    <tr>
                      <th aria-sort={processSort.key === "name" ? `${processSort.direction}ending` : "none"}>
                        <button onClick={() => sortProcesses("name")}>Name <span>↕</span></button>
                      </th>
                      <th aria-sort={processSort.key === "pid" ? `${processSort.direction}ending` : "none"}>
                        <button onClick={() => sortProcesses("pid")}>PID <span>↕</span></button>
                      </th>
                      <th aria-sort={processSort.key === "cpu" ? `${processSort.direction}ending` : "none"}>
                        <button onClick={() => sortProcesses("cpu")}>CPU <span>↕</span></button>
                      </th>
                      <th aria-sort={processSort.key === "memory" ? `${processSort.direction}ending` : "none"}>
                        <button onClick={() => sortProcesses("memory")}>Memory / RAM <span>↕</span></button>
                      </th>
                      <th aria-sort={processSort.key === "read" ? `${processSort.direction}ending` : "none"}>
                        <button onClick={() => sortProcesses("read")}>Disk read <span>↕</span></button>
                      </th>
                      <th aria-sort={processSort.key === "write" ? `${processSort.direction}ending` : "none"}>
                        <button onClick={() => sortProcesses("write")}>Disk write <span>↕</span></button>
                      </th>
                      <th className="process-action-heading">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processTreeRows.map(({ process, depth, childCount }) => (
                      <Fragment key={process.pid}>
                      <tr>
                        <td className="process-name" title={process.name || "Unnamed process"}>
                          <span className="process-name-content" style={{ paddingLeft: processViewMode === "tree" ? `${Math.min(depth, 12) * 16}px` : undefined }}>
                            {processViewMode === "tree" && childCount > 0 ? (
                              <button
                                className="process-tree-toggle"
                                onClick={() => toggleProcessCollapsed(process.pid)}
                                aria-expanded={!collapsedProcessPids.includes(process.pid)}
                                aria-label={`${collapsedProcessPids.includes(process.pid) ? "Expand" : "Collapse"} ${process.name}, ${childCount} child processes`}
                              >
                                {collapsedProcessPids.includes(process.pid) ? "▸" : "▾"}
                              </button>
                            ) : processViewMode === "tree" ? <span className="process-tree-spacer" /> : null}
                            <span>{process.name || "Unnamed process"}</span>
                          </span>
                        </td>
                        <td className="process-number">{process.pid}</td>
                        <td className="process-number process-cpu-cell">
                          <strong>{process.cpuUsagePercent.toFixed(1)}%</strong>
                          <span className="process-cpu-meter" aria-label={`${process.cpuUsagePercent.toFixed(1)} percent CPU`}>
                            <span style={{ width: `${Math.max(0, Math.min(100, process.cpuUsagePercent))}%` }} />
                          </span>
                        </td>
                        <td className="process-number process-memory-cell">
                          <strong>{formatProcessMemory(process.memoryBytes)}</strong>
                          <small>
                            {telemetry && telemetry.memoryTotalBytes > 0
                              ? `${(process.memoryBytes / telemetry.memoryTotalBytes * 100).toFixed(1)}% of RAM`
                              : "RAM share unavailable"}
                          </small>
                        </td>
                        <td className="process-number process-io-cell">
                          {process.diskReadBytesPerSecond === null
                            ? process.diskReadTotalBytes > 0 ? "Measuring…" : "—"
                            : formatNetworkRate(process.diskReadBytesPerSecond)}
                        </td>
                        <td className="process-number process-io-cell">
                          {process.diskWriteBytesPerSecond === null
                            ? process.diskWriteTotalBytes > 0 ? "Measuring…" : "—"
                            : formatNetworkRate(process.diskWriteBytesPerSecond)}
                        </td>
                        <td className="process-action-cell">
                          <div className="process-row-actions">
                          <button
                            className="process-details-button"
                            onClick={() => setSelectedProcessPid(
                              selectedProcessPid === process.pid ? null : process.pid,
                            )}
                            aria-expanded={selectedProcessPid === process.pid}
                            aria-controls={`process-details-${process.pid}`}
                          >
                            {selectedProcessPid === process.pid ? "Hide" : "Details"}
                          </button>
                          <button
                            className="process-end-button"
                            onClick={() => void requestProcessEnd(process)}
                            disabled={terminatingPid !== null}
                            aria-label={`End ${process.name || "unnamed process"}, PID ${process.pid}`}
                          >
                            {terminatingPid === process.pid ? "Sending…" : "End"}
                          </button>
                          <button
                            className="process-force-button"
                            onClick={() => void requestProcessForceStop(process)}
                            disabled={terminatingPid !== null}
                            aria-label={`Force stop ${process.name || "unnamed process"}, PID ${process.pid}`}
                          >
                            {terminatingPid === process.pid ? "Sending…" : "Force stop"}
                          </button>
                          </div>
                        </td>
                      </tr>
                      {selectedProcessPid === process.pid && (
                        <tr id={`process-details-${process.pid}`} className="process-details-row">
                          <td className="process-details-cell" colSpan={7}>
                            <dl className="process-details">
                              <div><dt>State</dt><dd>{process.status}</dd></div>
                              <div><dt>Parent PID</dt><dd>{process.parentPid ?? "Unavailable"}</dd></div>
                              <div><dt>Running for</dt><dd>{formatProcessRuntime(process.runTimeSeconds)}</dd></div>
                              <div><dt>Total disk read</dt><dd>{process.diskReadTotalBytes > 0 ? formatProcessMemory(process.diskReadTotalBytes) : "Not reported"}</dd></div>
                              <div><dt>Total disk write</dt><dd>{process.diskWriteTotalBytes > 0 ? formatProcessMemory(process.diskWriteTotalBytes) : "Not reported"}</dd></div>
                            </dl>
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="process-footnote">
              Per-process disk rates compare successive Linux I/O counters; protected processes may not report them. Ending a process requests normal termination. Unsaved work may be lost, and protected system processes may reject the request. Force stop sends an immediate kill signal after a separate confirmation, so unsaved work may be lost.
            </p>
          </section>
        ) : page === "storage" ? (
          <section className="storage-page" aria-labelledby="storage-page-title">
            <div className="storage-page-toolbar">
              <div>
                <h2 id="storage-page-title">Mounted volumes</h2>
                <p>{filteredDrives.length} of {drives.length} volumes · refreshes every 5 seconds</p>
              </div>
              <label className="volume-search">
                <span className="sr-only">Search volumes</span>
                <span aria-hidden="true">⌕</span>
                <input
                  type="search"
                  value={driveQuery}
                  onChange={(event) => setDriveQuery(event.target.value)}
                  placeholder="Search name, mount point, or filesystem…"
                />
              </label>
            </div>

            {storageError ? (
              <div className="storage-message" role="alert">
                Could not read mounted volumes: {storageError}
              </div>
            ) : drives.length === 0 ? (
              <div className="storage-message" role="status">
                Looking for mounted volumes…
              </div>
            ) : filteredDrives.length === 0 ? (
              <div className="storage-message" role="status">
                No mounted volumes match your search.
              </div>
            ) : (
              <div className="volume-grid">
                {filteredDrives.map((drive) => {
                  const usedBytes = Math.max(0, drive.totalBytes - drive.availableBytes);
                  const usedPercent =
                    drive.totalBytes > 0
                      ? Math.min(100, Math.round((usedBytes / drive.totalBytes) * 100))
                      : 0;
                  const driveName = drive.name.trim() || drive.mountPoint || "Storage volume";

                  return (
                    <article className="volume-card" key={drive.mountPoint}>
                      <div className="volume-card-heading">
                        <div className="drive-icon">▰</div>
                        <div className="volume-name">
                          <h3>{driveName}</h3>
                          <p>{drive.mountPoint}</p>
                        </div>
                        <span className="volume-state">
                          {drive.mountPoint === "/" ? "System" : drive.isRemovable ? "Removable" : "Mounted"}
                        </span>
                      </div>
                      <div className="volume-details">
                        <span>{drive.fileSystem || "Filesystem unknown"}</span>
                        {drive.isRemovable && <span>Removable device</span>}
                      </div>
                      <div className="volume-usage-labels">
                        <span>Space used</span>
                        <strong>{usedPercent}%</strong>
                      </div>
                      <div
                        className="drive-track volume-track"
                        role="progressbar"
                        aria-label={`Space used on ${drive.mountPoint}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={usedPercent}
                      >
                        <span className="drive-fill" style={{ width: `${usedPercent}%` }} />
                      </div>
                      <div className="volume-capacity-grid">
                        <div><span>Used</span><strong>{formatGiB(usedBytes)} GiB</strong></div>
                        <div><span>Free</span><strong>{formatGiB(drive.availableBytes)} GiB</strong></div>
                        <div><span>Total</span><strong>{formatGiB(drive.totalBytes)} GiB</strong></div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            <section className="drive-health-section" aria-labelledby="drive-health-title">
              <div className="drive-health-heading">
                <div>
                  <h2 id="drive-health-title">Physical drive health</h2>
                  <p>{driveHealthLoading && driveHealth.length === 0 ? "Reading UDisks health data…" : `${driveHealth.length} physical drives · refreshes every minute`}</p>
                </div>
                <button className="startup-refresh-button" type="button" disabled={driveHealthLoading} onClick={() => setDriveHealthRefreshKey((key) => key + 1)}>
                  {driveHealthLoading ? "Reading…" : "Refresh health"}
                </button>
              </div>
              {driveHealthError ? (
                <div className="storage-message compact" role="alert">Could not read drive health: {driveHealthError}</div>
              ) : driveHealthLoading && driveHealth.length === 0 ? (
                <div className="storage-message compact" role="status">Reading cached drive health information…</div>
              ) : driveHealth.length === 0 ? (
                <div className="storage-message compact" role="status">No physical drives with UDisks health information were reported.</div>
              ) : (
                <div className="drive-health-grid">
                  {driveHealth.map((drive) => {
                    const statusLabel = drive.healthState === "healthy" ? "SMART healthy"
                      : drive.healthState === "warning" ? "SMART warning"
                        : drive.healthState === "unsupported" ? "SMART not supported" : "Status unavailable";
                    const temperature = drive.temperatureCelsius === null ? null
                      : temperatureUnit === "celsius" ? drive.temperatureCelsius
                        : drive.temperatureCelsius * 9 / 5 + 32;
                    return (
                      <article className="drive-health-card" key={drive.path}>
                        <div className="drive-health-card-heading">
                          <div>
                            <h3>{drive.model}</h3>
                            <p>{drive.path}</p>
                          </div>
                          <span className={`drive-health-status ${drive.healthState}`}>{statusLabel}</span>
                        </div>
                        <div className="drive-health-metrics">
                          <div><span>Temperature</span><strong>{temperature === null ? "Not reported" : `${temperature.toFixed(0)}°${temperatureUnit === "celsius" ? "C" : "F"}`}</strong></div>
                          <div><span>Power-on time</span><strong>{drive.powerOnHours === null ? "Not reported" : `${drive.powerOnHours.toLocaleString()} h`}</strong></div>
                          <div><span>Bad sectors</span><strong>{drive.badSectors === null ? "Not reported" : drive.badSectors.toLocaleString()}</strong></div>
                          <div><span>Failing attributes</span><strong>{drive.attributesFailing === null ? "Not reported" : drive.attributesFailing.toLocaleString()}</strong></div>
                        </div>
                        <p className="drive-health-updated">{drive.smartUpdatedUnixSeconds ? `SMART data last updated ${new Date(drive.smartUpdatedUnixSeconds * 1000).toLocaleString()}` : "UDisks has no recent SMART update for this drive."}</p>
                      </article>
                    );
                  })}
                </div>
              )}
              <p className="storage-footnote">Health information is read from UDisks’ cached SMART data. Some drives expose only limited metrics; this is a warning indicator, not a guarantee against failure. Kestrel does not run self-tests or change drive settings.</p>
            </section>
            <section className="partition-inventory" aria-labelledby="partition-inventory-title">
              <div className="partition-inventory-heading">
                <div>
                  <h2 id="partition-inventory-title">Detected partitions</h2>
                  <p>{partitionLoading && partitions.length === 0 ? "Scanning block devices…" : `${filteredPartitions.length} of ${partitions.length} entries · refreshes every 15 seconds`}</p>
                </div>
              </div>

              {partitionActionStatus && (
                <div className={`storage-message compact ${partitionActionStatus.kind}`} role={partitionActionStatus.kind === "error" ? "alert" : "status"}>
                  {partitionActionStatus.message}
                </div>
              )}

              {partitionError ? (
                <div className="storage-message compact" role="alert">
                  Could not read the partition inventory: {partitionError}
                </div>
              ) : partitionLoading && partitions.length === 0 ? (
                <div className="storage-message compact" role="status">Reading Linux block-device information…</div>
              ) : filteredPartitions.length === 0 ? (
                <div className="storage-message compact" role="status">
                  {partitions.length === 0 ? "No partitions were reported by Linux." : "No partitions match your search."}
                </div>
              ) : (
                <div className="partition-list">
                  {filteredPartitions.map((partition) => {
                    const isMounted = partition.mountPoints.some((point) => point !== "[SWAP]");
                    const isActiveSwap = partition.mountPoints.includes("[SWAP]");
                    const mountSummary = isMounted
                      ? partition.mountPoints.filter((point) => point !== "[SWAP]").join(" · ")
                      : isActiveSwap ? "Active swap" : "Not mounted";
                    return (
                      <article className="partition-row" key={partition.path || partition.name}>
                        <div className="partition-device-icon" aria-hidden="true">▰</div>
                        <div className="partition-main">
                          <h3>{partition.path || partition.name}</h3>
                          <p>{partition.label || "No label"} · {partition.fileSystem || "Filesystem not reported"}</p>
                        </div>
                        <div className="partition-capacity">
                          <strong>{formatGiB(partition.sizeBytes)} GiB</strong>
                          <span>{partition.isRemovable ? "Removable" : partition.deviceType === "part" ? "Partition" : "Disk volume"}</span>
                        </div>
                        <div className={`partition-mount-state${isMounted || isActiveSwap ? " mounted" : ""}`}>
                          <span className="partition-state-dot" />
                          <span>{mountSummary}</span>
                        </div>
                        {partition.deviceType === "part" && !isActiveSwap ? (
                          <button
                            className="partition-action-button"
                            type="button"
                            disabled={partitionActionPath !== null}
                            onClick={() => void requestPartitionMount(partition, !isMounted)}
                          >
                            {partitionActionPath === partition.path ? "Working…" : isMounted ? "Unmount" : "Mount"}
                          </button>
                        ) : <span className="partition-action-unavailable">{isActiveSwap ? "In use as swap" : ""}</span>}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
            <p className="storage-footnote">
              Mount and unmount use Linux’s UDisks authorization. Unmounting requires confirmation; active swap and system-critical mounts are protected. Filesystem repair is not performed here.
            </p>
          </section>
        ) : page === "network" ? (
          <section className="network-page" aria-labelledby="network-page-title">
            <div className="network-toolbar">
              <div>
                <h2 id="network-page-title">Live network activity</h2>
                <p>{networkLoading && networkInterfaces.length === 0 ? "Reading interface counters…" : `${networkInterfaces.length} interfaces · refreshes every second`}</p>
              </div>
            </div>

            {networkError ? (
              <div className="storage-message" role="alert">Could not read network interfaces: {networkError}</div>
            ) : networkLoading && networkInterfaces.length === 0 ? (
              <div className="storage-message" role="status">Reading local network information…</div>
            ) : networkInterfaces.length === 0 ? (
              <div className="storage-message" role="status">Linux did not report any network interfaces.</div>
            ) : (
              <>
                <div className="network-rate-grid">
                  <article className="network-rate-card download">
                    <span>↓ DOWNLOAD</span>
                    <strong>{formatNetworkRate(totalDownloadRate)}</strong>
                    <small>Combined non-loopback traffic</small>
                  </article>
                  <article className="network-rate-card upload">
                    <span>↑ UPLOAD</span>
                    <strong>{formatNetworkRate(totalUploadRate)}</strong>
                    <small>Combined non-loopback traffic</small>
                  </article>
                </div>
                <section className="network-route-card" aria-labelledby="network-route-title">
                  <div className="network-route-heading">
                    <div>
                      <h3 id="network-route-title">Connection details</h3>
                      <p>Local routing and resolver settings</p>
                    </div>
                    <button className="startup-refresh-button" disabled={networkRouteLoading} onClick={() => setNetworkRouteRefreshKey((key) => key + 1)}>
                      {networkRouteLoading ? "Reading…" : "Refresh"}
                    </button>
                  </div>
                  {networkRouteError ? (
                    <div className="storage-message" role="alert">Could not read connection details: {networkRouteError}</div>
                  ) : networkRouteLoading && !networkRouteInfo ? (
                    <div className="storage-message" role="status">Reading local route and DNS settings…</div>
                  ) : networkRouteInfo ? (
                    <dl className="network-route-details">
                      <div><dt>Local IP addresses</dt><dd>{networkInterfaces.filter((network) => !network.isLoopback).flatMap((network) => network.ipAddresses.map((address) => `${network.name}: ${address}`)).join(" · ") || "Not reported"}</dd></div>
                      <div><dt>Default gateway</dt><dd>{networkRouteInfo.defaultGateway || "Not reported"}</dd></div>
                      <div><dt>Route interface</dt><dd>{networkRouteInfo.defaultInterface || "Not reported"}</dd></div>
                      <div><dt>Configured DNS servers</dt><dd>{networkRouteInfo.dnsServers.length ? networkRouteInfo.dnsServers.join(" · ") : networkRouteInfo.dnsError || "Not reported"}</dd></div>
                    </dl>
                  ) : null}
                  <p className="network-route-note">DNS may show a local resolver address; that resolver can forward requests to upstream servers.</p>
                </section>
                <div className="network-interface-list">
                  {networkInterfaces.map((network) => (
                    <article className="network-interface-card" key={network.name}>
                      <div className="network-interface-heading">
                        <div className="network-interface-icon" aria-hidden="true">⌁</div>
                        <div className="network-interface-title">
                          <h3>{network.name}</h3>
                          <p>{network.isLoopback ? "Loopback interface" : "Network interface"}</p>
                        </div>
                        <span className={`network-interface-badge${network.isLoopback ? " loopback" : ""}`}>
                          {network.isLoopback ? "Local" : "Device"}
                        </span>
                      </div>
                      <div className="network-interface-rates">
                        <div><span>↓ Download</span><strong>{formatNetworkRate(network.downloadBytesPerSecond)}</strong></div>
                        <div><span>↑ Upload</span><strong>{formatNetworkRate(network.uploadBytesPerSecond)}</strong></div>
                      </div>
                      <dl className="network-interface-details">
                        <div><dt>IP addresses</dt><dd>{network.ipAddresses.length ? network.ipAddresses.join(" · ") : "None reported"}</dd></div>
                        <div><dt>MAC address</dt><dd>{network.macAddress || "Unavailable"}</dd></div>
                      </dl>
                    </article>
                  ))}
                </div>
              </>
            )}
            <p className="network-footnote">
              Traffic rates are calculated from local interface counters. Combined rates exclude loopback; virtual interfaces can overlap with physical-interface counters. Kestrel does not inspect websites, connections, or network contents.
            </p>
          </section>
        ) : page === "startup" ? (
          <section className="startup-page" aria-labelledby="startup-page-title">
            <div className="startup-toolbar">
              <div>
                <h2 id="startup-page-title">Applications at sign-in</h2>
                <p>{startupLoading && startupApps.length === 0 ? "Reading startup entries…" : `${filteredStartupApps.length} of ${startupApps.length} entries`}</p>
              </div>
              <div className="startup-toolbar-actions">
                <label className="startup-search">
                  <span className="sr-only">Search startup applications</span>
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    value={startupQuery}
                    onChange={(event) => setStartupQuery(event.target.value)}
                    placeholder="Search name, command, or source…"
                  />
                </label>
                <button
                  className="startup-refresh-button"
                  disabled={startupLoading}
                  onClick={() => setStartupRefreshKey((key) => key + 1)}
                >
                  {startupLoading ? "Reading…" : "Refresh"}
                </button>
              </div>
            </div>

            {startupActionStatus && (
              <div
                className={`process-action-message ${startupActionStatus.kind}`}
                role={startupActionStatus.kind === "error" ? "alert" : "status"}
              >
                {startupActionStatus.message}
              </div>
            )}

            {startupError ? (
              <div className="storage-message" role="alert">Could not read startup applications: {startupError}</div>
            ) : startupLoading && startupApps.length === 0 ? (
              <div className="storage-message" role="status">Reading local login-application entries…</div>
            ) : filteredStartupApps.length === 0 ? (
              <div className="storage-message" role="status">
                {startupApps.length === 0 ? "No startup applications were found." : "No startup applications match your search."}
              </div>
            ) : (
              <div className="startup-list">
                {filteredStartupApps.map((startupApp) => (
                  <article className="startup-entry" key={startupApp.id}>
                    <div className="startup-entry-icon" aria-hidden="true">◷</div>
                    <div className="startup-entry-main">
                      <div className="startup-entry-title">
                        <h3>{startupApp.name}</h3>
                        <span className={`startup-state${startupApp.enabled ? " enabled" : " disabled"}`}>
                          <span className="startup-state-dot" />
                          {startupApp.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </div>
                      <p className="startup-entry-command">{startupApp.command || "Launch command not provided"}</p>
                    </div>
                    <div className="startup-entry-actions">
                      <span className={`startup-source${startupApp.source === "User" ? " user" : ""}`}>
                        {startupApp.source}
                      </span>
                      {startupApp.source === "User" && startupApp.command.trim() ? (
                        <button
                          className="startup-toggle-button"
                          disabled={startupActionId !== null}
                          onClick={() => void requestStartupToggle(startupApp)}
                        >
                          {startupActionId === startupApp.id
                            ? "Saving…"
                            : startupApp.enabled ? "Disable" : "Enable"}
                        </button>
                      ) : (
                        <span className="startup-managed-label">
                          {startupApp.source === "System" ? "System-managed" : "No launch command"}
                        </span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="startup-footnote">
              This list comes from local XDG autostart entries. You can enable or disable user entries with a launch command; system-managed entries stay read-only. Changes apply at the next sign-in. Desktop-session rules can also affect whether an entry runs.
            </p>
          </section>
        ) : page === "services" ? (
          <section className="services-page" aria-labelledby="services-page-title">
            <div className="services-toolbar">
              <div>
                <h2 id="services-page-title">System and user services</h2>
                <p>{serviceLoading && services.length === 0 ? "Reading service managers…" : `${filteredServices.length} of ${services.length} services · available system and user controls`}</p>
              </div>
              <div className="services-toolbar-actions">
                <label className="services-search">
                  <span className="sr-only">Search services</span>
                  <span aria-hidden="true">⌕</span>
                  <input
                    type="search"
                    value={serviceQuery}
                    onChange={(event) => {
                      setServiceQuery(event.target.value);
                      setServiceVisibleCount(60);
                    }}
                    placeholder="Search unit or description…"
                  />
                </label>
                <select
                  className="services-filter"
                  aria-label="Filter services"
                  value={serviceFilter}
                  onChange={(event) => {
                    setServiceFilter(event.target.value as ServiceFilter);
                    setServiceVisibleCount(60);
                  }}
                >
                  <option value="all">All states</option>
                  <option value="active">Active</option>
                  <option value="failed">Failed</option>
                  <option value="enabled">Enabled at boot</option>
                </select>
                <button
                  className="startup-refresh-button"
                  disabled={serviceLoading}
                  onClick={() => setServiceRefreshKey((key) => key + 1)}
                >
                  {serviceLoading ? "Reading…" : "Refresh"}
                </button>
              </div>
            </div>

            {serviceActionStatus && (
              <div className={`service-action-message ${serviceActionStatus.kind}`} role={serviceActionStatus.kind === "error" ? "alert" : "status"}>
                {serviceActionStatus.message}
              </div>
            )}
            {serviceWarnings.length > 0 && (
              <div className="service-warning" role="status">
                {serviceWarnings.join(" ")}
              </div>
            )}
            {serviceError ? (
              <div className="storage-message" role="alert">Could not read services: {serviceError}</div>
            ) : serviceLoading && services.length === 0 ? (
              <div className="storage-message" role="status">Reading local systemd service information…</div>
            ) : filteredServices.length === 0 ? (
              <div className="storage-message" role="status">
                {services.length === 0 ? "No services were reported by the available service managers." : "No services match your search and filter."}
              </div>
            ) : (
              <div className="service-list">
                {visibleServices.map((service) => (
                  <article className="service-entry" key={`${service.scope}:${service.unit}`}>
                    <div className="service-entry-main">
                      <h3>{service.unit}</h3>
                      <p>{service.description}</p>
                      <button className="service-log-button" type="button" onClick={() => void showServiceLogs(service)}>
                        {serviceLogTarget?.scope === service.scope && serviceLogTarget.unit === service.unit ? "Refresh logs" : "View recent logs"}
                      </button>
                    </div>
                    <span className={`service-active-state ${service.activeState}`}>
                      <span className="service-state-dot" />
                      {service.activeState}{service.subState && service.subState !== service.activeState ? ` · ${service.subState}` : ""}
                    </span>
                    <span className="service-startup-state">{service.startupState}</span>
                    <span className={`service-scope${service.scope === "User" ? " user" : ""}`}>{service.scope}</span>
                    {service.protected ? (
                      <span className="service-row-actions read-only">Protected</span>
                    ) : (
                    <div className={`service-row-actions${service.scope === "System" ? " system" : ""}`}>
                        {service.activeState === "active" ? (
                          <button className="service-action-button stop" type="button" disabled={serviceActionUnit !== null} title={service.scope === "System" ? "Linux may ask for administrator authorization" : undefined} onClick={() => void requestServiceAction(service, "stop")}>
                            {serviceActionUnit === service.unit ? "Working…" : "Stop"}
                          </button>
                        ) : ["inactive", "failed"].includes(service.activeState) ? (
                          <button className="service-action-button" type="button" disabled={serviceActionUnit !== null} title={service.scope === "System" ? "Linux may ask for administrator authorization" : undefined} onClick={() => void requestServiceAction(service, "start")}>
                            {serviceActionUnit === service.unit ? "Working…" : "Start"}
                          </button>
                        ) : null}
                        {service.startupState === "enabled" ? (
                          <button className="service-action-button" type="button" disabled={serviceActionUnit !== null} title={service.scope === "System" ? "Linux may ask for administrator authorization" : undefined} onClick={() => void requestServiceAction(service, "disable")}>
                            {serviceActionUnit === service.unit ? "Working…" : "Disable"}
                          </button>
                        ) : service.startupState === "disabled" ? (
                          <button className="service-action-button" type="button" disabled={serviceActionUnit !== null} title={service.scope === "System" ? "Linux may ask for administrator authorization" : undefined} onClick={() => void requestServiceAction(service, "enable")}>
                            {serviceActionUnit === service.unit ? "Working…" : "Enable"}
                          </button>
                        ) : null}
                    </div>
                    )}
                  </article>
                ))}
              </div>
            )}
            {serviceLogTarget && (
              <section className="service-logs-panel" aria-live="polite" aria-labelledby="service-logs-title">
                <div className="service-logs-heading">
                  <div>
                    <h2 id="service-logs-title">Recent logs · {serviceLogTarget.unit}</h2>
                    <p>{serviceLogTarget.scope} service · latest 100 journal entries</p>
                  </div>
                  <button className="startup-refresh-button" disabled={serviceLogsLoading} onClick={() => void showServiceLogs(serviceLogTarget)}>
                    {serviceLogsLoading ? "Reading…" : "Refresh logs"}
                  </button>
                </div>
                {serviceLogsError ? (
                  <div className="storage-message" role="alert">Could not read service logs: {serviceLogsError}</div>
                ) : serviceLogsLoading ? (
                  <div className="storage-message" role="status">Reading recent journal entries…</div>
                ) : serviceLogs.length === 0 ? (
                  <div className="storage-message" role="status">No journal entries were found for this service.</div>
                ) : (
                  <div className="logs-list service-logs-list">
                    {serviceLogs.map((entry, index) => (
                      <article className={`log-entry severity-${entry.severity.toLocaleLowerCase()}`} key={`${entry.timestampMicros}-${index}`}>
                        <div className="log-entry-meta">
                          <time>{entry.timestampMicros ? new Date(entry.timestampMicros / 1000).toLocaleString() : "Time unavailable"}</time>
                          <strong>{entry.source}</strong>
                          <span className="log-severity">{entry.severity}</span>
                        </div>
                        <p>{entry.message}</p>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
            {visibleServices.length < filteredServices.length && (
              <button
                className="service-show-more"
                onClick={() => setServiceVisibleCount((count) => count + 60)}
              >
                Show more services ({filteredServices.length - visibleServices.length} remaining)
              </button>
            )}
            <p className="service-footnote">
              Service status comes from the systemd system and user managers. Service actions require confirmation; Linux may request administrator authorization for system-wide changes. Core system, login, network, remote-access, firewall, and disk-management services are protected.
            </p>
          </section>
        ) : page === "system" ? (
          <section className="system-info-page" aria-labelledby="system-info-page-title">
            <div className="system-info-heading">
              <div>
                <h2 id="system-info-page-title">This device</h2>
                <p>Information read locally from Linux and the current desktop session.</p>
              </div>
            </div>
            {systemInfoError ? (
              <div className="storage-message" role="alert">Could not read system information: {systemInfoError}</div>
            ) : !systemInfo ? (
              <div className="storage-message" role="status">Reading device information…</div>
            ) : (
              <div className="system-info-grid">
                <article className="system-info-card featured">
                  <span className="system-info-label">OPERATING SYSTEM</span>
                  <strong>{systemInfo.operatingSystem}</strong>
                  <small>{systemInfo.kernelVersion ? `Kernel ${systemInfo.kernelVersion}` : "Kernel version unavailable"}</small>
                </article>
                <article className="system-info-card">
                  <span className="system-info-label">PROCESSOR</span>
                  <strong>{systemInfo.processor ?? "Unavailable"}</strong>
                  <small>{systemInfo.logicalProcessors} logical processors{systemInfo.physicalCores ? ` · ${systemInfo.physicalCores} physical cores` : ""}</small>
                </article>
                <article className="system-info-card">
                  <span className="system-info-label">MEMORY</span>
                  <strong>{formatBytes(systemInfo.memoryTotalBytes)}</strong>
                  <small>Total installed memory reported by Linux</small>
                </article>
                <article className="system-info-card">
                  <span className="system-info-label">DEVICE</span>
                  <strong>{systemInfo.hostName ?? "Unavailable"}</strong>
                  <small>{systemInfo.architecture} architecture</small>
                </article>
                <article className="system-info-card">
                  <span className="system-info-label">DESKTOP SESSION</span>
                  <strong>{systemInfo.desktopEnvironment ?? "Unavailable"}</strong>
                  <small>{systemInfo.sessionType ? `${systemInfo.sessionType} session` : "Session type unavailable"}</small>
                </article>
                <article className="system-info-card">
                  <span className="system-info-label">UPTIME</span>
                  <strong>{formatUptime(systemInfo.uptimeSeconds)}</strong>
                  <small>Time since this system started</small>
                </article>
                {systemInfo.batteries.length === 0 ? (
                  <article className="system-info-card">
                    <span className="system-info-label">BATTERY</span>
                    <strong>Not detected</strong>
                    <small>This device does not expose battery status.</small>
                  </article>
                ) : systemInfo.batteries.map((battery) => (
                  <article className="system-info-card battery-info-card" key={battery.name}>
                    <span className="system-info-label">BATTERY · {battery.name}</span>
                    <strong>{battery.capacityPercent === null ? "Unavailable" : battery.capacityPercent + "%"}</strong>
                    {battery.capacityPercent !== null && (
                      <div
                        className="battery-meter"
                        role="progressbar"
                        aria-label={battery.name + " charge"}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={battery.capacityPercent}
                      >
                        <span style={{ width: battery.capacityPercent + "%" }} />
                      </div>
                    )}
                    <small>{battery.status ?? "Charge state unavailable"}</small>
                    <div className="battery-health-details">
                      <span>Full capacity health</span>
                      <strong>{battery.healthPercent === null ? "Unavailable" : `${battery.healthPercent}% of design`}</strong>
                      <span>Charge cycles</span>
                      <strong>{battery.cycleCount === null ? "Unavailable" : battery.cycleCount.toLocaleString()}</strong>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <p className="service-footnote">These details stay on this device. Some values depend on what the kernel and desktop environment make available.</p>
          </section>
        ) : page === "maintenance" ? (
          <section className="maintenance-page" aria-labelledby="maintenance-page-title">
            <div className="maintenance-heading">
              <div>
                <h2 id="maintenance-page-title">Large file finder</h2>
                <p>Scan one folder you choose. Kestrel reads file metadata only and never deletes or opens file contents.</p>
              </div>
              <div className="maintenance-controls">
                <label className="maintenance-threshold">
                  <span>Minimum size</span>
                  <select value={largeFileMinimum} onChange={(event) => { setLargeFileMinimum(Number(event.target.value)); setLargeFileScan(null); }}>
                    <option value={100 * 1024 * 1024}>100 MiB</option>
                    <option value={500 * 1024 * 1024}>500 MiB</option>
                    <option value={1024 * 1024 * 1024}>1 GiB</option>
                  </select>
                </label>
                <button className="startup-refresh-button" disabled={largeFileLoading} onClick={() => void chooseAndScanLargeFiles()}>
                  {largeFileLoading ? "Scanning…" : "Choose folder and scan"}
                </button>
              </div>
            </div>
            <div className="maintenance-note">
              Pick a focused folder such as Downloads or Videos. A scan stops after 100,000 entries or 20 seconds. Symbolic links are skipped, and no files are changed.
            </div>
            {largeFileError && <div className="storage-message" role="alert">Could not scan the folder: {largeFileError}</div>}
            {largeFileLoading ? (
              <div className="storage-message" role="status">Scanning file sizes and folders…</div>
            ) : largeFileScan ? (
              <>
                <div className="maintenance-summary">
                  <span>Folder <strong>{largeFileScan.root}</strong></span>
                  <span>{largeFileScan.scannedEntries.toLocaleString()} entries checked</span>
                  {largeFileScan.skippedEntries > 0 && <span>{largeFileScan.skippedEntries.toLocaleString()} inaccessible entries skipped</span>}
                </div>
                {largeFileScan.scanLimited && <div className="service-warning" role="status">The scan reached its workload limit. Choose a smaller folder for a more complete result.</div>}
                {largeFileScan.resultsLimited && <div className="service-warning" role="status">Showing the 250 largest matching files.</div>}
                {largeFileScan.files.length === 0 ? (
                  <div className="storage-message" role="status">No files at or above {formatProcessMemory(largeFileMinimum)} were found in this scan.</div>
                ) : (
                  <div className="large-file-list">
                    {largeFileScan.files.map((file) => (
                      <article className="large-file-entry" key={file.path}>
                        <div className="large-file-name">
                          <strong>{file.path.split("/").pop() || file.path}</strong>
                          <small>{file.path}</small>
                        </div>
                        <span>{formatProcessMemory(file.sizeBytes)}</span>
                      </article>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="storage-message" role="status">Choose a folder to start a read-only scan.</div>
            )}
            <section className="cache-inspector" aria-labelledby="cache-inspector-title">
              <div className="cache-inspector-heading">
                <div>
                  <h2 id="cache-inspector-title">Application cache usage</h2>
                  <p>Inspect the size of folders in your local cache directory.</p>
                </div>
                <button className="startup-refresh-button" disabled={cacheLoading} onClick={() => void inspectCacheSizes()}>
                  {cacheLoading ? "Inspecting…" : cacheInventory ? "Refresh cache sizes" : "Inspect cache sizes"}
                </button>
              </div>
              <div className="maintenance-note">
                Kestrel inspects only your account’s cache folder. Clear actions are limited to folders within ~/.cache. Choose a specific application folder; close that app first because it may need to rebuild its cache. The inspection stops after 100,000 entries or 20 seconds and may show partial sizes.
              </div>
              {cacheActionStatus && (
                <div className={cacheActionStatus.kind === "error" ? "process-action-message error" : "process-action-message"} role={cacheActionStatus.kind === "error" ? "alert" : "status"}>
                  {cacheActionStatus.message}
                </div>
              )}
              {cacheError && <div className="storage-message" role="alert">Could not inspect caches: {cacheError}</div>}
              {cacheLoading ? (
                <div className="storage-message" role="status">Calculating cache folder sizes…</div>
              ) : cacheInventory ? cacheInventory.available ? (
                <>
                  <div className="maintenance-summary">
                    <span>Total cache size <strong>{formatProcessMemory(cacheInventory.totalBytes)}</strong></span>
                    <span>{cacheInventory.filesScanned.toLocaleString()} files checked</span>
                    {cacheInventory.skippedEntries > 0 && <span>{cacheInventory.skippedEntries.toLocaleString()} entries unavailable</span>}
                  </div>
                  {cacheInventory.scanLimited && <div className="service-warning" role="status">The cache scan reached its workload limit and shows partial sizes.</div>}
                  {cacheInventory.entries.length === 0 ? (
                    <div className="storage-message" role="status">No cache files were found.</div>
                  ) : (
                    <div className="cache-size-list">
                      {cacheInventory.entries.map((entry) => (
                        <article className="cache-size-entry" key={entry.name}>
                          <strong>{entry.name}</strong>
                          <span>{formatProcessMemory(entry.sizeBytes)}</span>
                          <small>{entry.fileCount.toLocaleString()} files</small>
                          {entry.clearable && (
                            <button
                              className="cache-clear-button"
                              disabled={cacheActionName !== null || cacheLoading}
                              onClick={() => void clearCacheEntry(entry)}
                            >
                              {cacheActionName === entry.name ? "Clearing…" : "Clear"}
                            </button>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="storage-message" role="status">No local cache directory was found.</div>
              ) : (
                <div className="storage-message" role="status">Cache sizes have not been inspected.</div>
              )}
            </section>
            <section className="cache-inspector log-inspector" aria-labelledby="log-inspector-title">
              <div className="cache-inspector-heading">
                <div>
                  <h2 id="log-inspector-title">System log usage</h2>
                  <p>Review log file sizes and the journal’s reported disk usage.</p>
                </div>
                <button className="startup-refresh-button" disabled={logLoading} onClick={() => void inspectLogSizes()}>
                  {logLoading ? "Inspecting…" : logInventory ? "Refresh log sizes" : "Inspect log sizes"}
                </button>
              </div>
              <div className="maintenance-note">
                Kestrel reads file metadata and asks journalctl for its disk-usage summary. It does not read log contents, clear logs, or change permissions.
              </div>
              {logError && <div className="storage-message" role="alert">Could not inspect logs: {logError}</div>}
              {logLoading ? (
                <div className="storage-message" role="status">Checking local log sizes…</div>
              ) : logInventory ? (
                <>
                  {logInventory.logError && <div className="service-warning" role="status">{logInventory.logError}</div>}
                  {logInventory.journalUsage ? (
                    <div className="journal-usage-summary">
                      <span>Journal disk usage</span>
                      <strong>{logInventory.journalUsage}</strong>
                      <small>Journal data may also be included in the /var/log total.</small>
                    </div>
                  ) : logInventory.journalError ? (
                    <div className="service-warning" role="status">Journal usage unavailable: {logInventory.journalError}</div>
                  ) : null}
                  {logInventory.logDirectoryAvailable && (
                    <>
                      <div className="maintenance-summary">
                        <span>Total size of files under /var/log <strong>{formatProcessMemory(logInventory.logBytes)}</strong></span>
                        <span>{logInventory.scannedEntries.toLocaleString()} entries checked</span>
                        {logInventory.skippedEntries > 0 && <span>{logInventory.skippedEntries.toLocaleString()} entries unavailable</span>}
                      </div>
                      {logInventory.scanLimited && <div className="service-warning" role="status">The log scan reached its workload limit and shows partial file sizes.</div>}
                      {logInventory.files.length > 0 && (
                        <>
                          <h3 className="log-file-list-title">Largest files under /var/log</h3>
                          <div className="large-file-list">
                          {logInventory.files.map((file) => (
                            <article className="large-file-entry" key={file.path}>
                              <div className="large-file-name">
                                <strong>{file.path.split("/").pop() || file.path}</strong>
                                <small>{file.path}</small>
                              </div>
                              <span>{formatProcessMemory(file.sizeBytes)}</span>
                            </article>
                          ))}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              ) : (
                <div className="storage-message" role="status">Log sizes have not been inspected.</div>
              )}
            </section>
            <p className="service-footnote">This finder only reports large files. It does not select files for deletion, clean caches, or change permissions.</p>
          </section>
        ) : page === "diagnostics" ? (
          <section className="diagnostics-page" aria-labelledby="diagnostics-page-title">
            <div className="diagnostics-heading">
              <div>
                <h2 id="diagnostics-page-title">Prepare a support report</h2>
                <p>Collect a small system summary, review its contents, then choose where to save it.</p>
              </div>
              <button className="startup-refresh-button" disabled={diagnosticsLoading} onClick={() => void buildDiagnosticsReport()}>
                {diagnosticsLoading ? "Collecting…" : diagnosticsReport ? "Refresh report" : "Collect report"}
              </button>
            </div>
            <div className="diagnostics-privacy">
              The report contains OS and hardware details plus current CPU and memory readings. It excludes the device name, account name, IP addresses, process names, and file paths. The report stays on this device unless you choose to share it.
            </div>
            {diagnosticsStatus && (
              <div className={`diagnostics-status ${diagnosticsStatus.kind}`} role={diagnosticsStatus.kind === "error" ? "alert" : "status"}>
                {diagnosticsStatus.message}
              </div>
            )}
            {diagnosticsReport ? (
              <>
                <pre className="diagnostics-preview" aria-label="Diagnostics report preview">{diagnosticsReport}</pre>
                <div className="diagnostics-actions">
                  <button className="startup-refresh-button" disabled={diagnosticsSaving} onClick={() => void saveDiagnosticsReport()}>
                    {diagnosticsSaving ? "Saving…" : "Save reviewed report…"}
                  </button>
                </div>
              </>
            ) : !diagnosticsLoading ? (
              <div className="storage-message" role="status">No diagnostics have been collected. Choose “Collect report” to prepare a preview.</div>
            ) : null}
            <p className="service-footnote">Kestrel does not upload this report. Saving is optional and requires you to choose a file location.</p>
          </section>
        ) : page === "logs" ? (
          <section className="logs-page" aria-labelledby="system-logs-title">
            <div className="logs-toolbar">
              <div>
                <h2 id="system-logs-title">Recent system messages</h2>
                <p>{filteredSystemLogs.length} of {systemLogs.length} entries · latest 300 from this boot</p>
              </div>
              <div className="logs-controls">
                <label className="logs-range-label">
                  <span className="sr-only">Filter logs by time range</span>
                  <select value={systemLogsTimeRange} onChange={(event) => setSystemLogsTimeRange(event.target.value as LogTimeRange)}>
                    <option value="all">All captured times</option>
                    <option value="1h">Last hour</option>
                    <option value="6h">Last 6 hours</option>
                    <option value="24h">Last 24 hours</option>
                  </select>
                </label>
                <label className="logs-severity-label">
                  <span className="sr-only">Filter logs by severity</span>
                  <select value={systemLogsSeverity} onChange={(event) => setSystemLogsSeverity(event.target.value as LogSeverityFilter)}>
                    <option value="all">All severities</option>
                    <option value="errors">Errors and above</option>
                    <option value="warnings">Warnings</option>
                    <option value="info">Notice and info</option>
                    <option value="debug">Debug</option>
                  </select>
                </label>
                <label className="logs-search">
                  <span className="sr-only">Search log messages or sources</span>
                  <span aria-hidden="true">⌕</span>
                  <input type="search" value={systemLogsQuery} onChange={(event) => setSystemLogsQuery(event.target.value)} placeholder="Search messages…" />
                </label>
                <button className="startup-refresh-button" onClick={() => setSystemLogsRefreshKey((value) => value + 1)} disabled={systemLogsLoading}>
                  {systemLogsLoading ? "Refreshing…" : "Refresh"}
                </button>
                <button className="startup-refresh-button" onClick={() => void exportSystemLogs()} disabled={systemLogsExporting || filteredSystemLogs.length === 0}>
                  {systemLogsExporting ? "Exporting…" : "Export filtered"}
                </button>
              </div>
            </div>
            {systemLogsStatus && (
              <div className={systemLogsStatus.kind === "error" ? "process-action-message error" : "process-action-message"} role={systemLogsStatus.kind === "error" ? "alert" : "status"}>
                {systemLogsStatus.message}
              </div>
            )}
            {systemLogsError ? (
              <div className="storage-message" role="alert">Could not read recent system messages: {systemLogsError}</div>
            ) : systemLogsLoading && systemLogs.length === 0 ? (
              <div className="storage-message" role="status">Reading the system journal…</div>
            ) : filteredSystemLogs.length === 0 ? (
              <div className="storage-message" role="status">{systemLogs.length ? "No log entries match these filters." : "No recent system messages were found."}</div>
            ) : (
              <div className="logs-list" role="list" aria-label="Recent system messages">
                {filteredSystemLogs.map((entry, index) => (
                  <article className={`log-entry severity-${entry.severity.toLocaleLowerCase()}`} key={`${entry.timestampMicros}-${index}`} role="listitem">
                    <div className="log-entry-meta">
                      <time dateTime={entry.timestampMicros ? new Date(entry.timestampMicros / 1000).toISOString() : undefined}>
                        {formatSystemLogTimestamp(entry.timestampMicros)}
                      </time>
                      <span className="log-severity">{entry.severity}</span>
                      <strong title={entry.source}>{entry.source}</strong>
                    </div>
                    <p>{entry.message}</p>
                  </article>
                ))}
              </div>
            )}
            <p className="service-footnote">Kestrel reads up to 300 entries from the current boot using the local system journal. It does not edit or upload log data.</p>
          </section>
        ) : page === "sensors" ? (
          <section className="sensors-page" aria-labelledby="sensors-page-title">
            <div className="sensors-page-heading">
              <div>
                <h2 id="sensors-page-title">Hardware temperatures</h2>
                <p>Sensor readings refresh every five seconds while this page is open.</p>
              </div>
              <span>{temperatures.length} readings</span>
            </div>
            {temperatureError ? (
              <div className="storage-message" role="alert">Could not read hardware sensors: {temperatureError}</div>
            ) : temperatureLoading && temperatures.length === 0 ? (
              <div className="storage-message" role="status">Reading hardware sensors…</div>
            ) : temperatures.length === 0 ? (
              <div className="storage-message" role="status">No readable temperature sensors were reported by this device.</div>
            ) : (
              <div className="sensor-grid">
                {[...temperatures].sort((a, b) => b.temperatureCelsius - a.temperatureCelsius).map((sensor, index) => {
                  const value = temperatureUnit === "celsius" ? sensor.temperatureCelsius : sensor.temperatureCelsius * 9 / 5 + 32;
                  const critical = sensor.criticalCelsius === null ? null : temperatureUnit === "celsius" ? sensor.criticalCelsius : sensor.criticalCelsius * 9 / 5 + 32;
                  const percentToCritical = sensor.criticalCelsius && sensor.criticalCelsius > 0
                    ? Math.max(0, Math.min(100, sensor.temperatureCelsius / sensor.criticalCelsius * 100))
                    : null;
                  const nearLimit = percentToCritical !== null && percentToCritical >= 85;
                  return (
                    <article className={`sensor-card${nearLimit ? " near-limit" : ""}`} key={`${sensor.label}-${index}`}>
                      <div className="sensor-card-heading">
                        <span className="sensor-icon" aria-hidden="true">°</span>
                        <span className="sensor-state">{nearLimit ? "Near reported limit" : "Reading available"}</span>
                      </div>
                      <h3>{sensor.label || `Sensor ${index + 1}`}</h3>
                      <strong className="sensor-value">{Math.round(value)}°{temperatureUnit === "celsius" ? "C" : "F"}</strong>
                      {percentToCritical !== null ? (
                        <>
                          <div className="sensor-meter" aria-label={`${Math.round(percentToCritical)} percent of reported critical temperature`}>
                            <span style={{ width: `${percentToCritical}%` }} />
                          </div>
                          <p>Critical limit reported at {Math.round(critical!)}°{temperatureUnit === "celsius" ? "C" : "F"}</p>
                        </>
                      ) : <p>No critical limit reported by this sensor</p>}
                    </article>
                  );
                })}
              </div>
            )}
            <p className="service-footnote">Temperatures and critical limits are supplied by the device’s sensor interface. Some hardware does not expose every sensor or limit.</p>
          </section>
        ) : page === "performance" ? (
          <section className="performance-page" aria-labelledby="performance-page-title">
            <div className="performance-page-heading">
              <div>
                <h2 id="performance-page-title">Live resource usage</h2>
                <p>Readings refresh every second while this page is open.</p>
              </div>
            </div>
            {performanceError ? (
              <div className="storage-message" role="alert">Could not read performance data: {performanceError}</div>
            ) : !performanceSnapshot ? (
              <div className="storage-message" role="status">Reading processor and memory usage…</div>
            ) : (
              <>
                <div className="performance-summary-grid">
                  <article className="performance-summary-card">
                    <span className="system-info-label">TOTAL CPU USAGE</span>
                    <strong>{Math.round(performanceSnapshot.cpuUsagePercent)}%</strong>
                    <div className="performance-meter"><span className="cpu" style={{ width: Math.max(0, Math.min(100, performanceSnapshot.cpuUsagePercent)) + "%" }} /></div>
                  </article>
                  <article className="performance-summary-card">
                    <span className="system-info-label">MEMORY</span>
                    <strong>{formatProcessMemory(performanceSnapshot.memoryUsedBytes)} <small>of {formatProcessMemory(performanceSnapshot.memoryTotalBytes)}</small></strong>
                    <div className="performance-meter"><span className="memory" style={{ width: performanceSnapshot.memoryTotalBytes > 0 ? Math.max(0, Math.min(100, (performanceSnapshot.memoryUsedBytes / performanceSnapshot.memoryTotalBytes) * 100)) + "%" : "0%" }} /></div>
                    <small>{formatProcessMemory(performanceSnapshot.memoryAvailableBytes)} available</small>
                  </article>
                  <article className="performance-summary-card">
                    <span className="system-info-label">SWAP</span>
                    <strong>{performanceSnapshot.swapTotalBytes > 0 ? formatProcessMemory(performanceSnapshot.swapUsedBytes) + " of " + formatProcessMemory(performanceSnapshot.swapTotalBytes) : "Not configured"}</strong>
                    {performanceSnapshot.swapTotalBytes > 0 && (
                      <div className="performance-meter"><span className="swap" style={{ width: Math.max(0, Math.min(100, (performanceSnapshot.swapUsedBytes / performanceSnapshot.swapTotalBytes) * 100)) + "%" }} /></div>
                    )}
                    <small>{performanceSnapshot.swapTotalBytes > 0 ? "Virtual memory in use" : "No swap space is available"}</small>
                  </article>
                </div>
                <div className="performance-summary-grid performance-io-grid">
                  <article className="performance-summary-card">
                    <span className="system-info-label">DISK READ</span>
                    <strong>{formatBytes(performanceSnapshot.diskReadBytesPerSecond)}<small>/s</small></strong>
                    <small>Current read activity across mounted drives</small>
                  </article>
                  <article className="performance-summary-card">
                    <span className="system-info-label">DISK WRITE</span>
                    <strong>{formatBytes(performanceSnapshot.diskWriteBytesPerSecond)}<small>/s</small></strong>
                    <small>Current write activity across mounted drives</small>
                  </article>
                </div>
                <div className="performance-cores">
                  <div className="performance-cores-heading">
                    <h2>Logical processor usage</h2>
                    <span>{performanceSnapshot.cores.length} processors</span>
                  </div>
                  <div className="performance-core-grid">
                    {performanceSnapshot.cores.map((core) => (
                      <article className="performance-core-card" key={core.name}>
                        <div><strong>{core.name}</strong><span>{Math.round(core.usagePercent)}%</span></div>
                        <div className="performance-meter"><span className={core.usagePercent >= 90 ? "high" : "cpu"} style={{ width: Math.max(0, Math.min(100, core.usagePercent)) + "%" }} /></div>
                      </article>
                    ))}
                  </div>
                </div>
              </>
            )}
          </section>
        ) : (
          <section className="settings-page" aria-labelledby="settings-page-title">
            <div className="settings-page-heading">
              <h2 id="settings-page-title">Display preferences</h2>
              <p>These choices are stored locally for this Kestrel installation.</p>
            </div>
            <div className="settings-list">
              <div className="settings-row">
                <div>
                  <h3>Temperature units</h3>
                  <p>Choose how hardware temperatures appear on Overview and Sensors.</p>
                </div>
                <select
                  aria-label="Temperature units"
                  value={temperatureUnit}
                  onChange={(event) => setTemperatureUnit(event.target.value as TemperatureUnit)}
                >
                  <option value="celsius">Celsius (°C)</option>
                  <option value="fahrenheit">Fahrenheit (°F)</option>
                </select>
              </div>
              <div className="settings-row">
                <div>
                  <h3>Performance chart range</h3>
                  <p>Choose the time range shown when you open the Overview.</p>
                </div>
                <select
                  aria-label="Default performance chart range"
                  value={historyWindow}
                  onChange={(event) => setHistoryWindow(Number(event.target.value))}
                >
                  <option value={300}>5 minutes</option>
                  <option value={900}>15 minutes</option>
                  <option value={1800}>30 minutes</option>
                </select>
              </div>
            </div>
            <p className="service-footnote">The temperature preference changes display units only. Kestrel keeps collecting the same local sensor readings.</p>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
