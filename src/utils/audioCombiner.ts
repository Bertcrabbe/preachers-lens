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
    const sermonArrayBuffer = await sermonResponse.arrayBuffer();
    const sermonBuffer = await audioContext.decodeAudioData(sermonArrayBuffer);
    
    onProgress?.(30, "Downloading commentary audio...");
    
    // Fetch and decode all comment audios
    const commentBuffers: { buffer: AudioBuffer; timestamp: number }[] = [];
    for (let i = 0; i < commentAudios.length; i++) {
      const response = await fetch(commentAudios[i].url);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = await audioContext.decodeAudioData(arrayBuffer);
      commentBuffers.push({ 
        buffer, 
        timestamp: commentAudios[i].timestamp / 1000 // Convert ms to seconds
      });
      onProgress?.(30 + (30 / commentAudios.length) * (i + 1), `Processing commentary ${i + 1}/${commentAudios.length}...`);
    }
    
    // Sort comments by timestamp
    commentBuffers.sort((a, b) => a.timestamp - b.timestamp);
    
    onProgress?.(60, "Building audio segments...");
    
    // Calculate segments: sermon parts and commentary insertions
    const segments: { type: 'sermon' | 'comment'; start: number; end: number; commentIndex?: number }[] = [];
    let currentTime = 0;
    
    for (let i = 0; i < commentBuffers.length; i++) {
      const comment = commentBuffers[i];
      
      // Add sermon segment before this comment
      if (comment.timestamp > currentTime) {
        segments.push({
          type: 'sermon',
          start: currentTime,
          end: comment.timestamp
        });
      }
      
      // Add comment segment
      segments.push({
        type: 'comment',
        start: comment.timestamp,
        end: comment.timestamp + comment.buffer.duration,
        commentIndex: i
      });
      
      currentTime = comment.timestamp;
    }
    
    // Add final sermon segment after last comment
    if (currentTime < sermonBuffer.duration) {
      segments.push({
        type: 'sermon',
        start: currentTime,
        end: sermonBuffer.duration
      });
    }
    
    // Calculate total duration
    const totalDuration = segments.reduce((sum, seg) => {
      if (seg.type === 'sermon') {
        return sum + (seg.end - seg.start);
      } else {
        return sum + commentBuffers[seg.commentIndex!].buffer.duration;
      }
    }, 0);
    
    onProgress?.(70, "Creating combined audio...");
    
    // Create offline context for rendering
    const offlineContext = new OfflineAudioContext(
      2, // stereo
      Math.ceil(totalDuration * 44100),
      44100
    );
    
    let outputTime = 0;
    
    // Process each segment
    for (const segment of segments) {
      if (segment.type === 'sermon') {
        // Copy sermon segment
        const duration = segment.end - segment.start;
        const source = offlineContext.createBufferSource();
        source.buffer = sermonBuffer;
        source.connect(offlineContext.destination);
        source.start(outputTime, segment.start, duration);
        outputTime += duration;
      } else {
        // Insert comment
        const comment = commentBuffers[segment.commentIndex!];
        const source = offlineContext.createBufferSource();
        source.buffer = comment.buffer;
        source.connect(offlineContext.destination);
        source.start(outputTime);
        outputTime += comment.buffer.duration;
      }
    }
    
    onProgress?.(85, "Rendering combined audio...");
    
    // Render the combined audio
    const renderedBuffer = await offlineContext.startRendering();
    
    onProgress?.(95, "Encoding to WAV...");
    
    // Convert to WAV format
    const wavBlob = audioBufferToWav(renderedBuffer);
    
    onProgress?.(100, "Complete!");
    
    return wavBlob;
  } finally {
    await audioContext.close();
  }
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numberOfChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numberOfChannels * bytesPerSample;
  
  const data = new Float32Array(buffer.length * numberOfChannels);
  
  // Interleave channels
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i++) {
      data[i * numberOfChannels + channel] = channelData[i];
    }
  }
  
  const dataLength = data.length * bytesPerSample;
  const bufferLength = 44 + dataLength;
  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);
  
  // Write WAV header
  writeString(view, 0, 'RIFF');
  view.setUint32(4, bufferLength - 8, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);
  
  // Write audio data
  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }
  
  return new Blob([arrayBuffer], { type: 'audio/mpeg' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
