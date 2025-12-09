import { useState, useEffect } from "react";

export interface AudioDevice {
  deviceId: string;
  label: string;
}

export const useMicrophoneSelector = () => {
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadAudioDevices();
    
    // Listen for device changes (e.g., plugging in a new mic)
    navigator.mediaDevices.addEventListener('devicechange', loadAudioDevices);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', loadAudioDevices);
    };
  }, []);

  const getPreferredMicrophone = (audioInputs: AudioDevice[]): string | undefined => {
    console.log('Available audio inputs:', audioInputs.map(d => ({ label: d.label, deviceId: d.deviceId })));
    
    // Priority 1: Look for Shure microphone (case-insensitive)
    const shureMic = audioInputs.find(device => 
      device.label.toLowerCase().includes('shure')
    );
    
    if (shureMic) {
      console.log('Using Shure microphone:', shureMic.label);
      return shureMic.deviceId;
    }
    
    // Priority 2: Look for built-in laptop microphone (avoid phone/external devices)
    const builtInMic = audioInputs.find(device => {
      const label = device.label.toLowerCase();
      return (
        label.includes('built-in') ||
        label.includes('builtin') ||
        label.includes('internal') ||
        label.includes('macbook') ||
        label.includes('laptop') ||
        label.includes('realtek') ||
        label.includes('integrated')
      );
    });
    
    if (builtInMic) {
      console.log('Using built-in microphone:', builtInMic.label);
      return builtInMic.deviceId;
    }
    
    // Priority 3: Avoid phone/mobile devices, pick first non-phone device
    const nonPhoneMic = audioInputs.find(device => {
      const label = device.label.toLowerCase();
      return !(
        label.includes('iphone') ||
        label.includes('android') ||
        label.includes('phone') ||
        label.includes('bluetooth') ||
        label.includes('airpods') ||
        label.includes('wireless')
      );
    });
    
    if (nonPhoneMic) {
      console.log('Using non-phone microphone:', nonPhoneMic.label);
      return nonPhoneMic.deviceId;
    }
    
    console.log('No preferred mic found, using system default');
    return undefined;
  };

  const loadAudioDevices = async () => {
    try {
      setIsLoading(true);
      // Request permission first to get device labels
      await navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
        stream.getTracks().forEach(track => track.stop());
      });
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter(device => device.kind === 'audioinput')
        .map(device => ({
          deviceId: device.deviceId,
          label: device.label || `Microphone ${device.deviceId.slice(0, 8)}`
        }));
      
      setAudioDevices(audioInputs);
      
      // Auto-select preferred device if none selected
      if (!selectedDeviceId && audioInputs.length > 0) {
        const preferredId = getPreferredMicrophone(audioInputs);
        setSelectedDeviceId(preferredId || audioInputs[0].deviceId);
      }
    } catch (error) {
      console.error('Error loading audio devices:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getSelectedDeviceLabel = () => {
    const device = audioDevices.find(d => d.deviceId === selectedDeviceId);
    return device?.label || 'Select Microphone';
  };

  return {
    audioDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    isLoading,
    getSelectedDeviceLabel,
  };
};
