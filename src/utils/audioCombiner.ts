// lamejs is imported dynamically to avoid blocking the build

export async function combineAudioFiles(
  sermonAudioUrl: string,
  commentAudios: { url: string; timestamp: number }[],
  onProgress?: (progress: number, status: string) => void
): Promise<Blob> {
  const audioContext = new AudioContext({ sampleRate: 44100 });
  
  try {
    onProgress?.(10, "Downloading sermon audio...");
    
    // Fetch and decode sermon audio
    const sermonResponse = await fetch(sermonAudioUrl);
    if (!sermonResponse.ok) {
      throw new Error(`Failed to download sermon audio (${sermonResponse.status})`);
    }
    const sermonArrayBuffer = await sermonResponse.arrayBuffer();
    if (sermonArrayBuffer.byteLength === 0) {
      throw new Error("Sermon audio file is empty");
    }
    let sermonBuffer: AudioBuffer;
    try {
      sermonBuffer = await audioContext.decodeAudioData(sermonArrayBuffer);
    } catch (e) {
      throw new Error("Could not decode sermon audio. The file format may not be supported.");
    }
    
    onProgress?.(30, "Downloading commentary audio...");
    
    // Fetch and decode all comment audios
    const commentBuffers: { buffer: AudioBuffer; timestamp: number }[] = [];
    for (let i = 0; i < commentAudios.length; i++) {
      const response = await fetch(commentAudios[i].url);
      if (!response.ok) {
        console.warn(`Skipping comment ${i + 1}: download failed (${response.status})`);
        continue;
      }
      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength === 0) {
        console.warn(`Skipping comment ${i + 1}: empty file`);
        continue;
      }
      try {
        const buffer = await audioContext.decodeAudioData(arrayBuffer);
        commentBuffers.push({ 
          buffer, 
          timestamp: commentAudios[i].timestamp / 1000
        });
      } catch (e) {
        console.warn(`Skipping comment ${i + 1}: unable to decode audio`, e);
      }
      onProgress?.(30 + (30 / commentAudios.length) * (i + 1), `Processing commentary ${i + 1}/${commentAudios.length}...`);
    }
    
    if (commentBuffers.length === 0) {
      throw new Error("None of the audio comments could be decoded. Try re-recording them.");
    }
    
    // Sort comments by timestamp
    commentBuffers.sort((a, b) => a.timestamp - b.timestamp);
    
    onProgress?.(60, "Building audio segments...");
    
    // Calculate segments: sermon parts and commentary insertions
    const segments: { type: 'sermon' | 'comment'; start: number; end: number; commentIndex?: number }[] = [];
    let currentTime = 0;
    
    for (let i = 0; i < commentBuffers.length; i++) {
      const comment = commentBuffers[i];
      
      if (comment.timestamp > currentTime) {
        segments.push({ type: 'sermon', start: currentTime, end: comment.timestamp });
      }
      
      segments.push({
        type: 'comment',
        start: comment.timestamp,
        end: comment.timestamp + comment.buffer.duration,
        commentIndex: i
      });
      
      currentTime = comment.timestamp;
    }
    
    if (currentTime < sermonBuffer.duration) {
      segments.push({ type: 'sermon', start: currentTime, end: sermonBuffer.duration });
    }
    
    const totalDuration = segments.reduce((sum, seg) => {
      if (seg.type === 'sermon') {
        return sum + (seg.end - seg.start);
      } else {
        return sum + commentBuffers[seg.commentIndex!].buffer.duration;
      }
    }, 0);
    
    onProgress?.(70, "Creating combined audio...");
    
    const offlineContext = new OfflineAudioContext(2, Math.ceil(totalDuration * 44100), 44100);
    
    let outputTime = 0;
    for (const segment of segments) {
      if (segment.type === 'sermon') {
        const duration = segment.end - segment.start;
        const source = offlineContext.createBufferSource();
        source.buffer = sermonBuffer;
        source.connect(offlineContext.destination);
        source.start(outputTime, segment.start, duration);
        outputTime += duration;
      } else {
        const comment = commentBuffers[segment.commentIndex!];
        const source = offlineContext.createBufferSource();
        source.buffer = comment.buffer;
        source.connect(offlineContext.destination);
        source.start(outputTime);
        outputTime += comment.buffer.duration;
      }
    }
    
    onProgress?.(85, "Rendering combined audio...");
    const renderedBuffer = await offlineContext.startRendering();
    
    onProgress?.(90, "Encoding to MP3 (this may take a moment)...");
    const mp3Blob = await audioBufferToMp3Worker(renderedBuffer, (encodePercent) => {
      // Map encoding progress from 90% to 99%
      const overall = 90 + (encodePercent / 100) * 9;
      onProgress?.(Math.round(overall), `Encoding to MP3... ${encodePercent}%`);
    });
    
    onProgress?.(100, "Complete!");
    return mp3Blob;
  } finally {
    await audioContext.close();
  }
}

function convertFloat32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}

async function audioBufferToMp3Worker(
  buffer: AudioBuffer,
  onEncodeProgress?: (percent: number) => void
): Promise<Blob> {
  const left = convertFloat32ToInt16(buffer.getChannelData(0));
  const right = buffer.numberOfChannels > 1
    ? convertFloat32ToInt16(buffer.getChannelData(1))
    : left;

  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./mp3EncoderWorker.ts', import.meta.url),
      { type: 'module' }
    );

    worker.onmessage = (e) => {
      if (e.data.type === 'progress') {
        onEncodeProgress?.(e.data.percent);
      } else if (e.data.type === 'done') {
        const mp3Blob = new Blob([e.data.buffer], { type: 'audio/mpeg' });
        worker.terminate();
        resolve(mp3Blob);
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(`MP3 encoding worker failed: ${err.message}`));
    };

    // Transfer the buffers to avoid copying
    worker.postMessage(
      {
        leftChannel: left,
        rightChannel: right,
        sampleRate: buffer.sampleRate,
        numChannels: buffer.numberOfChannels,
        kbps: 192,
      },
      [left.buffer, right.buffer]
    );
  });
}
