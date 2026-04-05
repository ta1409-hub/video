#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import prompts from "prompts";
import ora from "ora";
import chalk from "chalk";
import * as dotenv from "dotenv";
import {
  generateAiImage,
  generateVoice,
  getGenerateImageDescriptionPrompt,
  getGenerateStoryPrompt,
  openaiStructuredCompletion,
  setApiKey,
} from "./service";
import {
  ContentItemWithDetails,
  StoryMetadataWithDetails,
  StoryScript,
  StoryWithImages,
  Timeline,
} from "../src/lib/types";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { createTimeLineFromStoryWithDetails } from "./timeline";

dotenv.config({ quiet: true } as Parameters<typeof dotenv.config>[0]);

interface GenerateOptions {
  apiKey?: string;
  elevenlabsApiKey?: string;
  title?: string;
  topic?: string;
}

class ContentFS {
  title: string;
  slug: string;

  constructor(title: string) {
    this.title = title;
    this.slug = this.getSlug();
  }

  saveDescriptor(descriptor: StoryMetadataWithDetails) {
    const dirPath = this.getDir();
    const filePath = path.join(dirPath, "descriptor.json");
    fs.writeFileSync(filePath, JSON.stringify(descriptor, null, 2));
  }

  saveTimeline(timeline: Timeline) {
    const dirPath = this.getDir();
    const filePath = path.join(dirPath, "timeline.json");
    fs.writeFileSync(filePath, JSON.stringify(timeline, null, 2));
  }

  getDir(dir?: string): string {
    const segments = ["public", "content", this.slug];
    if (dir) {
      segments.push(dir);
    }
    const p = path.join(process.cwd(), ...segments);
    fs.mkdirSync(p, { recursive: true });
    return p;
  }

  getImagePath(uid: string): string {
    const dirPath = this.getDir("images");
    return path.join(dirPath, `${uid}.png`);
  }

  getAudioPath(uid: string): string {
    const dirPath = this.getDir("audio");
    return path.join(dirPath, `${uid}.mp3`);
  }

  getSlug(): string {
    return this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }
}

async function generateStory(options: GenerateOptions) {
  try {
    let apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    let elevenlabsApiKey =
      options.elevenlabsApiKey || process.env.ELEVENLABS_API_KEY;

    if (!apiKey) {
      const response = await prompts({
        type: "password",
        name: "apiKey",
        message: "Enter your OpenAI API key:",
        validate: (value) => value.length > 0 || "API key is required",
      });

      if (!response.apiKey) {
        console.log(chalk.red("API key is required. Exiting..."));
        process.exit(1);
      }

      apiKey = response.apiKey;
    }

    if (!elevenlabsApiKey) {
      const response = await prompts({
        type: "password",
        name: "elevenlabsApiKey",
        message: "Enter your ElevenLabs API key:",
        validate: (value) =>
          value.length > 0 || "ElevenLabs API key is required",
      });

      if (!response.elevenlabsApiKey) {
        console.log(chalk.red("ElevenLabs API key is required. Exiting..."));
        process.exit(1);
      }

      elevenlabsApiKey = response.elevenlabsApiKey;
    }

    setApiKey(apiKey);

    let title = options.title;
    let topic = options.topic;

    if (!title) {
      const response = await prompts({
        type: "text",
        name: "title",
        message: "Enter the story title:",
        validate: (value) => value.length > 0 || "Title is required",
      });

      if (!response.title) {
        console.log(chalk.red("Title is required. Exiting..."));
        process.exit(1);
      }

      title = response.title;
    }

    if (!topic) {
      const response = await prompts({
        type: "text",
        name: "topic",
        message: "Enter the story topic:",
        validate: (value) => value.length > 0 || "Topic is required",
      });

      if (!response.topic) {
        console.log(chalk.red("Topic is required. Exiting..."));
        process.exit(1);
      }

      topic = response.topic;
    }

    const contentFS = new ContentFS(title!);

    console.log(chalk.blue(`\nGenerating story: "${title}" about "${topic}"`));

    // Step 1: Generate story script
    const scriptSpinner = ora("Generating story script...").start();
    const storyScript = await openaiStructuredCompletion(
      getGenerateStoryPrompt(title!, topic!),
      StoryScript,
    );
    scriptSpinner.succeed("Story script generated");

    // Step 2: Generate image descriptions
    const imagesSpinner = ora("Generating image descriptions...").start();
    const storyWithImages = await openaiStructuredCompletion(
      getGenerateImageDescriptionPrompt(storyScript.text, topic!),
      StoryWithImages,
    );
    imagesSpinner.succeed("Image descriptions generated");

    // Step 3: Generate images and audio
    const contentItems: ContentItemWithDetails[] = [];

    for (let i = 0; i < storyWithImages.result.length; i++) {
      const item = storyWithImages.result[i];
      const uid = uuidv4();

      console.log(
        chalk.blue(
          `\nProcessing segment ${i + 1}/${storyWithImages.result.length}`,
        ),
      );

      // Generate image
      const imageSpinner = ora("Generating image...").start();
      await generateAiImage({
        prompt: item.imageDescription,
        path: contentFS.getImagePath(uid),
        onRetry: (attempt) => {
          imageSpinner.text = `Retrying image generation (attempt ${attempt})...`;
        },
      });
      imageSpinner.succeed("Image generated");

      // Generate voice
      const voiceSpinner = ora("Generating voice...").start();
      const audioTimestamps = await generateVoice({
        text: item.text,
        path: contentFS.getAudioPath(uid),
        elevenlabsApiKey: elevenlabsApiKey!,
      });
      voiceSpinner.succeed("Voice generated");

      contentItems.push({
        text: item.text,
        imageDescription: item.imageDescription,
        uid,
        audioTimestamps,
      });
    }

    // Step 4: Create and save timeline
    const storyMetadata: StoryMetadataWithDetails = {
      shortTitle: title!,
      content: contentItems,
    };

    contentFS.saveDescriptor(storyMetadata);

    const timeline = createTimeLineFromStoryWithDetails(storyMetadata);
    contentFS.saveTimeline(timeline);

    console.log(chalk.green(`\nStory "${title}" generated successfully!`));
    console.log(
      chalk.blue(`Files saved to: public/content/${contentFS.slug}/`),
    );
    console.log(chalk.blue("\nRun `npm run dev` to preview your video!"));
  } catch (error) {
    console.error(chalk.red("Error generating story:"), error);
    process.exit(1);
  }
}

yargs(hideBin(process.argv))
  .command(
    "generate",
    "Generate a new story video",
    (yargs) => {
      return yargs
        .option("api-key", {
          alias: "k",
          type: "string",
          description: "OpenAI API key",
        })
        .option("elevenlabs-api-key", {
          alias: "e",
          type: "string",
          description: "ElevenLabs API key",
        })
        .option("title", {
          alias: "t",
          type: "string",
          description: "Story title",
        })
        .option("topic", {
          alias: "p",
          type: "string",
          description: "Story topic",
        });
    },
    (argv) => {
      generateStory({
        apiKey: argv.apiKey as string | undefined,
        elevenlabsApiKey: argv.elevenlabsApiKey as string | undefined,
        title: argv.title as string | undefined,
        topic: argv.topic as string | undefined,
      });
    },
  )
  .command(
    "$0",
    "Generate a new story video",
    (yargs) => {
      return yargs
        .option("api-key", {
          alias: "k",
          type: "string",
          description: "OpenAI API key",
        })
        .option("elevenlabs-api-key", {
          alias: "e",
          type: "string",
          description: "ElevenLabs API key",
        })
        .option("title", {
          alias: "t",
          type: "string",
          description: "Story title",
        })
        .option("topic", {
          alias: "p",
          type: "string",
          description: "Story topic",
        });
    },
    (argv) => {
      generateStory({
        apiKey: argv.apiKey as string | undefined,
        elevenlabsApiKey: argv.elevenlabsApiKey as string | undefined,
        title: argv.title as string | undefined,
        topic: argv.topic as string | undefined,
      });
    },
  )
  .help()
  .parse();
