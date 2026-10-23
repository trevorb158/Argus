import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ActivityEntry {
  id: string;
  timestamp: string;
  action: string;
  target: string;
  outcome: "success" | "failure" | "warning";
}

interface ActivityState {
  history: ActivityEntry[];
  addEntry: (entry: Omit<ActivityEntry, "id">) => void;
  clearHistory: () => void;
}

export const useActivityStore = create<ActivityState>()(
  persist(
    (set) => ({
      history: [],
      addEntry: (entry) =>
        set((state) => ({
          history: [
            { ...entry, id: crypto.randomUUID() },
            ...state.history, // Newest first
          ],
        })),
      clearHistory: () => set({ history: [] }),
    }),
    { name: "argus-activity-storage" }, // This handles localStorage automatically!
  ),
);
