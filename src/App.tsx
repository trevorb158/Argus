import { Fragment, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type TelemetrySnapshot = {
  cpuUsagePercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
};

type TemperatureSnapshot = {
  label: string;
  temperatureCelsius: number;
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

type StartupAppSnapshot = {
  id: string;
  name: string;
  command: string;
  source: string;
  enabled: boolean;
};

type StartupActionStatus = { kind: "success" | "error"; message: string };

type DriveSnapshot = {
  name: string;
  mountPoint: string;
  fileSystem: string;
  totalBytes: number;
  availableBytes: number;
  isRemovable: boolean;
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

type ProcessSnapshot = {
  pid: number;
  name: string;
  startTime: number;
  parentPid: number | null;
  status: string;
  runTimeSeconds: number;
  cpuUsagePercent: number;
  memoryBytes: number;
};

type ProcessActionStatus = { kind: "success" | "error"; message: string };

type AppPage = "overview" | "processes" | "storage" | "network" | "startup";
type ProcessSortKey = "name" | "pid" | "cpu" | "memory";
type ProcessSort = { key: ProcessSortKey; direction: "asc" | "desc" };

type HistorySample = {
  timestamp: number;
  cpuPercent: number;
  memoryPercent: number;
};

function formatGiB(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(1);
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

function App() {
  const [page, setPage] = useState<AppPage>("overview");
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [temperatures, setTemperatures] = useState<TemperatureSnapshot[]>([]);
  const [temperatureError, setTemperatureError] = useState<string | null>(null);
  const [temperatureLoading, setTemperatureLoading] = useState(false);
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [historyWindow, setHistoryWindow] = useState(300);
  const [drives, setDrives] = useState<DriveSnapshot[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [partitions, setPartitions] = useState<PartitionSnapshot[]>([]);
  const [partitionError, setPartitionError] = useState<string | null>(null);
  const [partitionLoading, setPartitionLoading] = useState(false);
  const [networkInterfaces, setNetworkInterfaces] = useState<NetworkInterfaceSnapshot[]>([]);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [startupApps, setStartupApps] = useState<StartupAppSnapshot[]>([]);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [startupLoading, setStartupLoading] = useState(false);
  const [startupQuery, setStartupQuery] = useState("");
  const [startupRefreshKey, setStartupRefreshKey] = useState(0);
  const [startupActionId, setStartupActionId] = useState<string | null>(null);
  const [startupActionStatus, setStartupActionStatus] =
    useState<StartupActionStatus | null>(null);
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
  const [processSort, setProcessSort] = useState<ProcessSort>({
    key: "cpu",
    direction: "desc",
  });
  const [terminatingPid, setTerminatingPid] = useState<number | null>(null);
  const [selectedProcessPid, setSelectedProcessPid] = useState<number | null>(null);
  const [processActionStatus, setProcessActionStatus] =
    useState<ProcessActionStatus | null>(null);

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
    if (page !== "overview") return;

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
    if (page !== "processes") return;

    let active = true;
    let timeoutId = 0;
    setProcessLoading(true);

    async function refreshProcesses() {
      try {
        const snapshot = await invoke<ProcessSnapshot[]>("get_processes");
        if (active) {
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
        ? `${Math.round(hottestTemperature.temperatureCelsius)}°C`
        : "Unavailable",
      detail: hottestTemperature
        ? `${hottestTemperature.label || "System sensor"} · highest available reading`
        : temperatureError
          ? "Could not read hardware sensors"
          : temperatureLoading
            ? "Checking for sensors"
            : "No readable temperature sensors",
      icon: "°C",
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

  const filteredProcesses = processes
    .filter((process) => {
      const query = processQuery.trim().toLocaleLowerCase();
      return (
        !query ||
        process.name.toLocaleLowerCase().includes(query) ||
        String(process.pid).includes(query)
      );
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
      }
      return processSort.direction === "asc" ? comparison : -comparison;
    });

  function sortProcesses(key: ProcessSortKey) {
    setProcessSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
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

  const statusText = telemetryError
    ? "Telemetry unavailable"
    : telemetry
      ? "Telemetry active"
      : "Preparing telemetry";

  const statusClass =
    telemetry && !telemetryError ? "status-dot" : "status-dot muted";

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
          <button className="nav-item upcoming" disabled title="Coming later">
            <span>⚙</span> Settings <small>SOON</small>
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
                      : "LOGIN APPLICATIONS"}
            </p>
            <h1>{page === "overview" ? "Overview" : page === "processes" ? "Processes" : page === "storage" ? "Storage" : page === "network" ? "Network" : "Startup"}</h1>
            <p className="subheading">
              {page === "overview"
                ? "A clear view of your workstation, at a glance."
                : page === "processes"
                  ? "See which programs are using your system resources."
                  : page === "storage"
                    ? "Review mounted volumes and how their space is being used."
                    : page === "network"
                      ? "See live traffic and addresses for this device’s network interfaces."
                      : "Review applications configured to start when you sign in."}
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
                        : startupError
                          ? "status-dot muted"
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
                    : startupError
                      ? "Startup information unavailable"
                      : startupLoading
                        ? "Reading startup entries"
                        : `${startupApps.filter((startupApp) => startupApp.enabled).length} enabled entries`}
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
                <p>{filteredProcesses.length} shown · refreshed every 2.5 seconds</p>
              </div>
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
                {processQuery ? "No processes match your search." : "No processes were found."}
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
                        <button onClick={() => sortProcesses("memory")}>Memory <span>↕</span></button>
                      </th>
                      <th className="process-action-heading">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProcesses.map((process) => (
                      <Fragment key={process.pid}>
                      <tr>
                        <td className="process-name" title={process.name || "Unnamed process"}>
                          {process.name || "Unnamed process"}
                        </td>
                        <td className="process-number">{process.pid}</td>
                        <td className="process-number">{process.cpuUsagePercent.toFixed(1)}%</td>
                        <td className="process-number">{formatProcessMemory(process.memoryBytes)}</td>
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
                            disabled={terminatingPid === process.pid}
                            aria-label={`End ${process.name || "unnamed process"}, PID ${process.pid}`}
                          >
                            {terminatingPid === process.pid ? "Sending…" : "End"}
                          </button>
                          </div>
                        </td>
                      </tr>
                      {selectedProcessPid === process.pid && (
                        <tr id={`process-details-${process.pid}`} className="process-details-row">
                          <td className="process-details-cell" colSpan={5}>
                            <dl className="process-details">
                              <div><dt>State</dt><dd>{process.status}</dd></div>
                              <div><dt>Parent PID</dt><dd>{process.parentPid ?? "Unavailable"}</dd></div>
                              <div><dt>Running for</dt><dd>{formatProcessRuntime(process.runTimeSeconds)}</dd></div>
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
              Ending a process requests normal termination. Unsaved work may be lost, and protected system processes may reject the request. Kestrel will not force-stop a process.
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
            <section className="partition-inventory" aria-labelledby="partition-inventory-title">
              <div className="partition-inventory-heading">
                <div>
                  <h2 id="partition-inventory-title">Detected partitions</h2>
                  <p>{partitionLoading && partitions.length === 0 ? "Scanning block devices…" : `${filteredPartitions.length} of ${partitions.length} entries · refreshes every 15 seconds`}</p>
                </div>
              </div>

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
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
            <p className="storage-footnote">
              Linux supplies this read-only partition inventory. Used and free space are shown above for mounted volumes; unmounted partitions show capacity only. Kestrel does not mount or repair drives.
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
        ) : (
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
        )}
      </main>
    </div>
  );
}

export default App;
