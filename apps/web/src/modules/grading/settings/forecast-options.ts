import { m } from '@/paraglide/messages'

/** The forecast models with their explanations, for the Program default and the course choice. */
export const forecastOptions = () =>
  [
    { value: 'auto', label: m.grading_forecast_auto(), hint: m.grading_forecast_auto_hint() },
    {
      value: 'simple_minimum_needed',
      label: m.grading_forecast_simple(),
      hint: m.grading_forecast_simple_hint(),
    },
  ] as const
