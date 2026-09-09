import { Compass } from 'lucide-react';
import Link from 'next/link';
export default function NotFound() {
  return (
    <main id="main-content" className="not-found">
      <Compass size={42} />
      <p className="eyebrow">404 · OFF THE MAP</p>
      <h1>这一页还没有留下坐标</h1>
      <p>这一天可能没有简报，或链接已失效。</p>
      <Link prefetch={false} className="primary-button" href="/archive/">
        前往往期简报
      </Link>
      <Link prefetch={false} className="text-button" href="/">
        阅读最新一期
      </Link>
    </main>
  );
}
