import type {
  BackgroundElement,
  ElementAnimation,
  StoryMetadataWithDetails,
  TextElement,
  Timeline,
} from "../src/lib/types";

export const createTimeLineFromStoryWithDetails = (
  storyWithDetails: StoryMetadataWithDetails,
): Timeline => {
  const timeline: Timeline = {
    elements: [],
    text: [],
    audio: [],
    shortTitle: storyWithDetails.shortTitle,
  };

  let durationMs = 0;
  let zoomIn = true;

  for (let i = 0; i < storyWithDetails.content.length; i++) {
    const content = storyWithDetails.content[i];

    const lenMs = Math.ceil(
      content.audioTimestamps.characterEndTimesSeconds[
        content.audioTimestamps.characterEndTimesSeconds.length - 1
      ] * 1000,
    );

    const bgElem: BackgroundElement = {
      startMs: durationMs,
      endMs: durationMs + lenMs,
      imageUrl: content.uid,
      enterTransition: "blur",
      exitTransition: "blur",
      animations: getBgAnimations(lenMs, zoomIn),
    };

    timeline.elements.push(bgElem);
    timeline.audio.push({
      startMs: durationMs,
      endMs: durationMs + lenMs,
      audioUrl: content.uid,
    });

    // handle text word by word
    const words = content.text.split(" ");
    const {
      characterStartTimesSeconds: character_start_times_seconds,
      characterEndTimesSeconds: character_end_times_seconds,
    } = content.audioTimestamps;

    const MaxSentenseSizeChars = 14;

    let currentText = "";
    let currentStartMs = character_start_times_seconds[0] * 1000 + durationMs;
    let currentEndMs = durationMs;
    let currentCharIndex = 0;

    for (const word of words) {
      if ((currentText + word).length > MaxSentenseSizeChars) {
        if (currentText.trim().length > 0) {
          const textElem: TextElement = {
            startMs: currentStartMs,
            endMs: currentEndMs,
            text: currentText.trim(),
            position: "center",
            animations: getTextAnimations(),
          };

          timeline.text.push(textElem);

          currentText = "";
          currentStartMs = currentEndMs;
        }
      }

      currentText += `${word} `;
      for (let j = 0; j < word.length; j++) {
        currentEndMs =
          character_end_times_seconds[currentCharIndex] * 1000 + durationMs;
        currentCharIndex++;
      }

      currentEndMs =
        character_end_times_seconds[currentCharIndex] * 1000 + durationMs;
      currentCharIndex++;
    }

    if (currentText.trim().length > 0) {
      const textElem: TextElement = {
        startMs: currentStartMs,
        endMs:
          character_end_times_seconds[character_end_times_seconds.length - 1] *
            1000 +
          durationMs,
        text: currentText.trim(),
        position: "center",
        animations: getTextAnimations(),
      };

      timeline.text.push(textElem);
    }

    durationMs += lenMs;

    zoomIn = !zoomIn;
  }

  return timeline;
};

function getBgAnimations(lenMs: number, zoomIn: boolean): ElementAnimation[] {
  return [
    {
      type: "scale",
      startMs: 0,
      endMs: lenMs,
      from: zoomIn ? 1 : 1.2,
      to: zoomIn ? 1.2 : 1,
    },
  ];
}

function getTextAnimations(): ElementAnimation[] {
  return [];
}

export function findAllSpaceIndexes(str: string): number[] {
  const indexes = [];
  for (let i = 0; i < str.length; i++) {
    if (str[i] === " ") {
      indexes.push(i);
    }
  }
  return indexes;
}
