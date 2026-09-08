import Atlas from '@/components/atlas';
import { briefingMeta, entities } from '@/lib/content';
export const metadata = {
  title: '我的收藏 · Briefing Atlas',
  description: '保存值得再次阅读的科技内容，导出与恢复个人阅读记录。',
};
export default function BookmarksPage() {
  return <Atlas view="bookmarks" meta={briefingMeta} entities={entities} />;
}
