import { GoogleGenAI } from '@google/genai';

const getClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }
  return new GoogleGenAI({ apiKey });
};

export const explainMatch = async (matchData) => {
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

  try {
    const ai = getClient();
    const prompt = `Explain this ZYNC match to the user in a friendly, natural way. Use "you" and "they", never "the user", "the candidate", or "your candidate". Give 2–3 short sentences covering the strongest positive match factors and any important mismatch. No greetings, filler, calculations, or guarantees.

      Match Data:
      ${JSON.stringify(matchData, null, 2)}`;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        maxOutputTokens: 100, // Keep output short (2-4 sentences is usually < 100 tokens)
      }
    });

    if (response.text) {
      return response.text.trim();
    }
    throw new Error('Empty response from Gemini');
  } catch (error) {
    console.error('Gemini API Error:', error);
    throw error;
  }
};
