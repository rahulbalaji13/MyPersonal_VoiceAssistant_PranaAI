import Groq from "groq-sdk";
import { headers } from "next/headers";
import { zfd } from "zod-form-data";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const schema = zfd.formData({
  audio: zfd.file(),
  messageHistory: zfd.text()
    .transform((val: string) => {
      try {
        return JSON.parse(val);
      } catch {
        return [];
      }
    })
    .optional(),
  ttsEnabled: zfd.text()
    .transform((val: string) => val === "true")
    .optional(),
});

export async function POST(request: Request) {
  // Generate a unique request ID for logging
  const requestId = Math.random().toString(36).substring(2, 10);
  console.time(`transcribe ${requestId}`);

  try {
    // Parse the form data
    const formData = await request.formData();
    
    // Validate the form data
    const { data, success } = schema.safeParse(formData);
    if (!success) {
      console.error("Invalid request data:", JSON.stringify(schema.safeParse(formData).error));
      return Response.json({ error: "Invalid request data" }, { status: 400 });
    }

    // Set default for ttsEnabled if it's undefined
    const ttsEnabled = data.ttsEnabled === undefined ? true : data.ttsEnabled;
    console.log("Server processed ttsEnabled:", ttsEnabled);

    // Get the audio file
    const audioFile = data.audio;
    if (!audioFile) {
      return Response.json({ error: 'No audio file provided' }, { status: 400 });
    }

    console.log('Received audio file:', {
      type: audioFile.type,
      size: audioFile.size,
      name: audioFile.name || 'unnamed',
    });

    // 1. TRANSCRIBE SPEECH
    // Create a new File with a proper name and extension
    const transcriptionFile = new File(
      [audioFile], 
      'audio.wav', 
      { type: 'audio/wav' }
    );
    
    // Use Groq SDK to transcribe the audio
    const transcriptionResult = await groq.audio.transcriptions.create({
      file: transcriptionFile,
      model: "whisper-large-v3",
    });
    
    const transcript = transcriptionResult.text.trim();
    
    if (!transcript) {
      return Response.json({ error: 'No speech detected in audio' }, { status: 400 });
    }
    
    console.timeEnd(`transcribe ${requestId}`);
    console.time(`llm ${requestId}`);
    
    // 2. GENERATE LLM RESPONSE
    // Prepare conversation history
    const cleanedMessageHistory = (data.messageHistory || []).map(
      ({ role, content }: { role: string; content: string }) => ({
        role,
        content
      })
    );
    
    // Generate AI response with message history
    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192",
      messages: [
        {
          role: "system",
          content: `You are a helpful voice AI assistant.
          - the user is epaking through a microphone... your response will be converted into sound.
          - Respond briefly to the user's request, and do not provide unnecessary information.
          - If you don't understand the user's request, ask for clarification.
          - Today's date is ${new Date().toISOString().split('T')[0]}.
          - Keep responses concise and to the point.`,
        },
        ...cleanedMessageHistory,
        {
          role: "user",
          content: transcript,
        },
      ],
    });

    const response = completion.choices[0].message.content || "";
    console.timeEnd(`llm ${requestId}`);
    
    // Check if audio generation should be skipped
    const headersList = await headers();
    const skipAudioHeader = headersList.get("X-Skip-Audio");
    const skipAudio = skipAudioHeader === "true" || ttsEnabled === false;
    
    if (skipAudio) {
      console.log("Skipping audio generation");
      return Response.json({ 
        transcript: transcript,
        response: response,
        audioUrl: null
      });
    }
    
    // 3. GENERATE TEXT-TO-SPEECH AUDIO
    console.time(`tts ${requestId}`);
    
    try {
      // Using Cartesia API for TTS generation
      const ttsResponse = await fetch("https://api.cartesia.ai/tts/bytes", {
        method: "POST",
        headers: {
          "Cartesia-Version": "2024-06-30",
          "Content-Type": "application/json",
          "X-API-Key": process.env.CARTESIA_API_KEY || "",
        },
        body: JSON.stringify({
          model_id: "sonic-english",
          transcript: response,
          voice: {
            mode: "id",
            id: "71a7ad14-091c-4e8e-a314-022ece01c121",
          },
          output_format: {
            container: "wav",    // Changed from "raw" to "wav"
            encoding: "pcm_f32le",
            sample_rate: 24000,
          },
        }),
      });
      
      console.timeEnd(`tts ${requestId}`);
      
      if (!ttsResponse.ok) {
        console.error('TTS API error:', await ttsResponse.text());
        return Response.json({ 
          transcript: transcript,
          response: response,
          audioUrl: null,
          error: "TTS generation failed"
        });
      }
      
      // Get the array buffer from the response
      const audioBuffer = await ttsResponse.arrayBuffer();
      console.log("Received audio buffer size:", audioBuffer.byteLength);
      
      // Return the audio data along with transcription and response
      return new Response(audioBuffer, {
        headers: {
          "Content-Type": "audio/wav",
          "Content-Length": audioBuffer.byteLength.toString(),
          "X-Transcript": encodeURIComponent(transcript),
          "X-Response": encodeURIComponent(response),
        },
      });
      
    } catch (error) {
      console.error("TTS error:", error);
      return Response.json({ 
        transcript: transcript, 
        response: response,
        audioUrl: null,
        error: "TTS generation failed"
      });
    }
    
  } catch (error) {
    console.error("Request processing error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
} 