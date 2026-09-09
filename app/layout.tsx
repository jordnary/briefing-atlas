import type { Metadata } from 'next';
import './globals.css';
import 'katex/dist/katex.min.css';
import { ReadingProvider } from '@/components/reading-provider';
import { Live2DCompanion } from '@/components/live2d-companion';
import { href } from '@/lib/paths';
export const metadata: Metadata = {
  icons: { icon: href('/favicon.svg') },
  title: 'Briefing Atlas · 科技简报图志',
  description:
    '以日期和主题连接 AI 与科技知识。浏览每日简报、搜索历史新闻，收藏值得再次阅读的内容。',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <a className="skip-link" href="#main-content">
          跳转到正文
        </a>
        <ReadingProvider>{children}</ReadingProvider>
        {/* Keep the scene outside route content so client navigation preserves it. */}
        <Live2DCompanion />
      </body>
    </html>
  );
}
