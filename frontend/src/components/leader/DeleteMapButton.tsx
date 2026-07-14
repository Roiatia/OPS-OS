import { useState } from "react";
import { api } from "../../api";
import { canDeleteMap, getDeleteConfirmMessage } from "../../lib/mapDisplay";
import type { MapRecord } from "../../types";

interface Props {
  map: MapRecord;
  onDeleted: () => void;
  variant?: "icon" | "text" | "compact";
  className?: string;
}

/** Confirms and permanently deletes a map when allowed. */
export function DeleteMapButton({
  map,
  onDeleted,
  variant = "text",
  className = "",
}: Props) {
  const [loading, setLoading] = useState(false);

  if (!canDeleteMap(map)) return null;

  async function handleDelete() {
    if (!confirm(getDeleteConfirmMessage(map))) return;
    setLoading(true);
    try {
      await api.deleteMap(map.id);
      onDeleted();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        disabled={loading}
        onClick={handleDelete}
        title={`Delete ${map.mapNumber}`}
        aria-label={`Delete ${map.mapNumber}`}
        className={`p-1 text-muted hover:text-red-600 disabled:opacity-50 ${className}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="w-4 h-4"
          aria-hidden
        >
          <path
            fillRule="evenodd"
            d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    );
  }

  if (variant === "compact") {
    return (
      <button
        type="button"
        disabled={loading}
        onClick={handleDelete}
        className={`w-full px-2 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 ${className}`}
      >
        {loading ? "Deleting…" : "Delete"}
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={loading}
      onClick={handleDelete}
      className={`text-xs text-red-500 hover:text-red-700 disabled:opacity-50 ${className}`}
    >
      {loading ? "Deleting…" : "Delete map"}
    </button>
  );
}
