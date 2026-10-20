/** Class names the app sidebar and the modules' sidebar navigation share. */

/**
 * A group label slides up behind the group above it on the icon rail (invisible but still
 * there), so it must not take the clicks meant for that group's last entry.
 */
export const GROUP_LABEL = 'group-data-[collapsible=icon]:pointer-events-none'

/**
 * A sub-entry's ⋯ button, shown while that entry is hovered or focused (`showOnHover` follows
 * the whole parent entry, which holds every sub-entry).
 */
export const SUB_ACTION =
  'top-1 right-0.5 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 aria-expanded:bg-muted aria-expanded:opacity-100 md:opacity-0'

/**
 * An entry's action shown only while that entry's own button is hovered or focused (not its
 * sub-entries, unlike `showOnHover`), or while it is pressed.
 */
export const ENTRY_ACTION_ON_HOVER =
  'md:opacity-0 peer-hover/menu-button:opacity-100 peer-focus-visible/menu-button:opacity-100 hover:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100'
