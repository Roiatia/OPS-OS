import { useEffect, useState } from "react";
import { api } from "../api";
import { MapCard } from "../components/MapCard";
import type { MapRecord } from "../types";

export function InspectorDashboardPage() {
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMaps().then(setMaps).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold">Mapping Inspector</h1>
      <p className="text-muted mt-1">Maps assigned to you</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {loading ? (
          <p className="text-muted">Loading...</p>
        ) : maps.length === 0 ? (
          <p className="text-muted">No maps assigned yet.</p>
        ) : (
          maps.map((m) => <MapCard key={m.id} map={m} />)
        )}
      </div>
    </div>
  );
}

export function QaDashboardPage() {
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMaps().then(setMaps).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold">Graphic QA</h1>
      <p className="text-muted mt-1">Maps awaiting your review</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {loading ? (
          <p className="text-muted">Loading...</p>
        ) : maps.length === 0 ? (
          <p className="text-muted">No maps in your queue.</p>
        ) : (
          maps.map((m) => <MapCard key={m.id} map={m} />)
        )}
      </div>
    </div>
  );
}
