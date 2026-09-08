import Atlas from '@/components/atlas';
import { briefingMeta, entities } from '@/lib/content';
export const metadata = {
  title: '探索主题 · Briefing Atlas',
  description:
    '搜索历史科技新闻，支持短语、布尔逻辑、字段限定、相关度权重及主题、机构、日期组合筛选。',
};
export default function SearchPage() {
  return <Atlas view="search" meta={briefingMeta} entities={entities} />;
}
