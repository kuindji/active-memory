export type Turn = {
    id: string;
    text: string;
};

export type ContextMemory = {
    id: string;
    text: string;
    content: number[];
    context: number[];
    ts: number;
};

export type ScoredMemory = {
    id: string;
    text: string;
    score: number;
    contentScore: number;
    contextScore: number;
};

export type Segmentation = {
    boundaries: number[];
    k: number;
    cost: number;
};

export type BoundaryScore = {
    precision: number;
    recall: number;
    f1: number;
    tp: number;
    fp: number;
    fn: number;
};
