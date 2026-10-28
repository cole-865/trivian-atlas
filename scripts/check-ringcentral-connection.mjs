// Node 22.18+; credentials come only from the process environment / a protected env file.
// No audio, database writes, n8n requests, or third-party analysis occur here.
import { RingCentralClient, RingCentralError, checkRingCentralConnection, ringCentralConfig, ringCentralEnvironmentKeys } from '../src/lib/ask865/calls/ringcentral.ts';

const missing = ringCentralEnvironmentKeys.filter(key => !process.env[key]?.trim());
if (missing.length) {
  console.log(JSON.stringify({ status: 'not_configured', missing, liveRequestMade: false }, null, 2));
  process.exitCode = 2;
} else {
  try {
    const result = await checkRingCentralConnection(new RingCentralClient(ringCentralConfig(process.env)));
    console.log(JSON.stringify(result, null, 2));
    if (!result.windowComplete || result.recordingMetadataAccess !== 'verified') process.exitCode = 3;
  } catch (error) {
    console.log(JSON.stringify({ status: 'failed', code: error instanceof RingCentralError ? error.code : 'unexpected_failure', retryAfterSeconds: error instanceof RingCentralError ? error.retryAfterSeconds : undefined }, null, 2));
    process.exitCode = 1;
  }
}
