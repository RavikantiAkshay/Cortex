import { pipeline } from '@xenova/transformers';

export interface EmbeddingProvider {
  dimension: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

class LocalTransformerEmbeddingProvider implements EmbeddingProvider {
  private extractor: any = null;
  public dimension: number = 384; // all-MiniLM-L6-v2 default
  private modelName: string;

  constructor(modelName = 'Xenova/all-MiniLM-L6-v2') {
    this.modelName = modelName;
  }

  private async getExtractor() {
    if (!this.extractor) {
      this.extractor = await pipeline('feature-extraction', this.modelName);
    }
    return this.extractor;
  }

  async embed(text: string): Promise<number[]> {
    const extractor = await this.getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }
}

class OpenAIEmbeddingProvider implements EmbeddingProvider {
  public dimension: number = 1536;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model = 'text-embedding-3-small') {
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const batch = await this.embedBatch([text]);
    return batch[0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts,
        model: this.model,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI Embedding error: ${err}`);
    }

    const data: any = await res.json();
    return data.data.map((item: any) => item.embedding);
  }
}

let providerInstance: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (providerInstance) return providerInstance;

  const providerType = process.env.EMBEDDING_PROVIDER || 'local';
  const openAiKey = process.env.OPENAI_API_KEY;

  if (providerType === 'openai' && openAiKey) {
    providerInstance = new OpenAIEmbeddingProvider(openAiKey);
  } else {
    providerInstance = new LocalTransformerEmbeddingProvider(process.env.EMBEDDING_MODEL);
  }

  return providerInstance;
}
