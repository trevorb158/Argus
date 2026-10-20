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

type HistorySample = {
  timestamp: number;
  cpuPercent: number;
  memoryPercent: number;
};

function formatGiB(bytes: number) {
  return (bytes / 1024 ** 3).toFixed(1);
}

function App() {
  const [telemetry, setTelemetry] = useState<TelemetrySnapshot | null>(null);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistorySample[]>([]);
  const [historyWindow, setHistoryWindow] = useState(300);
  const [drives, setDrives] = useState<DriveSnapshot[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);

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
  const latestSample = visibleHistory.at(-1);
  const historyRangeLabel =
    historyWindow === 300 ? "5 minutes" : historyWindow === 900 ? "15 minutes" : "30 minutes";
  const sampleProgress = Math.min(history.length, historyWindow);

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
          <button className="nav-item active">
            <span>◫</span> Overview
          </button>
          <button className="nav-item">
            <span>▤</span> Storage
          </button>
          <button className="nav-item">
            <span>⌘</span> Processes
          </button>
          <button className="nav-item">
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
            KESTREL <span>/</span> OVERVIEW
          </div>
          <button className="device-button">
            <span className="status-dot" /> This device <span>⌄</span>
          </button>
        </header>

        <section className="page-heading">
          <div>
            <p className="eyebrow">SYSTEM DASHBOARD</p>
            <h1>Overview</h1>
            <p className="subheading">
              A clear view of your workstation, at a glance.
            </p>
          </div>
          <div className="refresh-state">
            <span className={statusClass} /> {statusText}
          </div>
        </section>

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
      </main>
    </div>
  );
}

export default App;
