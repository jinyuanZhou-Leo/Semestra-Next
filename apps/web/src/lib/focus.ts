/** Ref callback that moves focus to the element when it mounts (a new step of a flow). */
export function focusOnMount(el: HTMLElement | null) {
  el?.focus()
}
