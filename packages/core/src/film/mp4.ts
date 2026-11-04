/**
 * A minimal MP4 muxer: one H.264/VP8/VP9 video track and an optional AAC audio
 * track, written ftyp + mdat + moov with 32-bit offsets. Data only, no DOM:
 * the export pipeline feeds it encoder outputs, tests feed it synthetic
 * samples. One chunk per track, no edit lists, no composition offsets — the
 * export encoders run latencyMode realtime, so decode order equals
 * presentation order. Deterministic: zero creation times, so the same samples
 * mux to the same bytes.
 */

export type Mp4VideoCodec = 'avc' | 'vp09' | 'vp08';

/** One encoded video frame, in decode order. The first must be a keyframe. */
export interface Mp4VideoSample {
  readonly data: Uint8Array;
  readonly keyframe: boolean;
}

export interface Mp4VideoTrack {
  readonly codec: Mp4VideoCodec;
  readonly width: number;
  readonly height: number;
  /** Frames per second; must divide the video timescale exactly. */
  readonly fps: number;
  /** Codec extradata: the avcC record for H.264 (VP tracks write a generic vpcC). */
  readonly description: Uint8Array;
  readonly samples: readonly Mp4VideoSample[];
}

export interface Mp4AudioTrack {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  /** The AudioSpecificConfig, two bytes for AAC-LC. */
  readonly description: Uint8Array;
  /** One AAC frame per sample, 1024 samples each. */
  readonly samples: readonly Uint8Array[];
  readonly bitrate?: number;
}

/** The video track's timescale: every export frame rate divides it exactly. */
export const MP4_VIDEO_TIMESCALE = 90000;

/** The movie header's timescale, in milliseconds. */
export const MP4_MVHD_TIMESCALE = 1000;

function u16(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function u24(value: number): Uint8Array {
  return new Uint8Array([(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function fourcc(code: string): Uint8Array {
  return new Uint8Array([code.charCodeAt(0), code.charCodeAt(1), code.charCodeAt(2), code.charCodeAt(3)]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const body = concat(payloads);
  return concat([u32(8 + body.length), fourcc(type), body]);
}

function fullbox(type: string, version: number, flags: number, ...payloads: Uint8Array[]): Uint8Array {
  return box(type, new Uint8Array([version]), u24(flags), ...payloads);
}

const IDENTITY_MATRIX = concat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

function mvhd(durationMs: number, nextTrackId: number): Uint8Array {
  return fullbox(
    'mvhd',
    0,
    0,
    u32(0),
    u32(0),
    u32(MP4_MVHD_TIMESCALE),
    u32(durationMs),
    u32(0x00010000),
    u16(0x0100),
    u16(0),
    u32(0),
    u32(0),
    IDENTITY_MATRIX,
    concat([u32(0), u32(0), u32(0), u32(0), u32(0), u32(0)]),
    u32(nextTrackId),
  );
}

function tkhd(trackId: number, durationMs: number, width: number, height: number, volume: number): Uint8Array {
  return fullbox(
    'tkhd',
    0,
    3,
    u32(0),
    u32(0),
    u32(trackId),
    u32(0),
    u32(durationMs),
    u32(0),
    u32(0),
    u16(0),
    u16(0),
    u16(volume),
    u16(0),
    IDENTITY_MATRIX,
    u32(width * 65536),
    u32(height * 65536),
  );
}

function mdhd(timescale: number, duration: number): Uint8Array {
  return fullbox('mdhd', 0, 0, u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0));
}

function hdlr(handler: string, name: string): Uint8Array {
  const text = new TextEncoder().encode(name);
  return fullbox('hdlr', 0, 0, u32(0), fourcc(handler), u32(0), u32(0), u32(0), text, new Uint8Array([0]));
}

function dinf(): Uint8Array {
  return box('dinf', fullbox('dref', 0, 0, u32(1), fullbox('url ', 0, 1)));
}

/**
 * A generic vpcC for VP8/VP9: profile 0, level 4.1, 8-bit 4:2:0, unspecified
 * colour. VP decoders read their parameters from the bitstream; the box only
 * needs to parse, which these values do for every export resolution.
 */
function vpcc(): Uint8Array {
  return fullbox('vpcC', 1, 0, new Uint8Array([0, 41, 0x82, 2, 2, 2]), u16(0));
}

function visualEntry(codec: string, width: number, height: number, child: Uint8Array): Uint8Array {
  return box(
    codec,
    new Uint8Array(6),
    u16(1),
    new Uint8Array(16),
    u16(width),
    u16(height),
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1),
    new Uint8Array(32),
    u16(0x18),
    u16(0xffff),
    child,
  );
}

function soundEntry(channels: number, sampleRate: number, child: Uint8Array): Uint8Array {
  return box('mp4a', new Uint8Array(6), u16(1), new Uint8Array(8), u16(channels), u16(16), u16(0), u16(0), u32(sampleRate * 65536), child);
}

/** An ESDS wrapping the AudioSpecificConfig; lengths are short-form (both descriptors stay under 128 bytes). */
function esds(asc: Uint8Array, bitrate: number): Uint8Array {
  const dsiLen = 2 + asc.length;
  const dcdLen = 13 + dsiLen + 3;
  const esLen = 3 + 2 + dcdLen;
  if (esLen >= 128 || dcdLen >= 128) throw new Error('The audio description is too long for short-form ESDS lengths');
  return fullbox(
    'esds',
    0,
    0,
    new Uint8Array([0x03, esLen]),
    u16(1),
    new Uint8Array([0x00, 0x04, dcdLen, 0x40, 0x15, 0x00, 0x00, 0x00]),
    u32(bitrate),
    u32(bitrate),
    new Uint8Array([0x05, asc.length]),
    asc,
    new Uint8Array([0x06, 0x01, 0x02]),
  );
}

function stts(entries: ReadonlyArray<readonly [number, number]>): Uint8Array {
  return fullbox('stts', 0, 0, u32(entries.length), ...entries.flatMap(([count, delta]) => [u32(count), u32(delta)]));
}

function stsc(samplesPerChunk: number): Uint8Array {
  return fullbox('stsc', 0, 0, u32(1), u32(1), u32(samplesPerChunk), u32(1));
}

function stsz(sizes: readonly number[]): Uint8Array {
  return fullbox('stsz', 0, 0, u32(0), u32(sizes.length), ...sizes.map((size) => u32(size)));
}

function stco(offset: number): Uint8Array {
  if (offset > 0xffffffff) throw new Error('The export is too large for 32-bit chunk offsets');
  return fullbox('stco', 0, 0, u32(1), u32(offset));
}

function stss(keyframes: readonly number[]): Uint8Array {
  return fullbox('stss', 0, 0, u32(keyframes.length), ...keyframes.map((sample) => u32(sample)));
}

function videoSampleEntry(track: Mp4VideoTrack): Uint8Array {
  if (track.codec === 'avc') return visualEntry('avc1', track.width, track.height, box('avcC', track.description));
  return visualEntry(track.codec, track.width, track.height, vpcc());
}

function videoTrak(track: Mp4VideoTrack, chunkOffset: number): { readonly trak: Uint8Array; readonly seconds: number } {
  const delta = MP4_VIDEO_TIMESCALE / track.fps;
  const stblParts: Uint8Array[] = [
    fullbox('stsd', 0, 0, u32(1), videoSampleEntry(track)),
    stts([[track.samples.length, delta]]),
    stsc(track.samples.length),
    stsz(track.samples.map((sample) => sample.data.length)),
    stco(chunkOffset),
  ];
  const keyframes = track.samples.flatMap((sample, i) => (sample.keyframe ? [i + 1] : []));
  // All-keyframe tracks need no sync table: every sample is a sync sample.
  if (keyframes.length > 0 && keyframes.length < track.samples.length) stblParts.push(stss(keyframes));
  const seconds = (track.samples.length * delta) / MP4_VIDEO_TIMESCALE;
  const durationMs = Math.round(seconds * MP4_MVHD_TIMESCALE);
  return {
    seconds,
    trak: box(
      'trak',
      tkhd(1, durationMs, track.width, track.height, 0),
      box('mdia', mdhd(MP4_VIDEO_TIMESCALE, track.samples.length * delta), hdlr('vide', 'Video'), box('minf', fullbox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), dinf(), box('stbl', ...stblParts))),
    ),
  };
}

function audioTrak(track: Mp4AudioTrack, chunkOffset: number): { readonly trak: Uint8Array; readonly seconds: number } {
  const bitrate = track.bitrate ?? Math.max(8000, Math.round((track.samples.reduce((sum, sample) => sum + sample.length, 0) * 8 * track.sampleRate) / Math.max(1, track.samples.length * 1024)));
  const seconds = (track.samples.length * 1024) / track.sampleRate;
  const durationMs = Math.round(seconds * MP4_MVHD_TIMESCALE);
  return {
    seconds,
    trak: box(
      'trak',
      tkhd(2, durationMs, 0, 0, 0x0100),
      box(
        'mdia',
        mdhd(track.sampleRate, track.samples.length * 1024),
        hdlr('soun', 'Sound'),
        box('minf', fullbox('smhd', 0, 0, u16(0), u16(0)), dinf(), box('stbl', fullbox('stsd', 0, 0, u32(1), soundEntry(track.channels, track.sampleRate, esds(track.description, bitrate))), stts([[track.samples.length, 1024]]), stsc(track.samples.length), stsz(track.samples.map((sample) => sample.length)), stco(chunkOffset))),
      ),
    ),
  };
}

/**
 * Muxes encoded samples into one MP4: ftyp, the samples in mdat (video, then
 * audio), then moov with the sample tables. Throws on empty tracks, odd
 * dimensions, an empty description, or a video track that does not open with
 * a keyframe — each would write a file no player accepts.
 */
export function muxMp4(video: Mp4VideoTrack, audio?: Mp4AudioTrack): Uint8Array {
  if (!Number.isInteger(video.width) || video.width < 2 || video.width % 2 !== 0 || !Number.isInteger(video.height) || video.height < 2 || video.height % 2 !== 0) {
    throw new Error(`The video size must be even dimensions, not ${video.width}x${video.height}`);
  }
  if (!Number.isInteger(video.fps) || video.fps <= 0 || MP4_VIDEO_TIMESCALE % video.fps !== 0) {
    throw new Error(`The frame rate must divide ${MP4_VIDEO_TIMESCALE}, not ${video.fps}`);
  }
  if (video.samples.length === 0) throw new Error('The video track needs at least one sample');
  // H.264 carries its avcC from the encoder; VP tracks take the muxer's generic vpcC.
  if (video.codec === 'avc' && video.description.length === 0) throw new Error('The video track needs its codec description');
  if (!video.samples[0]?.keyframe) throw new Error('The video track must open with a keyframe');
  if (video.samples.some((sample) => sample.data.length === 0)) throw new Error('Video samples must carry bytes');
  if (audio) {
    if (audio.samples.length === 0) throw new Error('The audio track needs at least one sample');
    if (audio.description.length === 0) throw new Error('The audio track needs its AudioSpecificConfig');
    if (audio.channels !== 1 && audio.channels !== 2) throw new Error('The audio track must be mono or stereo');
    if (!Number.isInteger(audio.sampleRate) || audio.sampleRate <= 0) throw new Error('The audio track needs its sample rate');
    if (audio.samples.some((sample) => sample.length === 0)) throw new Error('Audio samples must carry bytes');
  }
  const brands = video.codec === 'avc' ? ['isom', 'iso2', 'avc1', 'mp41'] : ['isom', 'iso2', 'mp41'];
  const ftyp = box('ftyp', fourcc('isom'), u32(0), ...brands.map((brand) => fourcc(brand)));
  const videoBytes = video.samples.reduce((sum, sample) => sum + sample.data.length, 0);
  const videoOffset = ftyp.length + 8;
  const audioOffset = videoOffset + videoBytes;
  const mdat = box('mdat', ...video.samples.map((sample) => sample.data), ...(audio ? audio.samples : []));
  const videoTrakBox = videoTrak(video, videoOffset);
  const audioTrakBox = audio ? audioTrak(audio, audioOffset) : null;
  const durationMs = Math.max(Math.round(videoTrakBox.seconds * MP4_MVHD_TIMESCALE), audioTrakBox ? Math.round(audioTrakBox.seconds * MP4_MVHD_TIMESCALE) : 0);
  const moov = box('moov', mvhd(durationMs, audio ? 3 : 2), videoTrakBox.trak, ...(audioTrakBox ? [audioTrakBox.trak] : []));
  return concat([ftyp, mdat, moov]);
}

/** One top-level box: its type, byte range and size, for tests and export validation. */
export interface Mp4Box {
  readonly type: string;
  readonly start: number;
  readonly size: number;
}

/**
 * Walks a buffer's top-level boxes. Stops at the first truncated header or
 * impossible size; what it returns parsed cleanly.
 */
export function listTopLevelBoxes(bytes: Uint8Array): Mp4Box[] {
  const out: Mp4Box[] = [];
  let at = 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (at + 8 <= bytes.length) {
    const size = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    if (size < 8 || at + size > bytes.length) break;
    out.push({ type, start: at, size });
    at += size;
  }
  return out;
}
