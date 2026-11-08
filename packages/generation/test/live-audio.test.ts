/**
 * The pure audio math behind live voice: float/PCM conversion and 16 kHz
 * downsampling. No microphone or AudioContext here; those need a browser.
 */
import { describe, expect, it } from 'vitest';
import { downsampleTo16kMono, floatToPcm16, LIVE_INPUT_CHUNK_SAMPLES, LiveCaptureResampler, pcm16ToFloat32 } from '../src/client/live-audio';

describe('live audio PCM conversion', () => {
  it('round-trips silence, full scale and a sine wave', () => {
    expect(floatToPcm16(new Float32Array([0, -0, 0]))).toEqual(new Int16Array([0, 0, 0]));
    expect(floatToPcm16(new Float32Array([1]))).toEqual(new Int16Array([32767]));
    expect(floatToPcm16(new Float32Array([-1]))).toEqual(new Int16Array([-32768]));
    const sine = new Float32Array(48);
    for (let i = 0; i < sine.length; i++) sine[i] = Math.sin((2 * Math.PI * i) / sine.length);
    const back = pcm16ToFloat32(new Uint8Array(floatToPcm16(sine).buffer));
    for (let i = 0; i < sine.length; i++) expect(Math.abs(back[i]! - sine[i]!)).toBeLessThan(1 / 32768 + 1e-6);
  });

  it('clamps out-of-range floats instead of wrapping', () => {
    expect(floatToPcm16(new Float32Array([2, -2, 99]))).toEqual(new Int16Array([32767, -32768, 32767]));
  });

  it('reads little-endian words from odd offsets', () => {
    // 0x0100 at offset 1: the view honors byteOffset, dropping trailing bytes.
    const bytes = new Uint8Array([9, 0, 1, 7]);
    const floats = pcm16ToFloat32(bytes.subarray(1));
    expect(floats.length).toBe(1);
    expect(floats[0]).toBeCloseTo(256 / 32768, 9);
  });
});

describe('live audio downsampling', () => {
  it('passes 16 kHz straight through to PCM', () => {
    const input = new Float32Array([0, 0.5, -0.5, 1, -1]);
    expect(downsampleTo16kMono(input, 16000)).toEqual(floatToPcm16(input));
  });

  it('halves 32 kHz with linear interpolation', () => {
    // A ramp: every output sample lands exactly on an input sample.
    const input = new Float32Array([0, 0.25, 0.5, 0.75]);
    const out = downsampleTo16kMono(input, 32000);
    expect(out.length).toBe(2);
    expect(out).toEqual(floatToPcm16(new Float32Array([0, 0.5])));
  });

  it('interpolates a 48 kHz sine to the right frequency', () => {
    // One second of 440 Hz at 48 kHz becomes one second of 440 Hz at 16 kHz.
    const input = new Float32Array(48000);
    for (let i = 0; i < input.length; i++) input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    const out = downsampleTo16kMono(input, 48000);
    expect(out.length).toBe(16000);
    const floats = new Float32Array(out.length);
    for (let i = 0; i < out.length; i++) floats[i] = out[i]! / 32768;
    // Zero crossings every half period: 880 per second at 440 Hz.
    let crossings = 0;
    for (let i = 1; i < floats.length; i++) if (floats[i - 1]! <= 0 !== floats[i]! <= 0) crossings++;
    expect(crossings).toBe(880);
  });

  it('rejects a bad rate and empties empty input', () => {
    expect(downsampleTo16kMono(new Float32Array(0), 48000).length).toBe(0);
    expect(() => downsampleTo16kMono(new Float32Array([0]), 0)).toThrow();
  });
});

describe('live capture resampler', () => {
  it('emits ~40 ms chunks and keeps boundaries continuous', () => {
    const resampler = new LiveCaptureResampler(48000);
    const second = new Float32Array(48000);
    for (let i = 0; i < second.length; i++) second[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    // Feed in worklet-sized 128-frame blocks, as the capture processor does.
    const chunks: Int16Array[] = [];
    for (let at = 0; at < second.length; at += 128) chunks.push(...resampler.push(second.slice(at, at + 128)));
    // One second at 16 kHz in 640-sample chunks: exactly 25 full chunks.
    expect(chunks.length).toBe(25);
    for (const chunk of chunks) expect(chunk.length).toBe(LIVE_INPUT_CHUNK_SAMPLES);
    const joined = new Int16Array(25 * LIVE_INPUT_CHUNK_SAMPLES);
    chunks.forEach((chunk, i) => joined.set(chunk, i * LIVE_INPUT_CHUNK_SAMPLES));
    const reference = downsampleTo16kMono(second, 48000);
    expect(joined.length).toBe(reference.length);
    for (let i = 0; i < joined.length; i++) expect(Math.abs(joined[i]! - reference[i]!)).toBeLessThanOrEqual(1);
  });

  it('returns nothing until a full chunk accumulates', () => {
    const resampler = new LiveCaptureResampler(16000);
    expect(resampler.push(new Float32Array(100))).toEqual([]);
    const chunks = resampler.push(new Float32Array(540));
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.length).toBe(LIVE_INPUT_CHUNK_SAMPLES);
  });
});
