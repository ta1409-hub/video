import z from "zod";
import * as fs from "fs";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { CharacterAlignmentResponseModel } from "@elevenlabs/elevenlabs-js/api";
import { IMAGE_HEIGHT, IMAGE_WIDTH } from "../src/lib/constants";

let apiKey: string | null = null;

export const setApiKey = (key: string) => {
  apiKey = key;
};

export const openaiStructuredCompletion = async <T>(
  prompt: string,
  schema: z.ZodType<T>,
): Promise<T> => {
  const jsonSchema = z.toJSONSchema(schema);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "response",
          schema: {
            type: jsonSchema.type || "object",
            properties: jsonSchema.properties,
            required: jsonSchema.required,
            additionalProperties: jsonSchema.additionalProperties ?? false,
          },
          strict: true,
        },
      },
    }),
  });

  if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);

  const data = await res.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error("No content in OpenAI response");
  }

  const parsed = JSON.parse(content);
  return schema.parse(parsed);
};

function saveUint8ArrayToPng(uint8Array: Uint8Array, filePath: string) {
  const buffer = Buffer.from(uint8Array);
  fs.writeFileSync(filePath, buffer as Uint8Array);
}

export const generateAiImage = async ({
  prompt,
  path,
  onRetry,
}: {
  prompt: string;
  path: string;
  onRetry: (attempt: number) => void;
}) => {
  const maxRetries = 3;
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxRetries) {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        size: `${IMAGE_WIDTH}x${IMAGE_HEIGHT}`,
        response_format: "b64_json",
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const buffer = Buffer.from(data.data[0].b64_json, "base64");
      const uint8Array = new Uint8Array(buffer);

      saveUint8ArrayToPng(uint8Array, path);
      return;
    } else {
      lastError = new Error(
        `OpenAI error (attempt ${attempt + 1}): ${await res.text()}`,
      );
      attempt++;
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      onRetry(attempt);
    }
  }

  throw lastError;
};

export const generateVoice = async ({
  text,
  path,
  elevenlabsApiKey,
}: {
  text: string;
  path: string;
  elevenlabsApiKey: string;
}): Promise<CharacterAlignmentResponseModel> => {
  const client = new ElevenLabsClient({ apiKey: elevenlabsApiKey });

  // Replace this voice ID with your preferred ElevenLabs voice
  const voiceId = "aTxZrSrp47xsP6Ot4Kgd";

  const response = await client.textToSpeech.convertWithTimestamps(voiceId, {
    text,
    model_id: "eleven_multilingual_v2",
  });

  const audioData: Buffer[] = [];
  for await (const chunk of response.audio_base64) {
    audioData.push(Buffer.from(chunk, "base64"));
  }

  fs.writeFileSync(path, Buffer.concat(audioData));

  return response.alignment as CharacterAlignmentResponseModel;
};

export const getGenerateStoryPrompt = (title: string, topic: string) =>
  `Generate a short story script for a vertical video about "${title}".
Topic: ${topic}
The story should be engaging, educational and suitable for social media (TikTok/Instagram).
Keep it concise - about 60-90 seconds when read aloud.
Return the story as plain text without any formatting or markdown.`;

export const getGenerateImageDescriptionPrompt = (
  storyText: string,
  topic: string,
) =>
  `You are creating visual descriptions for AI image generation for a short video about "${topic}".

Story text:
${storyText}

Split this story into segments of 1-3 sentences each and for each segment create:
1. The exact text of that segment
2. A detailed visual description for an AI image that would complement that text

The images should be photorealistic, dramatic, and visually striking.
The descriptions should be specific about lighting, composition, and style.`;
