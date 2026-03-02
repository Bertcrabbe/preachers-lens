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
    
    onProgress?.(90, "Encoding to MP3...");
    const mp3Blob = await audioBufferToMp3(renderedBuffer);
    
    onProgress?.(100, "Complete!");
    return mp3Blob;
  } finally {
    await audioContext.close();
  }
}

async function audioBufferToMp3(buffer: AudioBuffer): Promise<Blob> {
  const lamejs = await import("@breezystack/lamejs");
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const kbps = 192;

  const mp3encoder = new lamejs.default.Mp3Encoder(numChannels, sampleRate, kbps);
  const mp3Data: Uint8Array[] = [];

  const left = convertFloat32ToInt16(buffer.getChannelData(0));
  const right = numChannels > 1
    ? convertFloat32ToInt16(buffer.getChannelData(1))
    : left;

  const sampleBlockSize = 1152;
  for (let i = 0; i < left.length; i += sampleBlockSize) {
    const leftChunk = left.subarray(i, i + sampleBlockSize);
    const rightChunk = right.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }

  const tail = mp3encoder.flush();
  if (tail.length > 0) {
    mp3Data.push(new Uint8Array(tail));
  }

  return new Blob(mp3Data as unknown as BlobPart[], { type: 'audio/mpeg' });
}

function convertFloat32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return int16;
}
