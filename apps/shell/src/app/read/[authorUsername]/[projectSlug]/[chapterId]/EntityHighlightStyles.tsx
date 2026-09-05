/**
 * Styles for entity highlights applied post-render. Scoped to the reader page
 * so editor and other prose areas are untouched. Kept in sync with the reader
 * themes (light/dark/sepia) by reading from CSS variables on the containing
 * theme wrapper.
 */
export function EntityHighlightStyles() {
  return (
    <style>{`
      .entity-highlight {
        cursor: pointer;
        transition: background-color 120ms ease, border-color 120ms ease;
      }
      .entity-highlight--highlight {
        background-color: rgba(147, 51, 234, 0.14);
        border-radius: 2px;
        padding: 0 2px;
      }
      .entity-highlight--highlight:hover,
      .entity-highlight--highlight:focus {
        background-color: rgba(147, 51, 234, 0.28);
        outline: none;
      }
      .entity-highlight--underline {
        border-bottom: 1px dotted rgba(147, 51, 234, 0.6);
      }
      .entity-highlight--underline:hover,
      .entity-highlight--underline:focus {
        border-bottom-color: rgba(147, 51, 234, 1);
        background-color: rgba(147, 51, 234, 0.1);
        outline: none;
      }
    `}</style>
  )
}
