export const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
export const href = (path: string) =>
  `${basePath}${path.startsWith('/') ? path : `/${path}`}`;
export const storyHref = (date: string, id: string) =>
  href(`/read/${date}/${id}/`);
export const topics = [
  'AI 与大模型',
  '机器学习',
  '开发工具',
  '游戏与交互',
  '科技行业',
];
