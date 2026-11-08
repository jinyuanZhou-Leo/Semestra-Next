// The messages code looks up by a computed key, by prefix; see gen-message-groups.mjs.
export const GROUPS = [
  { file: 'errors', name: 'errorMessages', prefix: 'error_' },
  { file: 'settings', name: 'settingsMessages', prefix: 'settings_' },
  { file: 'capabilities', name: 'capabilityMessages', prefix: 'capability_' },
  { file: 'assistant-fields', name: 'assistantFieldMessages', prefix: 'assistant_field_' },
  { file: 'job-steps', name: 'jobStepMessages', prefix: 'job_step_' },
  {
    file: 'portability-entities',
    name: 'portabilityEntityMessages',
    prefix: 'portability_entity_',
  },
]
