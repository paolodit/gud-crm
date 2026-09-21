import type { Page } from "@playwright/test";

/** Keep text-only checks independent of browser microphone services. */
export async function useTypedVoice(page: Page) {
  await page.addInitScript(() => {
    Object.assign(window, { SpeechRecognition: undefined, webkitSpeechRecognition: undefined });
  });
}
