export interface ThreadMeta {
  id: string;
  title: string;
  model: string;
  updatedAt: number; // timestamp
  pinned: boolean;
  firstUserMessage?: string;
}
