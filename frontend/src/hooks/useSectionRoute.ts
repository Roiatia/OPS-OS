import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

/**
 * Drives a dashboard's active section from the URL instead of local state.
 * Returns the current section (falling back to `defaultSection` for missing or
 * unknown values) and a setter that navigates to `${basePath}/${section}`.
 *
 * When the URL carries an unknown `:section` (typo, stale bookmark), we replace
 * it with the default so the address bar, back/forward history and sidebar
 * highlight never desync from the content that is actually rendered.
 */
export function useSectionRoute<T extends string>(
  basePath: string,
  sections: readonly T[],
  defaultSection: T
): [T, (section: T) => void] {
  const { section } = useParams();
  const navigate = useNavigate();
  const isValid = sections.includes(section as T);
  const active = isValid ? (section as T) : defaultSection;

  useEffect(() => {
    if (section !== undefined && !isValid) {
      navigate(`${basePath}/${defaultSection}`, { replace: true });
    }
  }, [section, isValid, basePath, defaultSection, navigate]);

  const setActive = (next: T) => navigate(`${basePath}/${next}`);
  return [active, setActive];
}
