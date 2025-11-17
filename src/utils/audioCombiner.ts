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
    
    onProgress?.(60, "Combining audio tracks...");
    
    // Calculate total duration (sermon duration + all comment durations)
    const totalDuration = sermonBuffer.duration + 
      commentBuffers.reduce((sum, c) => sum + c.buffer.duration, 0);
    
    // Create offline context for rendering
    const offlineContext = new OfflineAudioContext(
      2, // stereo
      Math.ceil(totalDuration * 44100), // sample rate * duration
      44100
    );
    
    // Create and connect sermon source
    const sermonSource = offlineContext.createBufferSource();
    sermonSource.buffer = sermonBuffer;
    
    // Apply gain to sermon to make room for commentary
    const sermonGain = offlineContext.createGain();
    sermonGain.gain.value = 0.7; // Reduce sermon volume slightly when commentary plays
    sermonSource.connect(sermonGain);
    sermonGain.connect(offlineContext.destination);
    sermonSource.start(0);
    
    onProgress?.(70, "Inserting commentary...");
    
    // Create and schedule comment sources
    for (const comment of commentBuffers) {
      const commentSource = offlineContext.createBufferSource();
      commentSource.buffer = comment.buffer;
      
      const commentGain = offlineContext.createGain();
      commentGain.gain.value = 1.0; // Full volume for commentary
      commentSource.connect(commentGain);
      commentGain.connect(offlineContext.destination);
      
      // Start comment at its timestamp
      commentSource.start(comment.timestamp);
      
      // Duck sermon audio during commentary
      sermonGain.gain.setValueAtTime(0.7, comment.timestamp);
      sermonGain.gain.linearRampToValueAtTime(0.3, comment.timestamp + 0.1);
      sermonGain.gain.setValueAtTime(0.3, comment.timestamp + comment.buffer.duration);
      sermonGain.gain.linearRampToValueAtTime(0.7, comment.timestamp + comment.buffer.duration + 0.5);
    }
    
    onProgress?.(80, "Rendering combined audio...");
    
    // Render the combined audio
    const renderedBuffer = await offlineContext.startRendering();
    
    onProgress?.(90, "Encoding to MP3...");
    
    // Convert to WAV format (we'll use WAV instead of MP3 for browser compatibility)
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
  
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
