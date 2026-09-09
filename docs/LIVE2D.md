# Live2D 看板娘

全站使用已有的 `public/live2d/yibei_3/` 模型。桌面默认展开于右下角；宽度不超过 767px、粗指针或无悬停能力的设备默认收起。桌面和手机分别在 `sessionStorage` 记住当前标签页的选择，手机首次访问不请求模型、纹理或 Cubism Core。

站内导航使用 `next/link` 和客户端路由，看板娘固定挂载于根布局。切换简报、文章、搜索和收藏页，或使用浏览器前进 / 后退时，沿用同一个画布、模型与动画状态；加载过程中跳转也会继续已有下载。站内链接关闭批量预取，目标页面按访问需要加载。主动刷新整个页面或收起后重新展开仍会重新初始化模型。

## 布局与交互

- 桌面画布宽 180–238px、高度最多 330px 且不超过视口高度的 43%；手机展开后宽 184px、高度最多 260px。按实际渲染的透明像素边界缩放，保留动作余量和屏幕安全区。
- 鼠标移动驱动眼睛、头部与身体轻微跟随；原模型待机动作和 Cubism 呼吸参数保留眨眼、呼吸与物理摆动。
- 点击人物显示中文台词，头部和身体动作只播放一次，然后回到待机。Enter / 空格也可互动；拖动、滚动、文字选择和页面原有控件不触发人物台词。台词可在 `lib/companion-behavior.ts` 调整。
- 画布不拦截页面事件，只对实际可见像素作命中检测。收起按钮保持可见，手机触控目标为 44px。
- 阅读页人物位于悬浮阅读工具上方。图片预览、阅读设置、全屏对话框和通知显示期间隐藏并暂停；后台标签页暂停，收起时释放画布、监听器与 GPU 资源。
- `prefers-reduced-motion: reduce` 停止连续动画与跟随，保留静态人物和文字互动；打印时隐藏。

## 透明部件

`lib/companion-model.ts` 将以下部件、所有后代部件及对应网格的透明度固定为 `0`：

```text
Part
Part34
MBWJJ_wutishiliangxunhuan2
MBWJJ_wutishiliangS
MBWJJ_wutishiliangZ
MBWJJ_wutishiliangX
```

在 Core 更新前后逐帧应用，动作中的部件透明度曲线无法覆盖此设置。原始模型资源保持不变。

## 工具栏扩展

`components/companion-tools.tsx` 提供 `CompanionTools` 与 `CompanionAction` 类型；`Live2DCompanion` 接受 `actions` 属性。动作可包含图标、可访问名称、按钮回调或链接，以及 `pressed` / `external` 状态。默认不填充额外工具；收起按钮独立保留。将需要回调的动作定义在客户端组件中，再传给看板娘。

## 加载与验证

Pixi 与 Live2D 适配器按需导入；Cubism Core 沿用参考实现，从 Live2D 官方地址加载：`https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js`。模型及纹理使用本站路径，并支持 `NEXT_PUBLIC_BASE_PATH`。网络故障有限重试，失败后可手动重试或收起；WebGL 上下文丢失也有有限恢复。

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:build
npx playwright test tests/browser/companion.spec.mjs
```

浏览器验证使用真实模型，需可访问官方 Core 地址。覆盖待机参数变化、鼠标跟随、点击与键盘台词、持续透明、画布边界、页面点击穿透、收起释放与记忆、移动端零模型请求、加载失败、阅读工具避让和打印隐藏。

导航回归同时比对文档、画布和 Core 模型的对象身份及资源请求，检查台词延续、动画继续更新、加载中跳转、文章切换、前进 / 后退、主题参数、日历日期直达和搜索快捷键。链接使用不含 `basePath` 的路由路径，静态资源及复制链接仍使用带部署前缀的路径；根路径与子路径都需构建验证。

`vite.config.ts` 对 `vinext` 1.0.0-beta.9 的静态缓存导航做了兼容修正：命中初始页面缓存时，使用可见页面地址判断跳转，避免将 `index.txt` 数据文件误当成重定向目标。修正只在构建转换时生效，不改写安装包；升级框架后需要复查，若目标代码结构变化会明确报错。搜索页还监听客户端路由参数变化，并区分自身的 URL 写入，以保留输入防抖和已提交搜索的历史记录。
