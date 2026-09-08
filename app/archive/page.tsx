import Atlas from '@/components/atlas';
import { briefingMeta } from '@/lib/content';
export const metadata = {
  title: '往期简报 · Briefing Atlas',
  description: '按年份、月份与日期浏览科技简报，回看每一条技术线索。',
};
export default function ArchivePage() {
  return <Atlas view="archive" meta={briefingMeta} />;
}
