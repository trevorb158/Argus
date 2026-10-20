import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

type TelemetrySnapshot = {
  cpuUsagePercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
};

type DriveSnapshot = {
  name: string;
  mountPoint: string;
  fileSystem: string;
  totalBytes: number;
  availableBytes: number;
  isRemovable: boolean;
};

type ProcessSnapshot = {
  pid: number;
  name: string;
  cpuUsagePercent: number;
  memoryBytes: number;
};

type AppPage = "overview" | "processes";
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

function App() {
  const [page, setPage] = useState<AppPage>("overview");
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [historyWindow, setHistoryWindow] = useState(300);
  const [drives, setDrives] = useState<DriveSnapshot[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [processes, setProcesses] = useState<ProcessSnapshot[]>([]);
  const [processError, setProcessError] = useState<string | null>(null);
  const [processLoading, setProcessLoading] = useState(false);
  const [processQuery, setProcessQuery] = useState("");
  const [processSort, setProcessSort] = useState<ProcessSort>({
    key: "cpu",
    direction: "desc",
  });

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
      value: "—",
      detail: "Sensor readings come in a later step",
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
          <button className="nav-item upcoming" disabled title="Coming later">
            <span>▤</span> Storage <small>SOON</small>
          </button>
          <button
            className={`nav-item${page === "processes" ? " active" : ""}`}
            aria-current={page === "processes" ? "page" : undefined}
            onClick={() => setPage("processes")}
          >
            <span>⌘</span> Processes
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
              {page === "overview" ? "SYSTEM DASHBOARD" : "RUNNING APPLICATIONS AND SERVICES"}
            </p>
            <h1>{page === "overview" ? "Overview" : "Processes"}</h1>
            <p className="subheading">
              {page === "overview"
                ? "A clear view of your workstation, at a glance."
                : "See which programs are using your system resources."}
            </p>
          </div>
          <div className="refresh-state">
            <span className={page === "overview" ? statusClass : processError ? "status-dot muted" : "status-dot"} />
            {page === "overview"
              ? statusText
              : processError
                ? "Process list unavailable"
                : processLoading
                  ? "Reading processes"
                  : `${processes.length} processes`}
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
        ) : (
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
                    </tr>
                  </thead>
                  <tbody>
                    {filteredProcesses.map((process) => (
                      <tr key={process.pid}>
                        <td className="process-name" title={process.name || "Unnamed process"}>
                          {process.name || "Unnamed process"}
                        </td>
                        <td className="process-number">{process.pid}</td>
                        <td className="process-number">{process.cpuUsagePercent.toFixed(1)}%</td>
                        <td className="process-number">{formatProcessMemory(process.memoryBytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="process-footnote">
              Process information is read-only. Some system processes may show limited details due to operating-system permissions.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
