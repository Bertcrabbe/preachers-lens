import { audioBufferToMp3 } from "./audioCombiner";

/**
 * Download a list of audio URLs, decode them, concatenate back-to-back
 * (with a short silence between each), and encode the result to a single MP3.
 */
export async function concatRecordingsToMp3(
  urls: string[],
  onProgress?: (percent: number, status: string) => void,
  silenceMs = 400,
): Promise<Blob> {
  if (urls.length === 0) throw new Error("No recordings to combine");

  const audioContext = new AudioContext({ sampleRate: 44100 });
  try {
    const buffers: AudioBuffer[] = [];
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
      } catch (e) {
        console.warn(`Skipping clip ${i + 1}: decode failed`, e);
      }
      const pct = Math.round((i / urls.length) * 60);
      onProgress?.(pct, `Downloading clips ${i + 1}/${urls.length}…`);
    }

    if (buffers.length === 0) throw new Error("No clips could be decoded");

    const sampleRate = 44100;
    const silenceSamples = Math.floor((silenceMs / 1000) * sampleRate);
    const totalSamples =
      buffers.reduce((sum, b) => sum + Math.ceil(b.duration * sampleRate), 0) +
      silenceSamples * Math.max(0, buffers.length - 1);

    onProgress?.(65, "Stitching clips together…");
    const offline = new OfflineAudioContext(2, totalSamples, sampleRate);

    let cursor = 0;
    for (let i = 0; i < buffers.length; i++) {
      const src = offline.createBufferSource();
      src.buffer = buffers[i];
      src.connect(offline.destination);
      src.start(cursor / sampleRate);
      cursor += Math.ceil(buffers[i].duration * sampleRate);
      if (i < buffers.length - 1) cursor += silenceSamples;
    }

    const rendered = await offline.startRendering();
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