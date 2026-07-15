import { useNavigate, useParams } from "react-router-dom";

/**
 * Drives a dashboard's active section from the URL instead of local state.
 * Returns the current section (falling back to `defaultSection` for missing or
 * unknown values) and a setter that navigates to `${basePath}/${section}`.
 */
export function useSectionRoute<T extends string>(
  basePath: string,
  sections: readonly T[],
  defaultSection: T
): [T, (section: T) => void] {
  const { section } = useParams();
  const navigate = useNavigate();
  const active = (sections.includes(section as T) ? (section as T) : defaultSection);
  const setActive = (next: T) => navigate(`${basePath}/${next}`);
  return [active, setActive];
}
