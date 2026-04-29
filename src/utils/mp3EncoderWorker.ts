// Web Worker for MP3 encoding to avoid blocking the main thread

import lamejs from "@breezystack/lamejs";

interface EncoderMessage {
  leftChannel: Int16Array;
  rightChannel?: Int16Array;
  sampleRate: number;
  numChannels: number;
  kbps: number;
}

self.onmessage = (e: MessageEvent<EncoderMessage>) => {
  const { leftChannel, rightChannel, sampleRate, numChannels, kbps } = e.data;

  const mp3encoder = new lamejs.Mp3Encoder(numChannels, sampleRate, kbps);
  const mp3Data: Uint8Array[] = [];
  const sampleBlockSize = 1152;
  const totalSamples = leftChannel.length;
  let lastReportedPercent = 0;

  for (let i = 0; i < totalSamples; i += sampleBlockSize) {
    const leftChunk = leftChannel.subarray(i, i + sampleBlockSize);
    const mp3buf = numChannels > 1 && rightChannel
      ? mp3encoder.encodeBuffer(leftChunk, rightChannel.subarray(i, i + sampleBlockSize))
      : mp3encoder.encodeBuffer(leftChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }

    // Report progress every ~5%
    const percent = Math.round((i / totalSamples) * 100);
    if (percent >= lastReportedPercent + 5) {
      lastReportedPercent = percent;
      self.postMessage({ type: "progress", percent });
    }
  }

  const tail = mp3encoder.flush();
  if (tail.length > 0) {
    mp3Data.push(new Uint8Array(tail));
  }

  // Combine all chunks into one buffer
  const totalLength = mp3Data.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of mp3Data) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  (self as unknown as Worker).postMessage({ type: "done", buffer: combined.buffer }, [combined.buffer]);
};
