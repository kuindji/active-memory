/**
 * WordPiece tokenizer for BERT-family models.
 * Tokenizes text into subword units using a vocabulary file.
 */

import { readFile } from "node:fs/promises";

const UNK_TOKEN = "[UNK]";
const CLS_TOKEN = "[CLS]";
const SEP_TOKEN = "[SEP]";
const PAD_TOKEN = "[PAD]";
const MAX_WORD_LENGTH = 200;
const SUBWORD_PREFIX = "##";

class WordPieceTokenizer {
    private vocab: Map<string, number> = new Map();
    private initialized = false;

    async load(vocabPath: string): Promise<void> {
        const text = await readFile(vocabPath, "utf-8");
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i++) {
            const token = lines[i].trim();
            if (token.length > 0) {
                this.vocab.set(token, i);
            }
        }
        this.initialized = true;
    }

    private tokenToId(token: string): number {
        return this.vocab.get(token) ?? this.vocab.get(UNK_TOKEN) ?? 0;
    }

    private basicTokenize(text: string): string[] {
        text = text.toLowerCase();
        text = text.replace(/([\p{P}\p{S}])/gu, " $1 ");
        return text.split(/\s+/).filter((t) => t.length > 0);
    }

    private wordpieceTokenize(word: string): string[] {
        if (word.length > MAX_WORD_LENGTH) {
            return [UNK_TOKEN];
        }

        const tokens: string[] = [];
        let start = 0;

        while (start < word.length) {
            let end = word.length;
            let found: string | null = null;

            while (start < end) {
                const substr =
                    start > 0 ? SUBWORD_PREFIX + word.slice(start, end) : word.slice(start, end);
                if (this.vocab.has(substr)) {
                    found = substr;
                    break;
                }
                end--;
            }

            if (found === null) {
                tokens.push(UNK_TOKEN);
                break;
            }

            tokens.push(found);
            start = end;
        }

        return tokens;
    }

    tokenize(text: string): string[] {
        if (!this.initialized) throw new Error("Tokenizer not loaded. Call load() first.");
        const basicTokens = this.basicTokenize(text);
        const result: string[] = [];
        for (const token of basicTokens) {
            result.push(...this.wordpieceTokenize(token));
        }
        return result;
    }

    encode(text: string, maxLength: number): { inputIds: number[]; attentionMask: number[] } {
        if (!this.initialized) throw new Error("Tokenizer not loaded. Call load() first.");

        const tokens = this.tokenize(text);
        const truncated = tokens.slice(0, maxLength - 2);

        const inputIds: number[] = [
            this.tokenToId(CLS_TOKEN),
            ...truncated.map((t) => this.tokenToId(t)),
            this.tokenToId(SEP_TOKEN),
        ];

        const attentionMask: number[] = new Array(inputIds.length).fill(1) as number[];

        const padId = this.tokenToId(PAD_TOKEN);
        while (inputIds.length < maxLength) {
            inputIds.push(padId);
            attentionMask.push(0);
        }

        return { inputIds, attentionMask };
    }
}

export { WordPieceTokenizer };
