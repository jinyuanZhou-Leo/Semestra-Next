/**
 * Classes for a `CollapsibleContent` that opens and closes by sliding its height (Base UI sets
 * `--collapsible-panel-height`); without motion it just appears.
 */
export const COLLAPSE =
  'h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-out data-ending-style:h-0 data-starting-style:h-0 motion-reduce:transition-none'
