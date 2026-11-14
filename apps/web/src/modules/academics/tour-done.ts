/**
 * UI state: false while the tour is due (set at the end of onboarding), true once seen. Apart
 * from `shell/Tour.tsx` so onboarding and "What's new" can read it without loading the tour.
 */
export const TOUR_DONE_KEY = 'onboarding.tour_done'
