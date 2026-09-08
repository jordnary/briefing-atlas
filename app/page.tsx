import Atlas from '@/components/atlas';
import { briefings, briefingMeta } from '@/lib/content';
export default function Home() {
  return <Atlas view="latest" meta={briefingMeta} briefing={briefings[0]} />;
}
