// Web Worker for waveform sampling — receives raw PCM float32 data

self.onmessage = (e: MessageEvent<{ rawData: Float32Array; samples: number }>) => {
  const { rawData, samples } = e.data;
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
};
