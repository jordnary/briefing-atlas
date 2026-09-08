# 入场动画

`components/float-in.tsx` 提供可复用的 `FloatIn` 组件。内容首次进入视口时从下方轻轻浮起并淡入，每次挂载只播放一次；离开视口再返回、收藏或展开预览都不会重播。每日简报、历史简报、搜索与收藏页通过共用的 `StoryCard` 自动使用此效果。

```tsx
import { FloatIn } from '@/components/float-in';

<FloatIn as="section" className="summary-panel" duration={600} distance={20}>
  <h2>本期导读</h2>
  <p>导读内容</p>
</FloatIn>;
```

- `as`：使用 `div`（默认）、`article`、`section` 或 `li`，直接渲染对应语义元素，不增加布局包裹。
- `duration`：时长，默认 `600` 毫秒。
- `distance`：向上浮入的起始偏移，默认 `20` 像素。
- `delay`：进入视口后的延迟，默认 `0` 毫秒；同屏短列表可使用小幅延迟错开入场，长列表应避免按全局序号累计延迟。
- 支持标准 HTML 属性、`className` 和 `style`；样式随组件导入，无需额外注册。

动画仅改变透明度和位移，不影响文档布局。系统启用“减少动态效果”、打印页面、禁用 JavaScript 或浏览器缺少 `IntersectionObserver` 时，内容直接显示。键盘焦点进入组件时立即结束动画，目录锚点目标也始终可见。
