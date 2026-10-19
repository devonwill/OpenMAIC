/**
 * Provider-neutral voice-registration seam.
 *
 * The "auto voice" timbre-stability pattern — synthesize a voice-design once,
 * register it, then reference it by id — is not VoxCPM-specific. Any TTS
 * backend that can register/clone a voice (VoxCPM/vLLM-Omni today; ElevenLabs,
 * MiniMax, Doubao, … later) plugs in by implementing `VoiceRegistrationAdapter`
 * and registering it below. Server routes and the client orchestrator dispatch
 * by `providerId` and never name a concrete provider.
 */

import type { VoiceDesign } from '@/lib/audio/voice-design';
import { qwenVoiceCloneRegistrationAdapter } from '@/lib/audio/qwen-voice-clone-registration';
import { voxcpmVoiceRegistrationAdapter } from '@/lib/audio/voxcpm-registration';
import { xiaomiVoiceCloneRegistrationAdapter } from '@/lib/audio/xiaomi-voice-clone-registration';

/** Resolved backend connection for a registration call (server-injected for managed providers). */
export interface VoiceRegistrationConfig {
  baseUrl: string;
  apiKey?: string;
  model?: string;
  /**
   * `true` pins a client-supplied BYOK `baseUrl` to the strict public policy;
   * unset falls back to the process-wide `ALLOW_LOCAL_NETWORKS` behavior.
   */
  publicOnly?: boolean;
}

/**
 * A registered voice as the backend can enumerate it.
 *
 * `name` is the human label shown in the voice picker. Providers that enroll
 * by display name (voiceId === name) already carry it; local stores keep a
 * sidecar record because their filesystem-safe id cannot hold non-ASCII text.
 */
export interface RegisteredVoiceSummary {
  voiceId: string;
  name?: string;
  createdAt?: number;
}

export interface VoiceRegistrationAdapter {
  /** Whether registration is available for this provider given its options (e.g. backend kind). */
  supportsRegistration(options?: Record<string, unknown>): boolean;
  /** Whether the adapter can synthesize its own reference clip from a voice design. */
  supportsBootstrapReferenceClip?: boolean;
  /**
   * The model this adapter's registration flow uses (enrollment target or the
   * synthesis model behind a bootstrap clip), resolved provider-side.
   * `clientModel` is a caller-supplied TTS model hint; the adapter decides
   * whether (and how) to honor it. `undefined` when registration is model-less.
   */
  resolveRegistrationModel(clientModel?: string): string | undefined;
  /** Whether `voiceId` is registered, or `unknown` when the lookup is inconclusive. */
  voiceExists(
    cfg: VoiceRegistrationConfig,
    voiceId: string,
    signal?: AbortSignal,
  ): Promise<boolean | 'unknown'>;
  /** Register (or idempotently re-register) a reference clip under `voiceId`; returns the id. */
  registerVoice(
    cfg: VoiceRegistrationConfig,
    params: {
      voiceId: string;
      referenceAudioBase64: string;
      mimeType?: string;
      refText?: string;
      /** Display label for the picker; persists alongside id-only local stores. */
      name?: string;
    },
    signal?: AbortSignal,
  ): Promise<string>;
  /**
   * Enumerate voices already registered on the backend.
   *
   * Optional: only backends that can list their own enrollment (local reference
   * stores, list-capable vendors) implement it. Callers use it to keep the voice
   * picker complete across browsers — a voice registered once must stay visible
   * on every device, not only the one that enrolled it.
   */
  listVoices?(signal?: AbortSignal): Promise<RegisteredVoiceSummary[]>;
  /** Delete a provider-side registered voice, when supported. */
  deleteVoice?(cfg: VoiceRegistrationConfig, voiceId: string, signal?: AbortSignal): Promise<void>;
  /** Synthesize the voice design once into a reference clip. */
  bootstrapReferenceClip(
    cfg: VoiceRegistrationConfig,
    params: { design: VoiceDesign; language?: string },
    signal?: AbortSignal,
  ): Promise<{ referenceAudioBase64: string; mimeType: string }>;
}

/** providerId → adapter. The only seam to touch when adding a provider. */
const VOICE_REGISTRATION_ADAPTERS: Record<string, VoiceRegistrationAdapter> = {
  'qwen-tts': qwenVoiceCloneRegistrationAdapter,
  'voxcpm-tts': voxcpmVoiceRegistrationAdapter,
  'xiaomi-tts': xiaomiVoiceCloneRegistrationAdapter,
};

export function getVoiceRegistrationAdapter(
  providerId: string,
): VoiceRegistrationAdapter | undefined {
  return VOICE_REGISTRATION_ADAPTERS[providerId];
}

/** Whether this provider supports register-once/reference-by-id for the given options. */
export function supportsVoiceRegistration(
  providerId: string,
  options?: Record<string, unknown>,
): boolean {
  return getVoiceRegistrationAdapter(providerId)?.supportsRegistration(options) ?? false;
}

/**
 * Providers whose registered voices can be enumerated.
 *
 * Lets the picker ask "what is already registered?" in one request instead of
 * guessing which providers to probe — clients have no other way to know which
 * adapters implement listing.
 */
export function listProvidersWithVoiceListing(): string[] {
  return Object.keys(VOICE_REGISTRATION_ADAPTERS).filter(
    (providerId) => typeof VOICE_REGISTRATION_ADAPTERS[providerId].listVoices === 'function',
  );
}
