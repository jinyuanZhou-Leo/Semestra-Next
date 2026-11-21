/**
 * Looks for a shadcn `ScrollArea` inside a rounded, bordered frame: the scrollbar floats clear of
 * the corners (`h-auto` lets the margin shorten the track instead of pushing it past the frame)
 * and its thumb is visible against the frame. Pass it in the `ScrollArea`'s `className`.
 */
export const FRAMED_SCROLLBAR =
  '**:data-[slot=scroll-area-scrollbar]:my-2 **:data-[slot=scroll-area-scrollbar]:h-auto **:data-[slot=scroll-area-thumb]:bg-muted-foreground/40'
