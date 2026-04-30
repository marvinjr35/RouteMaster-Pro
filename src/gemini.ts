import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const geminiFlash = (prompt: string, systemInstruction?: string, useMaps = true) => {
  return ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      systemInstruction,
      tools: useMaps ? [{ googleMaps: {} }] : [{ googleSearch: {} }],
      toolConfig: { includeServerSideToolInvocations: true }
    }
  });
};

export const geminiProThinking = (prompt: string, systemInstruction?: string) => {
  return ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: prompt,
    config: {
      systemInstruction,
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
    }
  });
};

export const geminiLite = (prompt: string, systemInstruction?: string) => {
  return ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: prompt,
    config: { systemInstruction }
  });
};
