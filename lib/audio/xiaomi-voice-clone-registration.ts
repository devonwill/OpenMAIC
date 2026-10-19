/**
 * Xiaomi MiMo voice-clone registration adapter.
 *
 * Unlike Qwen enrollment, Xiaomi's `mimo-v2.5-tts-voiceclone` model is
 * stateless: every synthesis call carries the reference audio inline as a
 * DataURL and the provider has no voice-management endpoints (no list/get/
 * delete). Registration therefore persists locally — the reference clip is
 * stored under `data/voice-refs/xiaomi/` and the returned voice id is a local
 * index that `generateXiaomiTTS` resolves back to a DataURL at synthesis time.
 */

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { XIAOMI_TTS_VOICE_CLONE_MODEL } from '@/lib/audio/constants';
import { QwenVoiceCloneError } from '@/lib/audio/qwen-voice-clone';
import { validateReferenceAudio } from '@/lib/audio/wav-validate';
import type {
  RegisteredVoiceSummary,
  VoiceRegistrationAdapter,
  VoiceRegistrationConfig,
} from '@/lib/audio/voice-registration';

const REFERENCE_DIR = path.join(process.cwd(), 'data', 'voice-refs', 'xiaomi');
/** Sidecar of display labels — the filesystem id cannot hold non-ASCII names. */
const INDEX_FILE = path.join(REFERENCE_DIR, 'index.json');

interface StoredVoiceMeta {
  name?: string;
  createdAt?: number;
}

/**
 * Deterministic filesystem-safe path per voice id. The readable prefix is
 * sanitized (no separators, no traversal) and the id hash disambiguates
 * voices that sanitize to the same prefix.
 */
function referenceFilePath(voiceId: string): string {
  const hash = createHash('sha256').update(voiceId).digest('hex').slice(0, 16);
  const readable = voiceId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48) || 'voice';
  return path.join(REFERENCE_DIR, `${readable}-${hash}.wav`);
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

async function readIndex(): Promise<Record<string, StoredVoiceMeta>> {
  try {
    const parsed = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, StoredVoiceMeta>) : {};
  } catch {
    // 首次使用或文件损坏都按「无元数据」处理：清单接口不能因此失败。
    return {};
  }
}

async function rememberVoiceMeta(voiceId: string, name?: string): Promise<void> {
  const index = await readIndex();
  const existing = index[voiceId];
  index[voiceId] = {
    ...existing,
    ...(name?.trim() ? { name: name.trim() } : {}),
    createdAt: existing?.createdAt ?? Date.now(),
  };
  await mkdir(REFERENCE_DIR, { recursive: true });
  await writeFile(INDEX_FILE, JSON.stringify(index, null, 2));
}

/**
 * Recover the id from a stored `readable-hash.wav` name.
 *
 * The hash covers the original voice id, so a match proves the readable prefix
 * IS the full id (true for ASCII ids, false once sanitisation truncated or
 * replaced characters). That lets pre-metadata clips be listed again without
 * ever guessing a wrong id — which would synthesize nothing.
 */
function parseVoiceIdFromFileName(file: string): string | undefined {
  const match = /^(.+)-([0-9a-f]{16})\.wav$/.exec(file);
  if (!match) return undefined;
  const [, readable, hash] = match;
  const digest = createHash('sha256').update(readable).digest('hex').slice(0, 16);
  return digest === hash ? readable : undefined;
}

/** Enumerate stored clips so the picker stays complete across browsers. */
async function listVoices(signal?: AbortSignal): Promise<RegisteredVoiceSummary[]> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  const index = await readIndex();
  let files: string[] = [];
  try {
    files = await readdir(REFERENCE_DIR);
  } catch {
    return [];
  }
  const voices = new Map<string, RegisteredVoiceSummary>();
  for (const [voiceId, meta] of Object.entries(index)) {
    // A reference clip removed server-side must not keep showing up as choosable.
    try {
      await stat(referenceFilePath(voiceId));
    } catch {
      continue;
    }
    voices.set(voiceId, { voiceId, name: meta.name, createdAt: meta.createdAt });
  }
  for (const file of files) {
    if (!file.endsWith('.wav')) continue;
    const voiceId = parseVoiceIdFromFileName(file);
    if (!voiceId || voices.has(voiceId)) continue;
    voices.set(voiceId, { voiceId });
  }
  return [...voices.values()];
}

/** Persist the validated reference clip locally and return the local voice id. */
async function registerVoice(
  _cfg: VoiceRegistrationConfig,
  params: {
    voiceId: string;
    referenceAudioBase64: string;
    mimeType?: string;
    refText?: string;
    name?: string;
  },
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) return Promise.reject(signal.reason);

  const audio = decodeBase64(params.referenceAudioBase64);
  validateReferenceAudio(audio);

  const target = referenceFilePath(params.voiceId);
  await mkdir(path.dirname(target), { recursive: true });
  // Write-temp-then-rename so a concurrent synthesis never reads a partial clip.
  const temp = `${target}.tmp-${process.pid}`;
  await writeFile(temp, audio);
  await rename(temp, target);
  // 显示名与参考音频同批落盘：换浏览器后仍能显示中文名，而非文件名哈希。
  await rememberVoiceMeta(params.voiceId, params.name);
  if (signal?.aborted) return Promise.reject(signal.reason);
  return params.voiceId;
}

/**
 * Xiaomi exposes no provider-side voice lookup, so existence is answered from
 * the local reference store (authoritative for this stateless scheme).
 */
async function voiceExists(
  _cfg: VoiceRegistrationConfig,
  voiceId: string,
  signal?: AbortSignal,
): Promise<boolean | 'unknown'> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  try {
    await stat(referenceFilePath(voiceId));
    return true;
  } catch {
    return false;
  }
}

/** Xiaomi enrollment always needs a real reference sample; no design bootstrap. */
async function bootstrapReferenceClip(): Promise<never> {
  throw new QwenVoiceCloneError('QWEN_VC_BOOTSTRAP_UNSUPPORTED', 400);
}

/** Registration persists locally; the clone model is fixed regardless of caller hints. */
function resolveRegistrationModel(_clientModel?: string): string {
  return XIAOMI_TTS_VOICE_CLONE_MODEL;
}

export const xiaomiVoiceCloneRegistrationAdapter: VoiceRegistrationAdapter = {
  supportsRegistration: () => true,
  supportsBootstrapReferenceClip: false,
  resolveRegistrationModel,
  voiceExists,
  registerVoice,
  listVoices,
  bootstrapReferenceClip,
};

/**
 * Resolve a registered local voice id back to the DataURL the stateless
 * `mimo-v2.5-tts-voiceclone` model expects; `undefined` when no reference
 * clip is stored (voice not registered).
 */
export async function readXiaomiVoiceReferenceDataUrl(
  voiceId: string,
): Promise<string | undefined> {
  try {
    const bytes = await readFile(referenceFilePath(voiceId));
    if (!bytes.byteLength) return undefined;
    return `data:audio/wav;base64,${bytes.toString('base64')}`;
  } catch {
    return undefined;
  }
}

/** Test hook: drop a stored reference clip. */
export async function removeXiaomiVoiceReferenceForTests(voiceId: string): Promise<void> {
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(referenceFilePath(voiceId));
  } catch {
    // Missing file is fine for a test cleanup helper.
  }
}
