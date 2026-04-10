export function getHealthResponsePayload(isHealthy: boolean) {
  return {
    ok: isHealthy,
  };
}

export function getHealthResponseInit(isHealthy: boolean): ResponseInit {
  return {
    status: isHealthy ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  };
}
