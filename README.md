# Echo Town

Echo Town 是一个浏览器本地运行的 2D AI 虚拟小镇。角色拥有稳定人格、短期与长期记忆、非对称关系和自己的立场；世界只提供初态、规则、资源、信息差与外生扰动，社会历史由角色的观察、舆论传播、自主行动和真实后果共同生成。

## 核心原则

- 只给开端，永不写剧本。
- AI 只能提出类型化行动意图，权威世界状态由确定性 Rust/WebAssembly 核心裁决。
- 舆论热度不等于事实，观点必须保留来源、受众、反驳和传播变形。
- 角色的私人记忆与主观关系默认留在浏览器本地。
- 社区通过 Pull Request 增加世界的可能性，而不是指定参与角色、转折或结局。
- 项目使用第三方或社区公共协调节点，不部署、采购、运营或维护协调节点。

## 当前阶段

项目正在验证 M3 的首个可玩候选。公开 GitHub Pages 仍是旧 M2 制品：旧制品具备组件与发布链，但零输入时不会持续推进角色生活，不能称为首个可玩版本。M3 当前只在本地分支验证，尚未推送或部署。

- Phaser 4 的静态 2D 小镇；角色位置只由 Rust/WebAssembly 核心接受的 Event 投影，玩家在观察席陪伴和施加可拒绝影响，不用 WASD、方向键或地图点击直接遥控角色。
- 浏览器本地随机居民、Ed25519 签名密钥、IndexedDB 持久化和口令加密导入导出。
- Rust 编写并编译到 WebAssembly 的确定性 World Core，负责签名、序列、预算、观察哈希和移动范围校验。
- Dedicated Worker 内的规则优先 Local Mind；CPU/Wasm 小模型只生成低频语言候选，失败后降级规则模式。
- 有来源的工作/长期记忆、追加纠正、不可普通遗忘事实，以及与公共相识分离的私人非对称关系视图。
- 12 个冻结人格与可解释 Persona Core；人格、价值、需要和心境会改变 Intent 排序，核心特质只会有边界地缓慢成长。
- 四维 Capability 状态会显式呈现规则 AI、离线单人、世界暂停或仅当前会话等降级，不把缺失能力伪装成就绪。
- 产品级 World Sync 候选使用版本化的第三方公共节点清单、Nostr/WebTorrent 双信令策略和 WebRTC DataChannel；同步批次由居民 Ed25519 身份签名，严格检查 epoch/sequence、防重放和状态哈希链，排他事件还必须携带 2/3 签名 authority lease。项目不提供 TURN 或节点 SLA，直连失败仍显式保持离线单人。
- 首次在线加载后，Service Worker 缓存版本化静态制品；断网重开仍可进入同一角色、记忆和离线单人世界。
- 世界内容使用声明式 ContentPack v1、InitialStatePack v1 与 SituationSeed v1；本地编译器拒绝角色槽位、剧情阶段、预期结果、结局、远程脚本、HTML、可执行文件、缺失署名与超预算资产，并生成确定性内容清单。
- Public Discourse 只从真实 Event 追加观点，保留来源、受众、转述和反驳；热度不是真值。HistoricalSummary 只能事后读取 Event，Planner exact-key 白名单拒绝摘要回灌。
- 3 个初态包和 5 个情境种子会经过 12 人格 × 30 world seed 的确定性社会模拟；该模拟是内容与社会规则的组件证据，不再被当作正式页面持续运行的证明。
- M3 正式页面以单一低频编排器持续执行“逻辑时钟/Observation → Dedicated Worker Local Mind → 签名 Intent → Rust/Wasm World Core → Event → Memory Graph/Relationship View → Phaser”。每轮 Observation 会读回上一轮的权威位置、来源化记忆和关系信号，任何渲染帧或 UI 都不能绕过 World Core 改位置。
- Pull Request 门禁使用只读 token、零 secret、完整 SHA 固定的官方 Action 和七项独立检查；Pages 发布只在 `main` push 后从合并 SHA 全量重建，构建 job 只读，只有 deploy job 拥有 Pages/OIDC 写权限。
- 内容寻址的静态构建清单；相同源码重复构建得到相同文件哈希。

## 在线体验

公开入口：[https://spalagu.github.io/echo-town/](https://spalagu.github.io/echo-town/)。该 URL 当前仍运行旧 M2 制品，尚未包含 M3 持续自主生活闭环；只有 M3 获得独立发布批准并通过部署后 60 秒零输入复验，README 才会把线上版本重新标为首个可玩版本。首次打开需要下载静态资源，之后可由 Service Worker 支持离线重开；第三方公共协调节点不可用时会明确降级为离线单人模式。

## 本地复验

需要 Node.js 20.19 或更高版本、Rust 1.85 或更高版本、`wasm32-unknown-unknown` target 和 `wasm-bindgen-cli`。首次运行先安装 JavaScript 依赖：

```bash
npm install
```

启动本地小镇：

```bash
npm run build
npm run preview
```

复验身份和确定性核心：

```bash
npm run check
npm run test:world-core-wasm
npm run test:browser
npm run test:identity-browser
npm run test:local-mind-browser
npm run test:memory-scenarios
npm run test:memory-browser
npm run test:persona-scenarios
npm run test:capability-scenarios
npm run test:society-scenarios
npm run test:society-browser
npm run test:autonomy-browser
npm run test:autonomy-mutations
npm run test:world-sync
npm run test:serverless
npm run test:world-sync-browser
npm run ci:workflow
npm run ci:world-schema
npm run ci:asset-budget
npm run ci:license-policy
npm run ci:content-safety
npm run ci:pages
npm run test:pages-local
SOURCE_COMMIT=$(git rev-parse HEAD) npm run build
node scripts/pages-release.mjs write apps/web/dist --commit "$(git rev-parse HEAD)"
node scripts/pages-release.mjs verify apps/web/dist --commit "$(git rev-parse HEAD)"
SOURCE_COMMIT=$(git rev-parse HEAD) npm run test:pages-browser
```

`npm run build` 会先生成 Rust/WebAssembly 核心，再构建完全静态的浏览器制品和版本清单。浏览器测试通过本地静态预览访问交付制品，不依赖应用服务器或云模型。

`npm run test:autonomy-browser` 对同一正式静态制品分别运行两段 60 秒零输入黑盒，核对决策频率、单轮并发、World Core 哈希、来源化记忆、关系变化和 Phaser 位置；`npm run test:autonomy-mutations` 分别断开时钟、Observation、Local Mind、World Core、记忆/关系和场景投影，要求同一因果不变量全部判红。组件单测、预计算历史、随机动画和测试 API 移动都不能替代这两项证据。

`npm run test:world-sync-browser` 会用随机房间和两个隔离浏览器对第三方公共 Nostr relay、WebTorrent tracker 与真实 WebRTC 直连做一次低负载黑盒。公共节点没有项目可控 SLA；测试失败时产品必须显示离线状态，不得通过部署项目节点补洞。

## 参与贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。世界内容贡献必须描述新增的初始条件、可观察事实、角色可采取的行动和资源约束，不得提交主线、支线、指定参与角色、必达转折、预期结果或结局。

## 许可证

- 源代码使用 [Apache License 2.0](LICENSE)。
- 世界文本、世界数据和项目原创素材使用 [CC BY 4.0](LICENSE-CONTENT.md)。
- 第三方素材继续遵守各自许可证，并登记在 [ATTRIBUTIONS.md](ATTRIBUTIONS.md)。
