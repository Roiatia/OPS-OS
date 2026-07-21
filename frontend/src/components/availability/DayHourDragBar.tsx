import { useRef, useState, type PointerEvent } from "react";

const HOURS = Array.from({ length: 25 }, (_, i) => i); // 0..24

/** Night shift band: 22:00 → 06:00 (spans midnight on the day bar). */
const NIGHT_START_HOUR = 22;
const NIGHT_END_HOUR = 6;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function snapHour(raw: number): number {
  return clamp(Math.round(raw), 0, 24);
}

function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  if (m === 24 * 60) return "00:00";
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function isNightHour(h: number): boolean {
  // Hour slot [h, h+1). Night = 22–24 and 0–6
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

type Props = {
  startMinutes: number;
  endMinutes: number;
  onChange: (startMinutes: number, endMinutes: number) => void;
  disabled?: boolean;
  /** Cap selectable end hour (e.g. 16 for unsigned Friday / Shabbat enter). */
  maxEndHour?: number;
};

/**
 * Drag a block across a 00:00 → 00:00 (next) day bar.
 * Night hours (22:00–06:00) are tinted yellow while dragging / selected.
 * Overnight work = select late hours on day A + early hours on day B.
 */
export function DayHourDragBar({
  startMinutes,
  endMinutes,
  onChange,
  disabled,
  maxEndHour = 24,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<number | null>(null);
  const endCap = clamp(maxEndHour, 1, 24);

  const startH = startMinutes / 60;
  const endH = endMinutes / 60;
  const hasRange = endMinutes > startMinutes;

  function hourFromClientX(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return clamp(snapHour(ratio * 24), 0, endCap);
  }

  function applyDrag(hour: number) {
    const origin = dragOrigin.current;
    if (origin == null) return;
    const a = Math.min(origin, hour);
    const b = Math.max(origin, hour);
    if (a === b) {
      const start = Math.min(a, 23);
      onChange(start * 60, (start + 1) * 60);
      return;
    }
    onChange(a * 60, b * 60);
  }

  function onPointerDown(e: PointerEvent) {
    if (disabled) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const hour = hourFromClientX(e.clientX);
    dragOrigin.current = hour;
    setDragging(true);
    applyDrag(hour);
  }

  function onPointerMove(e: PointerEvent) {
    if (!dragging || disabled) return;
    applyDrag(hourFromClientX(e.clientX));
  }

  function onPointerUp(e: PointerEvent) {
    if (!dragging) return;
    applyDrag(hourFromClientX(e.clientX));
    setDragging(false);
    dragOrigin.current = null;
  }

  /** Selected segments split into day (blue) vs night (yellow). */
  const selectionSegments: { left: number; width: number; night: boolean }[] = [];
  if (hasRange) {
    for (let h = Math.floor(startH); h < Math.ceil(endH) && h < 24; h++) {
      const segStart = Math.max(startH, h);
      const segEnd = Math.min(endH, h + 1);
      if (segEnd <= segStart) continue;
      selectionSegments.push({
        left: (segStart / 24) * 100,
        width: ((segEnd - segStart) / 24) * 100,
        night: isNightHour(h),
      });
    }
  }

  return (
    <div className="space-y-1.5 select-none">
      <div className="flex items-center justify-between text-[10px] text-muted">
        <span>00:00</span>
        <span className="font-medium text-slate-700">
          {hasRange
            ? `${minutesToLabel(startMinutes)} – ${endMinutes === 1440 ? "00:00" : minutesToLabel(endMinutes)}`
            : "Drag hours"}
        </span>
        <span>00:00</span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={`relative h-9 rounded-lg border border-border bg-slate-100 overflow-hidden touch-none ${
          disabled ? "opacity-50 cursor-not-allowed" : "cursor-ew-resize"
        }`}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={24}
        aria-label="Shift hours"
      >
        {/* Night band background: 22:00–06:00 */}
        <div
          className="absolute top-0 bottom-0 bg-amber-100/90 pointer-events-none"
          style={{ left: "0%", width: `${(NIGHT_END_HOUR / 24) * 100}%` }}
          title="Night shift (00:00–06:00)"
        />
        <div
          className="absolute top-0 bottom-0 bg-amber-100/90 pointer-events-none"
          style={{
            left: `${(NIGHT_START_HOUR / 24) * 100}%`,
            width: `${((24 - NIGHT_START_HOUR) / 24) * 100}%`,
          }}
          title="Night shift (22:00–00:00)"
        />
        <div className="absolute inset-0 flex pointer-events-none">
          {HOURS.slice(0, 24).map((h) => (
            <div
              key={h}
              className={`flex-1 border-r border-slate-200/80 ${h % 6 === 0 ? "border-slate-300" : ""}`}
            />
          ))}
        </div>
        {selectionSegments.map((seg, i) => (
          <div
            key={i}
            className={`absolute top-1 bottom-1 pointer-events-none shadow-sm first:rounded-l-md last:rounded-r-md ${
              seg.night ? "bg-amber-400/95" : "bg-brand-500/90"
            }`}
            style={{ left: `${seg.left}%`, width: `${Math.max(seg.width, 0.4)}%` }}
          />
        ))}
      </div>
      <p className="text-[10px] text-muted leading-snug">
        <span className="text-amber-700 font-medium">Yellow = night</span>
        {" "}
        (22:00–06:00). Overnight? Drag evening → 00:00 here, then 00:00 → morning on the next day.
      </p>
    </div>
  );
}
