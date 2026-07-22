import { useEffect, useState } from "react";

type Props = {
  value: string | null | undefined;
  disabled?: boolean;
  title?: string;
  placeholder?: string;
  className?: string;
  onCommit: (next: string | null) => void;
};

/** Inline text cell: commits on blur or Enter when the value changed. */
export function BoardTextInput({
  value,
  disabled,
  title,
  placeholder = "—",
  className = "",
  onCommit,
}: Props) {
  const server = value?.trim() ?? "";
  const [draft, setDraft] = useState(server);

  useEffect(() => {
    setDraft(server);
  }, [server]);

  function commit() {
    const next = draft.trim();
    if (next === server) return;
    onCommit(next || null);
  }

  return (
    <input
      type="text"
      value={draft}
      disabled={disabled}
      title={title}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          setDraft(server);
          e.currentTarget.blur();
        }
      }}
      className={`w-full min-w-[4.5rem] rounded-md border border-border bg-white px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 ${className}`}
    />
  );
}
