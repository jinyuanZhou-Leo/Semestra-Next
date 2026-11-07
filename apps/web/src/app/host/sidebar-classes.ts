/** Class names the app sidebar and the modules' sidebar navigation share. */

/**
 * A group label slides up behind the group above it on the icon rail (invisible but still
 * there), so it must not take the clicks meant for that group's last entry.
 */
export const GROUP_LABEL = 'group-data-[collapsible=icon]:pointer-events-none'

/**
 * An entry's action shown only while that entry's own button is hovered or focused or while
 * it is pressed.
 */
export const ENTRY_ACTION_ON_HOVER =
  'md:opacity-0 peer-hover/menu-button:opacity-100 peer-focus-visible/menu-button:opacity-100 hover:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100'
