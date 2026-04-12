// Web Worker for waveform generation — keeps main thread responsive

self.onmessage = async (e: MessageEvent<ArrayBuffer>) => {
  try {
    const arrayBuffer = e.data;
    const audioContext = new OfflineAudioContext(1, 1, 44100);
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    const rawData = audioBuffer.getChannelData(0);
    const samples = 2000;
    const blockSize = Math.floor(rawData.length / samples);
    const filteredData = new Float32Array(samples);

    for (let i = 0; i < samples; i++) {
      const blockStart = blockSize * i;
      let sum = 0;
      for (let j = 0; j < blockSize; j++) {
        sum += Math.abs(rawData[blockStart + j]);
      }
      filteredData[i] = sum / blockSize;
    }

    // Normalize
    let max = 0;
    for (let i = 0; i < samples; i++) {
      if (filteredData[i] > max) max = filteredData[i];
    }
    if (max > 0) {
      for (let i = 0; i < samples; i++) {
        filteredData[i] /= max;
      }
    }

    self.postMessage({ type: 'done', data: Array.from(filteredData) });
  } catch (err: any) {
    self.postMessage({ type: 'error', message: err?.message || 'Unknown error' });
  }
};
