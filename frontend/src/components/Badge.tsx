const STYLES: Record<string, string> = {
  INTAKE: "bg-slate-100 text-slate-700",
  PREP: "bg-amber-100 text-amber-800",
  UPLOAD_REVIEW: "bg-purple-100 text-purple-800",
  FIELD: "bg-sky-100 text-sky-800",
  POLISH: "bg-orange-100 text-orange-800",
  QA_REVIEW: "bg-violet-100 text-violet-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  ACCEPTED: "bg-blue-100 text-blue-800",
  PROCESSING: "bg-yellow-100 text-yellow-800",
  DONE: "bg-green-100 text-green-800",
  FIX: "bg-red-100 text-red-800",
  FIX_DONE: "bg-pink-100 text-pink-800",
  PENDING: "bg-slate-100 text-slate-600",
};

export function Badge({ label, tone }: { label: string; tone?: string }) {
  const style = tone ? STYLES[tone] : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-medium ${style}`}>
      {label}
    </span>
  );
}
