export function LoadingField({
  loading,
  children,
  className,
}: {
  loading: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative min-w-0 ${className ?? ""}`}>
      {children}
      {loading && (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-white/80"
          aria-hidden
        >
          <span className="w-4 h-4 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
