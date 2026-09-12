export const HEALTH_FAILURE_CODES = Object.freeze({
  DEPLOYMENT_VERSION_DRIFT: 'DEPLOYMENT_VERSION_DRIFT',
  ONLINE_VERSION_DRIFT: 'ONLINE_VERSION_DRIFT',
});

export function comparePagesVersions({
  masterCommit,
  deployedCommit,
  expectedVersion,
  onlineVersion,
}) {
  const drift = [];
  if (deployedCommit && masterCommit !== deployedCommit)
    drift.push(HEALTH_FAILURE_CODES.DEPLOYMENT_VERSION_DRIFT);
  if (onlineVersion && expectedVersion !== onlineVersion)
    drift.push(HEALTH_FAILURE_CODES.ONLINE_VERSION_DRIFT);
  return { healthy: drift.length === 0, drift };
}

export function retryCommandIsAllowed(errorCode) {
  return ['TEMPORARY_SERVER_ERROR', 'TIMEOUT', 'NETWORK_ERROR'].includes(
    errorCode,
  );
}
