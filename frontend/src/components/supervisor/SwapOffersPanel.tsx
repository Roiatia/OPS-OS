import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import type { MapRecord } from "../../types";

type OpenSwapOffer = Awaited<ReturnType<typeof api.getSwapOffers>>["open"][number];
type MySwapOffer = Awaited<ReturnType<typeof api.getSwapOffers>>["mine"][number];
type IncomingHelpAsk = Awaited<ReturnType<typeof api.getHelpAsks>>["incoming"][number];
type MyHelpAsk = Awaited<ReturnType<typeof api.getHelpAsks>>["mine"][number];

interface Props {
  /** Active field maps owned by the current user (for posting a swap). */
  myActiveMaps: MapRecord[];
  /** Other people's active maps — for Help others requests. */
  otherActiveMaps?: MapRecord[];
  /** Called after take/create so parent can refresh hub/maps lightly. */
  onChanged?: () => void;
  compact?: boolean;
}

export function SwapOffersPanel({
  myActiveMaps,
  otherActiveMaps = [],
  onChanged,
  compact = false,
}: Props) {
  const [swapOpen, setSwapOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedMapIds, setSelectedMapIds] = useState<Set<string>>(new Set());
  const [helpSelectedIds, setHelpSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [openOffers, setOpenOffers] = useState<OpenSwapOffer[]>([]);
  const [myOffers, setMyOffers] = useState<MySwapOffer[]>([]);
  const [incomingHelp, setIncomingHelp] = useState<IncomingHelpAsk[]>([]);
  const [myHelpAsks, setMyHelpAsks] = useState<MyHelpAsk[]>([]);

  const loadOffers = useCallback(async () => {
    try {
      const [swaps, help] = await Promise.all([api.getSwapOffers(), api.getHelpAsks()]);
      setOpenOffers(swaps.open);
      setMyOffers(swaps.mine);
      setIncomingHelp(help.incoming);
      setMyHelpAsks(help.mine);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadOffers();
    const t = setInterval(() => void loadOffers(), 60_000);
    return () => clearInterval(t);
  }, [loadOffers]);

  const eligible = useMemo(
    () =>
      myActiveMaps.filter(
        (m) =>
          m.fieldWorkStatus === "UNCOMPLETED" &&
          !m.onHubStatusBoard &&
          !m.swapBatchId
      ),
    [myActiveMaps]
  );

  const helpable = useMemo(
    () =>
      otherActiveMaps.filter(
        (m) =>
          m.fieldWorkStatus === "UNCOMPLETED" &&
          !m.onHubStatusBoard &&
          !m.helpAskBatchId &&
          m.assignedSupervisor
      ),
    [otherActiveMaps]
  );

  const helpByOwner = useMemo(() => {
    const groups = new Map<string, { name: string; maps: MapRecord[] }>();
    for (const m of helpable) {
      const id = m.assignedSupervisor!.id;
      const name = m.assignedSupervisor!.name;
      const g = groups.get(id) ?? { name, maps: [] };
      g.maps.push(m);
      groups.set(id, g);
    }
    return [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [helpable]);

  function openSwap() {
    setSelectedMapIds(new Set(eligible.map((m) => m.id)));
    setSwapOpen(true);
    setError("");
  }

  function openHelp() {
    setHelpSelectedIds(new Set());
    setHelpOpen(true);
    setError("");
  }

  async function confirmSwapRequest() {
    if (selectedMapIds.size === 0) {
      setError("Pick at least one map.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.createSwapOffer([...selectedMapIds]);
      setSwapOpen(false);
      await loadOffers();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmHelpAsk() {
    if (helpSelectedIds.size === 0) {
      setError("Pick at least one map to ask for.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await api.createHelpAsk([...helpSelectedIds]);
      setHelpOpen(false);
      await loadOffers();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function takeMaps(mapIds: string[]) {
    setLoading(true);
    setError("");
    try {
      await api.takeSwapMaps(mapIds);
      await loadOffers();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function declineOffer(batchId: string) {
    setLoading(true);
    setError("");
    try {
      await api.declineSwapOffer(batchId);
      await loadOffers();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function cancelOffer(batchId: string) {
    setLoading(true);
    setError("");
    try {
      await api.cancelSwapOffer(batchId);
      await loadOffers();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function acceptHelp(batchId: string) {
    setLoading(true);
    setError("");
    try {
      await api.acceptHelpAsk(batchId);
      await loadOffers();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function rejectHelp(batchId: string) {
    setLoading(true);
    setError("");
    try {
      await api.rejectHelpAsk(batchId);
      await loadOffers();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function cancelHelp(batchId: string) {
    setLoading(true);
    setError("");
    try {
      await api.cancelHelpAsk(batchId);
      await loadOffers();
      onChanged?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const pad = compact ? "px-3 py-2" : "px-4 py-3";
  const titleCls = compact ? "text-xs font-semibold" : "text-sm font-semibold";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {helpable.length > 0 && (
          <button
            type="button"
            onClick={openHelp}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Help others
          </button>
        )}
        {eligible.length > 0 && (
          <button
            type="button"
            onClick={openSwap}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600"
          >
            Call for a swap
          </button>
        )}
      </div>

      {error && !swapOpen && !helpOpen && (
        <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-1.5">{error}</p>
      )}

      {incomingHelp.length > 0 && (
        <div className={`rounded-lg border border-emerald-200 bg-emerald-50 ${pad} space-y-2`}>
          <p className={`${titleCls} text-emerald-950`}>
            Help requests ({incomingHelp.length})
          </p>
          {incomingHelp.map((ask) => (
            <div
              key={ask.batchId}
              className="rounded-md bg-white/90 border border-emerald-100 px-2.5 py-2 space-y-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-900">
                  {ask.from.name} wants {ask.maps.length} map
                  {ask.maps.length === 1 ? "" : "s"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void acceptHelp(ask.batchId)}
                    className="text-[10px] font-semibold px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void rejectHelp(ask.batchId)}
                    className="text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
              <ul className="space-y-0.5">
                {ask.maps.map((m) => (
                  <li key={m.id} className="text-[11px] text-slate-700">
                    {m.mapNumber} — {m.client}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {myHelpAsks.length > 0 && (
        <div className={`rounded-lg border border-emerald-100 bg-white ${pad} space-y-1.5`}>
          <p className={`${titleCls} text-slate-900`}>Your help requests</p>
          {myHelpAsks.map((ask) => (
            <div
              key={ask.batchId}
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <span className="text-slate-700">
                {ask.maps.map((m) => m.mapNumber).join(", ")}
                {ask.to ? ` → ${ask.to.name}` : ""} — waiting
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={() => void cancelHelp(ask.batchId)}
                className="text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {openOffers.length > 0 && (
        <div className={`rounded-lg border border-amber-200 bg-amber-50 ${pad} space-y-2`}>
          <p className={`${titleCls} text-amber-950`}>
            Available to take ({openOffers.length})
          </p>
          {openOffers.map((offer) => (
            <div
              key={offer.batchId}
              className="rounded-md bg-white/90 border border-amber-100 px-2.5 py-2 space-y-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-slate-900">
                  {offer.from.name} · {offer.maps.length} map
                  {offer.maps.length === 1 ? "" : "s"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void takeMaps(offer.maps.map((m) => m.id))}
                    className="text-[10px] font-semibold px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    Take all
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void declineOffer(offer.batchId)}
                    className="text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Refuse
                  </button>
                </div>
              </div>
              <ul className="space-y-0.5">
                {offer.maps.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between gap-2 text-[11px] text-slate-700"
                  >
                    <span>
                      {m.mapNumber} — {m.client}
                    </span>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void takeMaps([m.id])}
                      className="font-semibold text-emerald-700 hover:underline disabled:opacity-50"
                    >
                      Take
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {myOffers.length > 0 && (
        <div className={`rounded-lg border border-slate-200 bg-slate-50 ${pad} space-y-1.5`}>
          <p className={`${titleCls} text-slate-900`}>Your open swap requests</p>
          {myOffers.map((offer) => (
            <div
              key={offer.batchId}
              className="flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <span className="text-slate-700">
                {offer.maps.map((m) => m.mapNumber).join(", ")} — waiting
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={() => void cancelOffer(offer.batchId)}
                className="text-[10px] font-semibold px-2 py-1 rounded-md border border-slate-300 text-slate-700 hover:bg-white disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ))}
        </div>
      )}

      {swapOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border border-border p-5 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">Call for a swap</h3>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}
            <p className="text-sm font-medium">Maps to offer</p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {eligible.map((map) => (
                <label key={map.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedMapIds.has(map.id)}
                    onChange={(e) => {
                      setSelectedMapIds((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(map.id);
                        else next.delete(map.id);
                        return next;
                      });
                    }}
                  />
                  {map.mapNumber} — {map.client}
                </label>
              ))}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setSwapOpen(false)}
                className="px-4 py-2 text-sm text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => void confirmSwapRequest()}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {loading ? "Posting…" : "Post swap request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl border border-border p-5 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Help others</h3>
              <p className="text-xs text-muted mt-1">
                Ask to take maps — the owner must accept or reject.
              </p>
            </div>
            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}
            <div className="space-y-3 max-h-72 overflow-y-auto">
              {helpByOwner.length === 0 ? (
                <p className="text-sm text-muted">No maps available to ask for.</p>
              ) : (
                helpByOwner.map(([ownerId, group]) => (
                  <div key={ownerId} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{group.name}</p>
                      <button
                        type="button"
                        className="text-[10px] font-semibold text-emerald-700 hover:underline"
                        onClick={() => {
                          setHelpSelectedIds((prev) => {
                            const next = new Set(prev);
                            const allSelected = group.maps.every((m) => next.has(m.id));
                            for (const m of group.maps) {
                              if (allSelected) next.delete(m.id);
                              else next.add(m.id);
                            }
                            return next;
                          });
                        }}
                      >
                        {group.maps.every((m) => helpSelectedIds.has(m.id))
                          ? "Clear"
                          : "Select all"}
                      </button>
                    </div>
                    {group.maps.map((map) => (
                      <label key={map.id} className="flex items-center gap-2 text-sm pl-1">
                        <input
                          type="checkbox"
                          checked={helpSelectedIds.has(map.id)}
                          onChange={(e) => {
                            setHelpSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(map.id);
                              else next.delete(map.id);
                              return next;
                            });
                          }}
                        />
                        {map.mapNumber} — {map.client}
                      </label>
                    ))}
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="px-4 py-2 text-sm text-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={loading || helpSelectedIds.size === 0}
                onClick={() => void confirmHelpAsk()}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {loading
                  ? "Sending…"
                  : `Ask for ${helpSelectedIds.size || ""} map${helpSelectedIds.size === 1 ? "" : "s"}`.trim()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
