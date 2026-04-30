/**
 * The Canopy API and dashboard share the same origin in production
 * (`https://trycanopy.ai`). The dashboard sits under `/dashboard`. Helpers
 * here derive deep-links from the configured `baseUrl` so error messages can
 * point developers to the page that fixes the problem.
 */

function dashboardBase(apiBaseUrl: string): string {
  return apiBaseUrl.replace(/\/$/, "") + "/dashboard";
}

export function apiKeysUrl(apiBaseUrl: string): string {
  return dashboardBase(apiBaseUrl) + "/settings";
}

export function agentsUrl(apiBaseUrl: string): string {
  return dashboardBase(apiBaseUrl) + "/agents";
}

export function agentUrl(apiBaseUrl: string, agentId: string): string {
  return dashboardBase(apiBaseUrl) + "/agents/" + encodeURIComponent(agentId);
}

export function activityUrl(apiBaseUrl: string): string {
  return dashboardBase(apiBaseUrl) + "/activity";
}
