interface Props {
  className?: string;
  size?: "sm" | "md" | "lg";
}

const HEIGHTS = {
  sm: "h-6",
  md: "h-8",
  lg: "h-10",
};

export function OriientLogo({ className = "", size = "md" }: Props) {
  return (
    <img
      src="/oriient-logo.png"
      alt="Oriient"
      className={`${HEIGHTS[size]} w-auto object-contain ${className}`}
    />
  );
}
