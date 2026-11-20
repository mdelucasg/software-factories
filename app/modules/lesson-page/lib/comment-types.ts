export type CommentAuthor = {
  id: number;
  name: string;
  avatarUrl: string | null;
  isInstructor: boolean;
  isPlatformAdmin: boolean;
};

export type RenderedComment = {
  id: number;
  body: string;
  bodyHtml: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  author: CommentAuthor;
  replies: RenderedComment[];
};
