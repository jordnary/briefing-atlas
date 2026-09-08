// Explicitly invoked sample writer; normal builds never overwrite authored content.
import { mkdir, writeFile } from 'node:fs/promises';
const sources = {
  attention: {
    title: 'Attention Is All You Need',
    url: 'https://arxiv.org/abs/1706.03762',
    type: 'paper',
    publishedAt: '2017-06-12',
  },
  lora: {
    title: 'LoRA: Low-Rank Adaptation of Large Language Models',
    url: 'https://arxiv.org/abs/2106.09685',
    type: 'paper',
    publishedAt: '2021-06-17',
  },
  rag: {
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    url: 'https://arxiv.org/abs/2005.11401',
    type: 'paper',
    publishedAt: '2020-05-22',
  },
  dpo: {
    title: 'Direct Preference Optimization',
    url: 'https://arxiv.org/abs/2305.18290',
    type: 'paper',
    publishedAt: '2023-05-29',
  },
  voyager: {
    title: 'Voyager: An Open-Ended Embodied Agent with Large Language Models',
    url: 'https://arxiv.org/abs/2305.16291',
    type: 'paper',
    publishedAt: '2023-05-25',
  },
  agents: {
    title: 'Generative Agents: Interactive Simulacra of Human Behavior',
    url: 'https://arxiv.org/abs/2304.03442',
    type: 'paper',
    publishedAt: '2023-04-07',
  },
  flash: {
    title:
      'FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness',
    url: 'https://arxiv.org/abs/2205.14135',
    type: 'paper',
    publishedAt: '2022-05-27',
  },
  diffusion: {
    title: 'Denoising Diffusion Probabilistic Models',
    url: 'https://arxiv.org/abs/2006.11239',
    type: 'paper',
    publishedAt: '2020-06-19',
  },
};
const story = (
  id,
  title,
  summary,
  tags,
  entities,
  source,
  what,
  why,
  practice,
) => ({
  id,
  title,
  summary,
  tags,
  entities,
  eventDate: sources[source].publishedAt,
  sources: [sources[source]],
  verificationStatus: 'verified',
  verificationNote:
    '已依据原始论文摘要核对方法概述；影响与实践启示为编辑解读。',
  relatedEventId: source,
  body: `### 发生了什么\n\n${what}\n\n### 为什么重要\n\n${why}\n\n### 实践或研究启示\n\n${practice}`,
});
const issues = [
  {
    date: '2026-09-08',
    title: '回到基础，理解 AI 的演进脉络。',
    summary:
      '从 Transformer 的注意力机制，到低成本微调、检索增强与偏好对齐。沿着五条线索，梳理大模型从研究走向应用的关键方法。',
    stories: [
      story(
        'transformer-attention',
        'Transformer：注意力机制如何改变语言建模',
        '用注意力机制连接序列中的信息，为语言模型提供更适合并行训练的架构。',
        ['AI 与大模型', '机器学习'],
        ['Google', 'Transformer'],
        'attention',
        '2017 年的论文提出 Transformer，以注意力为核心，不再依赖循环或卷积来完成序列转换。作者在机器翻译任务中验证了这一架构。',
        '它提供了观察序列建模的一种思路：信息之间的关系可以直接计算，不必只通过递归状态传递。这也使并行训练成为方法设计的一部分。',
        '阅读后续模型时，可先分清架构、训练目标与数据三个层次。不要只凭模型参数量比较能力；任务与评估设置同样影响结果。',
      ),
      story(
        'lora-efficient-adaptation',
        'LoRA：让大模型微调变得更轻量',
        '冻结原有权重，只训练低秩更新矩阵，为定制模型提供参数更少的路径。',
        ['AI 与大模型', '开发工具'],
        ['Microsoft', 'LoRA'],
        'lora',
        'LoRA 在冻结预训练权重的同时，注入可训练的低秩分解矩阵，减少下游适配需要更新的参数。',
        '对于需要维护多种任务适配的应用，分离基础权重与适配参数具有工程价值。但更少的可训练参数并不等于所有任务都能保持相同效果。',
        '先固定一份代表性验证集，再比较不同秩与训练数据设置。权重更新可记为 $W = W_0 + BA$，其中低秩矩阵承担本次任务的调整。',
      ),
      story(
        'rag-retrieval-grounding',
        'RAG：为语言模型接入可检索的知识',
        '把检索到的外部资料引入生成过程，让知识更新与模型参数更新有更多选择。',
        ['AI 与大模型', '开发工具'],
        ['Meta', 'RAG'],
        'rag',
        'RAG 研究将参数化语言模型与非参数化的检索索引结合，用于知识密集型自然语言任务。模型在生成时可以使用检索到的文档。',
        '资料可以作为独立的知识层维护。不过，检索到文档本身并不保证答案正确，检索与生成都需要评估。',
        '搭建知识库时，分别记录召回结果与最终回答。先检查正确资料是否进入上下文，再检查回答是否忠实于资料，避免把两类失败混为一谈。',
      ),
      story(
        'dpo-preference-learning',
        'DPO：用偏好数据直接优化语言模型',
        '通过成对偏好样本优化模型，重新组织语言模型与人类偏好对齐的训练流程。',
        ['机器学习', 'AI 与大模型'],
        ['Stanford', 'DPO'],
        'dpo',
        'DPO 论文从偏好优化目标出发，提出直接使用偏好对训练语言模型的方法，其流程不需要单独训练显式奖励模型。',
        '它提供了一种更简化的训练思路，但偏好数据中的偏差与任务覆盖范围仍然会影响结果。方法简单不意味着评估可以省略。',
        '检查偏好对是否清楚表达真实任务需求，并保留独立评估集。比较对齐前后的事实性、格式遵循与拒答行为，而不只观察单一分数。',
      ),
      story(
        'evaluation-first-workflow',
        '从论文到实践：建立自己的模型评估基线',
        '把任务样例、失败类型和复现条件保存下来，让每一次模型迭代都有可比较的依据。',
        ['开发工具', '科技行业'],
        ['RAG', 'LoRA'],
        'rag',
        '作为 RAG 论文阅读后的实践整理，可以把一次知识问答拆成资料检索和答案生成两个环节。这是一份编辑提出的实验建议，不是新增研究结论。',
        '如果只评估最终输出，资料缺失与生成错误容易混在一起。分开观察能够帮助定位应当修改的部分。',
        '建立一个小型版本化样例集，例如：\n\n```json\n{\n  "question": "这项方法解决什么问题？",\n  "expected_source": "paper-id",\n  "check": "回答是否由所引来源支持"\n}\n```\n\n保留失败样例，后续每次调整都重新运行。',
      ),
    ],
  },
  {
    date: '2026-09-07',
    title: '当智能体走进可交互的世界。',
    summary:
      '从 Minecraft 中的技能积累，到虚拟小镇中的记忆与反思。回顾两项让语言模型与环境交互的代表性研究。',
    stories: [
      story(
        'voyager-minecraft-agent',
        'Voyager：在 Minecraft 中积累可复用技能',
        '自动课程、可执行技能库与反馈迭代，共同构成一个开放式探索智能体。',
        ['游戏与交互', 'AI 与大模型'],
        ['Minecraft', 'GPT-4'],
        'voyager',
        'Voyager 通过 GPT-4 的黑盒调用在 Minecraft 中探索，将行为保存成可执行代码，并利用环境反馈改进程序。',
        '这项研究把技能的保存与再利用放到交互系统中，使能力积累不必完全依赖模型参数更新。',
        '制作游戏原型时，可以把可执行动作与自然语言计划分开记录。逐次检查环境反馈，避免把一次成功演示视为可靠的长期行为。',
      ),
      story(
        'generative-agents-memory',
        'Generative Agents：让虚拟角色拥有记忆与反思',
        '在由 25 个智能体组成的交互沙盒中，研究记忆、规划与反思如何影响行为。',
        ['游戏与交互'],
        ['Stanford', 'Google'],
        'agents',
        '研究构建了一个由语言模型驱动的交互沙盒，使用自然语言记录经历，并在行为规划中检索记忆、形成反思。',
        '对游戏开发而言，它提供了设计角色行为的一组架构线索。研究中的可信行为不等同于所有复杂场景都能保持一致。',
        '从少量角色开始，测试记忆是否被正确调用、行为是否与角色设定一致。保留人工控制边界，逐步扩大交互范围。',
      ),
    ],
  },
  {
    date: '2026-09-04',
    title: '算得更快，也要理解为什么。',
    summary: '从显存读写与模型适配两个角度，观察效率优化究竟发生在哪一层。',
    stories: [
      story(
        'flashattention-io',
        'FlashAttention：把数据搬运纳入注意力优化',
        '通过关注 GPU 内存层级之间的读写，优化精确注意力计算的效率。',
        ['机器学习', '开发工具'],
        ['FlashAttention', 'GPU'],
        'flash',
        'FlashAttention 提出 IO 感知的注意力算法，使用分块等策略减少 GPU 高带宽内存与片上存储之间的数据传输。',
        '算法的理论计算量并不能描述所有实际性能。数据在哪里、怎样移动，同样影响运行时间与内存使用。',
        '性能对比应记录硬件、输入长度、精度与批量大小。先确认工作负载是否相近，再比较公开基准。',
      ),
      story(
        'lora-adapter-management',
        '适配器管理：把基础模型与任务更新分开',
        '从 LoRA 的结构出发，整理多任务模型实验的版本管理方式。',
        ['开发工具', '科技行业'],
        ['Microsoft', 'LoRA'],
        'lora',
        'LoRA 将任务更新表示为较小的可训练矩阵，与冻结的基础权重分开。这种结构也让实验产物的组织有了更清楚的边界。',
        '在方法之外，能够追溯每次适配使用的数据、配置与基础权重，是复现实验的前提。',
        '给每份适配器记录基础模型版本和数据快照，并在相同验证集上比较。此处是工程建议，不是论文新增的实验结果。',
      ),
    ],
  },
  {
    date: '2026-09-01',
    title: '生成式模型，如何一步步去噪？',
    summary: '以扩散模型为起点，再次理解生成过程与评估条件之间的关系。',
    stories: [
      story(
        'diffusion-denoising',
        '扩散模型：从噪声中逐步还原结构',
        'Denoising Diffusion Probabilistic Models 研究了一类通过去噪过程进行生成的概率模型。',
        ['机器学习', 'AI 与大模型'],
        ['DDPM', 'Diffusion'],
        'diffusion',
        '2020 年的 DDPM 论文研究去噪扩散概率模型，并展示图像生成结果。方法把生成建模与逐步去噪联系起来。',
        '它为理解生成过程提供了与直接输出不同的视角，也提醒读者关注训练与采样各自承担的工作。',
        '复现时应分别记录训练配置、采样设置与图像评估方式。不要将不同采样条件下的结果直接视为同一标准的比较。',
      ),
    ],
  },
  {
    date: '2026-08-28',
    title: '知识库的第一步，是找对资料。',
    summary: '回顾检索增强生成中的证据链，以及如何阅读一项方法的边界。',
    stories: [
      story(
        'rag-evidence-chain',
        '从检索到引用：让知识问答留下证据链',
        '将召回资料与回答内容一起保存，便于复查答案来自哪里。',
        ['开发工具', 'AI 与大模型'],
        ['Meta', 'RAG'],
        'rag',
        'RAG 将外部文档引入知识密集型任务的生成过程。基于这一结构，可以进一步设计面向应用的引用记录。',
        '可追溯的来源能够帮助用户复查回答，但引用存在不代表引用支持了整段结论。',
        '在测试集中加入“资料中没有答案”的问题，检查系统是否承认证据不足。这是本文的实践建议。',
      ),
    ],
  },
  {
    date: '2025-12-31',
    title: '从一篇论文，延伸出一张知识地图。',
    summary: '以 Transformer 为起点，记录方法的背景、来源与仍待验证的问题。',
    stories: [
      story(
        'attention-reading-map',
        '读懂 Transformer：先建立问题清单',
        '把架构动机、实验任务与适用边界放在同一张阅读地图中。',
        ['AI 与大模型', '科技行业'],
        ['Google', 'Transformer'],
        'attention',
        'Transformer 论文围绕序列转换提出注意力架构，并在机器翻译任务中报告实验。这一期将它作为建立论文阅读档案的样例。',
        '阅读方法时，把作者实际测试的任务与自己的应用场景分开，能够减少对结论范围的误读。',
        '每篇论文保留三个问题：它试图解决什么、用什么证据支持、哪些场景尚未验证。之后按主题回看，逐步形成自己的知识索引。',
      ),
    ],
  },
];
for (const issue of issues) {
  const date = issue.date;
  const { stories } = issue;
  const meta = {
    id: `briefing-${date}`,
    briefingDate: date,
    title: issue.title,
    summary: issue.summary,
    publishedAt: `${date}T08:00:00+08:00`,
    updatedAt: `${date}T08:00:00+08:00`,
    status: 'published',
    sample: true,
    stories: stories.map(({ body: _body, ...story }) => story),
  };
  const directory = `content/briefings/${date.slice(0, 4)}/${date.slice(5, 7)}`;
  await mkdir(directory, { recursive: true });
  await writeFile(
    `${directory}/${date}.md`,
    `---\n${JSON.stringify(meta, null, 2)}\n---\n\n${stories.map((story) => `## ${story.id}\n\n${story.body}`).join('\n\n')}\n`,
    { encoding: 'utf8', flag: 'wx' },
  );
}
console.log(
  'Created six explicitly labeled sample issues. Existing files are never overwritten.',
);
