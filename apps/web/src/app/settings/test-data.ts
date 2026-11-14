import { http, HttpResponse } from 'msw'
import { API } from '@/test-utils'

/**
 * Every account-level section with nothing in it. Opening the account settings loads the other
 * groups of the level when idle (and search renders every section), so a test that opens them
 * needs all of these.
 */
export function accountSettingsHandlers() {
  return [
    http.get(`${API}/auth/config`, () => HttpResponse.json({ google_client_id: null })),
    http.get(`${API}/account/sessions`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/account/tokens`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/me/settings-schemas`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/plugins/catalog`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/ai/providers`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/agent/tools`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/agent/preferences`, () =>
      HttpResponse.json({ auto_approve: [], mcp_allow_destructive: false }),
    ),
    http.get(`${API}/ai/assignments`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/ai/usage`, () =>
      HttpResponse.json({
        since: '2026-01-01T00:00:00Z',
        until: '2026-01-31T00:00:00Z',
        totals: {
          calls: 0,
          errors: 0,
          input_tokens: 0,
          cached_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
        },
        cost_complete: true,
        by_day: [],
        by_purpose: [],
        by_module: [],
        by_model: [],
      }),
    ),
    http.get(`${API}/agent/memories`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/lms/providers`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/lms/connections`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/storage/usage`, () =>
      HttpResponse.json({ used_bytes: 0, quota_bytes: 0, by_module: {} }),
    ),
    http.get(`${API}/files-usage/breakdown`, () =>
      HttpResponse.json({ by_course: [], by_type: [] }),
    ),
    http.get(`${API}/me/data-counts`, () => HttpResponse.json({ tables: {}, limits: {} })),
    http.get(`${API}/me/exports`, () => HttpResponse.json({ items: [] })),
  ]
}
