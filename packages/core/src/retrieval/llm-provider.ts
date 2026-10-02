import Groq from 'groq-sdk';

export interface LLMProvider {
  generate(systemPrompt: string, userPrompt: string): Promise<string>;
  generateStream(
    systemPrompt: string,
    userPrompt: string,
    onToken: (token: string) => void
  ): Promise<{ fullText: string; tokensUsed: number }>;
}

class GroqLLMProvider implements LLMProvider {
  private client: Groq;
  private model: string;

  constructor(apiKey: string, model = 'qwen/qwen3.8-27b') {
    this.client = new Groq({ apiKey });
    this.model = model;
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: this.model,
      temperature: 0.2,
      max_tokens: 650,
    });
    return res.choices[0]?.message?.content || '';
  }

  async generateStream(
    systemPrompt: string,
    userPrompt: string,
    onToken: (token: string) => void
  ): Promise<{ fullText: string; tokensUsed: number }> {
    const stream = await this.client.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: this.model,
      temperature: 0.2,
      max_tokens: 650,
      stream: true,
    });

    let fullText = '';
    let tokensUsed = 0;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content || '';
      if (delta) {
        fullText += delta;
        tokensUsed += 1;
        onToken(delta);
      }
    }

    return { fullText, tokensUsed };
  }
}

class OllamaLLMProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(baseUrl = 'http://localhost:11434', model = 'llama3') {
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async generate(systemPrompt: string, userPrompt: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `${systemPrompt}\n\nUser Question:\n${userPrompt}`,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Ollama error: ${res.statusText}`);
    const data: any = await res.json();
    return data.response;
  }

  async generateStream(
    systemPrompt: string,
    userPrompt: string,
    onToken: (token: string) => void
  ): Promise<{ fullText: string; tokensUsed: number }> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt: `${systemPrompt}\n\nUser Question:\n${userPrompt}`,
        stream: true,
      }),
    });

    if (!res.ok || !res.body) throw new Error(`Ollama stream error: ${res.statusText}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let tokensUsed = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunkStr = decoder.decode(value);
      const lines = chunkStr.split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.response) {
            fullText += parsed.response;
            tokensUsed += 1;
            onToken(parsed.response);
          }
        } catch {
          // ignore split chunks
        }
      }
    }

    return { fullText, tokensUsed };
  }
}

class MockLLMProvider implements LLMProvider {
  async generate(_systemPrompt: string, _userPrompt: string): Promise<string> {
    return 'Cortex retrieval successful. (Set GROQ_API_KEY in .env for live LLM synthesis)';
  }

  async generateStream(
    _systemPrompt: string,
    _userPrompt: string,
    onToken: (token: string) => void
  ): Promise<{ fullText: string; tokensUsed: number }> {
    const msg = 'Cortex retrieval successful. (Set GROQ_API_KEY in .env for live LLM synthesis)';
    for (const char of msg.split(' ')) {
      onToken(char + ' ');
      await new Promise(r => setTimeout(r, 20));
    }
    return { fullText: msg, tokensUsed: 12 };
  }
}

let llmInstance: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (llmInstance) return llmInstance;

  const providerType = process.env.LLM_PROVIDER || 'groq';
  const groqKey = process.env.GROQ_API_KEY;

  if (providerType === 'groq' && groqKey && !groqKey.includes('your_groq_api_key')) {
    llmInstance = new GroqLLMProvider(groqKey, process.env.GROQ_MODEL);
  } else if (providerType === 'ollama') {
    llmInstance = new OllamaLLMProvider(process.env.OLLAMA_BASE_URL, process.env.OLLAMA_MODEL);
  } else {
    // If user hasn't set GROQ_API_KEY yet, provide clear informative mock fallback
    llmInstance = new MockLLMProvider();
  }

  return llmInstance;
}
