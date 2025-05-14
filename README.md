This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## AI Conversation with Speech Recognition and TTS

This application uses:
- [Voice Activity Detection (VAD)](https://github.com/ricky0123/vad) to detect speech
- [Groq API](https://groq.com/) for speech transcription with Whisper and LLM responses with Llama
- [Cartesia API](https://cartesia.ai/) for Text-to-Speech synthesis

### Setup

1. Get API keys from:
   - [Groq](https://console.groq.com/keys)
   - [Cartesia](https://cartesia.ai/) (for TTS)
   
2. Create a `.env.local` file in the root directory and add your API keys:
   ```
   GROQ_API_KEY=your_groq_api_key_here
   CARTESIA_API_KEY=your_cartesia_api_key_here
   ```

3. Install dependencies:
   ```
   pnpm install
   ```

4. Run the development server:
   ```
   pnpm dev
   ```

### Usage

1. Open the application in your browser
2. Click the microphone button to start listening for speech
3. Speak into your microphone - when you pause speaking:
   - Your speech will be transcribed using Whisper
   - The transcript will be sent to the LLM for a response
   - The response will be converted to speech via TTS
   - The AI will "speak" the response with a visual animation

### Features

- Real-time voice activity detection
- Automatic speech recording when speech is detected
- Speech transcription using Whisper Large V3 model
- LLM response generation with Llama 3
- Text-to-Speech synthesis for natural voice responses
- Visual speaking animation and UI feedback
- Conversation history display
- Full voice conversation with an AI assistant
