import { toDateInputValue } from "../../lib/dates";
import {
  spreadsheetDateFieldClass,
  type SpreadsheetDateKind,
} from "../../lib/mapDisplay";

type Props = {
  kind: SpreadsheetDateKind;
  value: string | null | undefined;
  disabled?: boolean;
  title?: string;
  onChange: (isoDate: string | null) => void;
};

/** Editable colored date cell for CSV schedule / mapping / studio columns. */
export function SpreadsheetDateInput({
  kind,
  value,
  disabled,
  title,
  onChange,
}: Props) {
  const hasValue = Boolean(value);
  return (
    <input
      type="date"
      value={toDateInputValue(value ?? null)}
      disabled={disabled}
      title={title}
      onChange={(e) => onChange(e.target.value || null)}
      className={`w-full min-w-[8.5rem] rounded-md border px-1.5 py-1 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 ${spreadsheetDateFieldClass(kind, hasValue)}`}
    />
  );
}
