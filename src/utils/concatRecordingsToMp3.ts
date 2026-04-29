import { audioBufferToMp3 } from "./audioCombiner";

/**
 * Download a list of audio URLs, decode them, concatenate back-to-back
 * (with a short silence between each), and encode the result to a single MP3.
 *
 * Caps total duration (default ~10 min) so we don't blow up OfflineAudioContext
 * memory when there are hundreds of clips. ElevenLabs voice cloning only needs
 * a few minutes of clean audio anyway.
 */
export async function concatRecordingsToMp3(
  urls: string[],
  onProgress?: (percent: number, status: string) => void,
  silenceMs = 400,
  maxTotalSeconds = 600,
): Promise<Blob> {
  if (urls.length === 0) throw new Error("No recordings to combine");

  const audioContext = new AudioContext({ sampleRate: 44100 });
  try {
    const buffers: AudioBuffer[] = [];
    let accumulatedSeconds = 0;
    for (let i = 0; i < urls.length; i++) {
      try {
        const resp = await fetch(urls[i]);
        if (!resp.ok) {
          console.warn(`Skipping clip ${i + 1}: HTTP ${resp.status}`);
          continue;
        }
        const ab = await resp.arrayBuffer();
        if (ab.byteLength < 100) {
          console.warn(`Skipping clip ${i + 1}: empty`);
          continue;
        }
        const buf = await audioContext.decodeAudioData(ab);
        buffers.push(buf);
        accumulatedSeconds += buf.duration + silenceMs / 1000;
      } catch (e) {
        console.warn(`Skipping clip ${i + 1}: decode failed`, e);
      }
      const pct = Math.round((i / urls.length) * 60);
      onProgress?.(pct, `Downloading clips ${i + 1}/${urls.length}…`);
      if (accumulatedSeconds >= maxTotalSeconds) {
        console.info(
          `Reached ${Math.round(accumulatedSeconds)}s of audio after ${buffers.length} clips — stopping (cap ${maxTotalSeconds}s).`,
        );
        break;
      }
    }

    if (buffers.length === 0) throw new Error("No clips could be decoded");

    const sampleRate = 44100;
    const silenceSamples = Math.floor((silenceMs / 1000) * sampleRate);
    const totalSamples =
      buffers.reduce((sum, b) => sum + Math.ceil(b.duration * sampleRate), 0) +
      silenceSamples * Math.max(0, buffers.length - 1);

    onProgress?.(65, `Stitching ${buffers.length} clips together…`);

    // Render to MONO to halve memory (voice clone doesn't benefit from stereo).
    let rendered: AudioBuffer;
    try {
      const offline = new OfflineAudioContext(1, totalSamples, sampleRate);
      let cursor = 0;
      for (let i = 0; i < buffers.length; i++) {
        const src = offline.createBufferSource();
        src.buffer = buffers[i];
        src.connect(offline.destination);
        src.start(cursor / sampleRate);
        cursor += Math.ceil(buffers[i].duration * sampleRate);
        if (i < buffers.length - 1) cursor += silenceSamples;
      }
      rendered = await offline.startRendering();
    } catch (e) {
      console.error("OfflineAudioContext rendering failed", e);
      throw new Error(
        `Could not stitch ${buffers.length} clips (~${Math.round(totalSamples / sampleRate)}s). Try fewer clips.`,
      );
    }

    onProgress?.(80, "Encoding to MP3…");
    const mp3 = await audioBufferToMp3(rendered, (p) => {
      onProgress?.(80 + Math.round(p * 0.2), `Encoding to MP3… ${p}%`);
    });
    onProgress?.(100, "Done!");
    return mp3;
  } finally {
    await audioContext.close();
  }
}