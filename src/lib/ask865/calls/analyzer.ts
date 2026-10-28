import "server-only";
import type { CallInput } from "./domain";
import { analyzeTranscript } from "./assessmentTransport";

export async function analyzeWithOpenAI(call: CallInput) {
  return analyzeTranscript(call, { apiKey: process.env.ASK865_CALLS_OPENAI_KEY ?? "", model: process.env.ASK865_CALLS_MODEL ?? "" });
}
