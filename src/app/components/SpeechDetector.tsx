'use client';

import { useEffect, useState, useRef } from 'react';
import { MicVAD } from '@ricky0123/vad-web';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function SpeechDetector() {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [isAiSpeaking, setIsAiSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const vadRef = useRef<MicVAD | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const initVAD = async () => {
      try {
        vadRef.current = await MicVAD.new({
          onSpeechStart: () => {
            console.log('Speech detected');
            setIsSpeaking(true);
          },
          onSpeechEnd: async (audio) => {
            console.log('Speech ended, received audio samples:', audio.length);
            setIsSpeaking(false);
            await processAudio(audio);
          },
        });
        
        setIsReady(true);
      } catch (e) {
        console.error('Failed to initialize VAD:', e);
        setError(e instanceof Error ? e.message : String(e));
      }
    };

    // Initialize audio element for TTS playback
    const audioElement = new Audio();
    audioElement.addEventListener('play', () => setIsAiSpeaking(true));
    audioElement.addEventListener('ended', () => setIsAiSpeaking(false));
    audioElement.addEventListener('pause', () => setIsAiSpeaking(false));
    audioElement.addEventListener('error', (e) => {
      console.error('Audio playback error:', e);
      setIsAiSpeaking(false);
      setError('Audio playback failed. Please try again.');
    });
    audioRef.current = audioElement;

    initVAD();

    return () => {
      if (vadRef.current) {
        vadRef.current.destroy();
      }
      if (audioRef.current) {
        audioRef.current.removeEventListener('play', () => setIsAiSpeaking(true));
        audioRef.current.removeEventListener('ended', () => setIsAiSpeaking(false));
        audioRef.current.removeEventListener('pause', () => setIsAiSpeaking(false));
        audioRef.current.removeEventListener('error', () => setIsAiSpeaking(false));
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Toggle mute for AI responses
  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (audioRef.current) {
      audioRef.current.muted = !isMuted;
      if (!isMuted && isAiSpeaking) {
        audioRef.current.pause();
      }
    }
  };

  // Convert Float32Array audio data to WAV format
  const float32ArrayToWav = (audioData: Float32Array, sampleRate = 16000) => {
    // Create WAV header
    const numFrames = audioData.length;
    const numChannels = 1;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = numFrames * blockAlign;
    
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    
    // WAV header
    // "RIFF" chunk descriptor
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    
    // "fmt " sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // fmt chunk size
    view.setUint16(20, 1, true); // audio format (PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true); // bits per sample
    
    // "data" sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);
    
    // Write audio data
    const floatTo16BitPCM = (output: DataView, offset: number, input: Float32Array) => {
      for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }
    };
    
    floatTo16BitPCM(view, 44, audioData);
    
    return new Blob([buffer], { type: 'audio/wav' });
  };
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };

  const processAudio = async (audioData: Float32Array) => {
    try {
      setIsTranscribing(true);
      
      // Convert Float32Array to WAV
      const wavBlob = float32ArrayToWav(audioData);
      console.log('Converted to WAV, size:', wavBlob.size);
      
      // Create a File object from the Blob
      const audioFile = new File([wavBlob], 'speech.wav', { type: 'audio/wav' });
      
      // Send to API for transcription, LLM processing, and TTS
      await processConversation(audioFile);
      
      setIsTranscribing(false);
    } catch (err) {
      console.error('Error processing audio:', err);
      setError(err instanceof Error ? err.message : String(err));
      setIsTranscribing(false);
    }
  };

  const processConversation = async (audioFile: File) => {
    try {
      const formData = new FormData();
      formData.append('audio', audioFile);
      
      // Add message history if available
      if (messages.length > 0) {
        formData.append('messageHistory', JSON.stringify(messages));
      }
      
      // Add TTS enabled flag
      formData.append('ttsEnabled', 'true');
      
      setIsAiThinking(true);
      
      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('API error:', errorData);
        throw new Error(errorData.error || 'Processing failed');
      }

      setIsAiThinking(false);

      // Check if we got audio back
      const contentType = response.headers.get('Content-Type');
      
      if (contentType?.includes('audio')) {
        // Process audio response
        const userTranscript = decodeURIComponent(response.headers.get('X-Transcript') || '');
        const aiResponseText = decodeURIComponent(response.headers.get('X-Response') || '');
        
        // Update messages
        const newMessages: Message[] = [
          ...messages,
          { role: 'user', content: userTranscript },
          { role: 'assistant', content: aiResponseText }
        ];
        setMessages(newMessages);
        
        // Get the audio blob from the response
        const audioBlob = await response.blob();
        
        // Create a debug element to check audio content
        console.log('Audio blob type:', audioBlob.type);
        console.log('Audio blob size:', audioBlob.size);
        
        // Reset any previous audio
        if (audioRef.current) {
          audioRef.current.pause();
          
          // Play the audio response (unless muted)
          try {
            const audioUrl = URL.createObjectURL(audioBlob);
            audioRef.current.src = audioUrl;
            audioRef.current.muted = isMuted;
            
            // Add a debug message before playing
            console.log('Attempting to play audio from URL:', audioUrl);
            
            if (!isMuted) {
              const playPromise = audioRef.current.play();
              
              if (playPromise !== undefined) {
                playPromise.catch(error => {
                  console.error('Audio play error:', error);
                  // If there's an error playing, make sure the speaking state is reset
                  setIsAiSpeaking(false);
                });
              }
            } else {
              // If muted, still set the speaking state briefly to show animation
              setIsAiSpeaking(true);
              setTimeout(() => setIsAiSpeaking(false), 3000);
            }
          } catch (error) {
            console.error('Error setting up audio playback:', error);
            setIsAiSpeaking(false);
          }
        }
      } else {
        // Process JSON response (when TTS is disabled or failed)
        const jsonResponse = await response.json();
        
        // Update messages
        const newMessages: Message[] = [
          ...messages,
          { role: 'user', content: jsonResponse.transcript },
          { role: 'assistant', content: jsonResponse.response }
        ];
        setMessages(newMessages);
      }
    } catch (err) {
      console.error('Conversation error:', err);
      setError(err instanceof Error ? err.message : String(err));
      setIsAiThinking(false);
      setIsAiSpeaking(false);
    }
  };

  const toggleListening = () => {
    if (!vadRef.current || !isReady) return;
    
    if (isListening) {
      vadRef.current.pause();
      setIsSpeaking(false);
    } else {
      vadRef.current.start();
    }
    
    setIsListening(!isListening);
  };

  // Force reset AI speaking state - failsafe mechanism
  useEffect(() => {
    if (isAiSpeaking) {
      // Set a timeout to force reset if it gets stuck
      const timeout = setTimeout(() => {
        setIsAiSpeaking(false);
      }, 10000); // 10 seconds max for any speech
      
      return () => clearTimeout(timeout);
    }
  }, [isAiSpeaking]);

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-black">
      {error ? (
        <div className="text-red-500 mb-4">Error: {error}</div>
      ) : isReady ? (
        <>
          <div className="flex justify-center space-x-12 mb-8">
            {/* USER CIRCLE */}
            <div className="relative flex items-center justify-center h-64 w-64">
              <div className="text-white text-center mb-2 absolute -top-8">You</div>
              
              {/* Outer pulsating circle */}
              <div 
                className={`absolute rounded-full transition-all duration-500 ease-in-out ${
                  isSpeaking 
                    ? 'w-64 h-64 bg-blue-500/20 animate-pulse' 
                    : 'w-56 h-56 bg-blue-700/10'
                }`}
              />
              
              {/* Middle pulsating circle */}
              <div 
                className={`absolute rounded-full transition-all duration-400 ease-in-out ${
                  isSpeaking 
                    ? 'w-52 h-52 bg-blue-500/30 animate-pulse' 
                    : 'w-44 h-44 bg-blue-700/20'
                }`}
              />
              
              {/* Inner main circle */}
              <div 
                className={`absolute rounded-full transition-all duration-300 ease-in-out ${
                  isSpeaking 
                    ? 'w-40 h-40 bg-blue-500 scale-110' 
                    : 'w-32 h-32 bg-blue-700'
                }`}
              />
              
              {/* Mic button */}
              <button
                onClick={toggleListening}
                className={`absolute z-10 w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 
                  bg-white hover:bg-gray-200 ${isListening ? 'ring-2 ring-blue-500' : ''}`}
                aria-label={isListening ? 'Stop listening' : 'Start listening'}
                disabled={isTranscribing || isAiThinking || isAiSpeaking}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill={isListening ? "#3B82F6" : "#374151"}
                  className="w-6 h-6"
                >
                  {isListening ? (
                    // Stop icon
                    <path
                      fillRule="evenodd"
                      d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
                    />
                  ) : (
                    // Mic icon
                    <path
                      d="M8 11C8 12.6569 9.34315 14 11 14H13C14.6569 14 16 12.6569 16 11V5C16 3.34315 14.6569 2 13 2H11C9.34315 2 8 3.34315 8 5V11Z"
                    />
                  )}
                  {!isListening && (
                    <path
                      d="M18 11C18 14.3137 15.3137 17 12 17C8.68629 17 6 14.3137 6 11M12 17V20M12 20H15M12 20H9M12 23H12.01"
                      stroke="#374151"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      fill="none"
                    />
                  )}
                </svg>
              </button>
            </div>
            
            {/* AI CIRCLE */}
            <div className="relative flex items-center justify-center h-64 w-64">
              <div className="absolute -top-8 flex items-center">
                <span className="text-white text-center mr-2">AI</span>
                {/* Mute button moved next to AI title */}
                <button
                  onClick={toggleMute}
                  className={`z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 
                    bg-white hover:bg-gray-200 ${isMuted ? 'ring-1 ring-red-500' : ''}`}
                  aria-label={isMuted ? 'Unmute AI' : 'Mute AI'}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill={isMuted ? "#EF4444" : "#374151"}
                    className="w-4 h-4"
                  >
                    {isMuted ? (
                      // Muted icon
                      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM17.78 9.22a.75.75 0 10-1.06 1.06L18.44 12l-1.72 1.72a.75.75 0 001.06 1.06l1.72-1.72 1.72 1.72a.75.75 0 101.06-1.06L20.56 12l1.72-1.72a.75.75 0 00-1.06-1.06l-1.72 1.72-1.72-1.72z" />
                    ) : (
                      // Unmuted icon
                      <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
                    )}
                  </svg>
                </button>
              </div>
              
              {/* Outer pulsating circle */}
              <div 
                className={`absolute rounded-full transition-all duration-500 ease-in-out ${
                  isAiSpeaking 
                    ? 'w-64 h-64 bg-gray-700/50 animate-pulse' 
                    : isAiThinking
                      ? 'w-56 h-56 bg-purple-500/20 animate-pulse'
                      : 'w-56 h-56 bg-gray-800/30'
                }`}
              />
              
              {/* Middle pulsating circle */}
              <div 
                className={`absolute rounded-full transition-all duration-400 ease-in-out ${
                  isAiSpeaking 
                    ? 'w-52 h-52 bg-gray-600/50 animate-pulse' 
                    : isAiThinking
                      ? 'w-44 h-44 bg-purple-500/30 animate-pulse'
                      : 'w-44 h-44 bg-gray-700/40'
                }`}
              />
              
              {/* Inner main circle */}
              <div 
                className={`absolute rounded-full transition-all duration-300 ease-in-out ${
                  isAiSpeaking 
                    ? 'w-40 h-40 bg-gray-500 scale-110' 
                    : isAiThinking
                      ? 'w-32 h-32 bg-purple-500'
                      : 'w-32 h-32 bg-gray-600'
                }`}
              />
              
              {/* AI face elements */}
              {(isAiSpeaking || isAiThinking) && (
                <div className="absolute z-10 flex flex-col items-center justify-center">
                  {/* Eyes */}
                  <div className="flex space-x-8 mb-4">
                    <div className="w-4 h-4 bg-white rounded-full"></div>
                    <div className="w-4 h-4 bg-white rounded-full"></div>
                  </div>
                  
                  {/* Animated mouth or thinking dots */}
                  {isAiSpeaking ? (
                    <div className="w-16 h-4 bg-white rounded-full animate-pulse"></div>
                  ) : (
                    <div className="flex space-x-2">
                      <div className="w-2 h-2 bg-white rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-2 h-2 bg-white rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          
          <p className="text-white mb-4">
            {isAiSpeaking 
              ? 'AI is speaking...'
              : isAiThinking
                ? 'AI is thinking...'
                : isTranscribing 
                  ? 'Transcribing speech...' 
                  : isSpeaking 
                    ? 'Speech detected!' 
                    : isListening 
                      ? 'Listening for speech...' 
                      : 'Click the mic to start'
            }
          </p>
          
          {/* Conversation history with black chat bubbles */}
          {messages.length > 0 && (
            <div className="mt-4 max-w-xl w-full px-6 overflow-y-auto max-h-[40vh]">
              {messages.map((message, index) => (
                <div 
                  key={index}
                  className={`mb-4 ${
                    message.role === 'user' 
                      ? 'bg-blue-800 ml-12' 
                      : 'bg-gray-800 mr-12'
                  } rounded-lg p-3 text-white`}
                >
                  <p className="font-medium mb-1">
                    {message.role === 'user' ? 'You' : 'AI'}:
                  </p>
                  <p className="text-gray-300">{message.content}</p>
                </div>
              ))}
            </div>
          )}
          
          {/* Clear button for conversation history */}
          {messages.length > 0 && (
            <button 
              onClick={() => setMessages([])}
              className="mt-4 px-4 py-2 bg-red-700 text-white rounded hover:bg-red-800 transition"
            >
              Clear Conversation
            </button>
          )}
        </>
      ) : (
        <div className="text-white">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          Loading speech detector...
        </div>
      )}
      
      {/* Debug invisible audio element to ensure browser supports audio playback */}
      <audio 
        controls 
        className="hidden"
        id="debug-audio"
      />
    </div>
  );
} 