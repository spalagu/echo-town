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

项目正在实施 M2。当前本地功能分支已经具备首个可运行纵切面：

- Phaser 4 的静态 2D 小镇，可移动并与四处地点互动。
- 浏览器本地随机居民、Ed25519 签名密钥、IndexedDB 持久化和口令加密导入导出。
- Rust 编写并编译到 WebAssembly 的确定性 World Core，负责签名、序列、预算、观察哈希和移动范围校验。
- Dedicated Worker 内的规则优先 Local Mind；CPU/Wasm 小模型只生成低频语言候选，失败后降级规则模式。
- 有来源的工作/长期记忆、追加纠正、不可普通遗忘事实，以及与公共相识分离的私人非对称关系视图。
- 12 个冻结人格与可解释 Persona Core；人格、价值、需要和心境会改变 Intent 排序，核心特质只会有边界地缓慢成长。
- 四维 Capability 状态会显式呈现规则 AI、离线单人、世界暂停或仅当前会话等降级，不把缺失能力伪装成就绪。
- 首次在线加载后，Service Worker 缓存版本化静态制品；断网重开仍可进入同一角色、记忆和离线单人世界。
- 世界内容使用声明式 ContentPack v1、InitialStatePack v1 与 SituationSeed v1；本地编译器拒绝角色槽位、剧情阶段、预期结果、结局、远程脚本、HTML、可执行文件、缺失署名与超预算资产，并生成确定性内容清单。
- Public Discourse 只从真实 Event 追加观点，保留来源、受众、转述和反驳；热度不是真值。HistoricalSummary 只能事后读取 Event，Planner exact-key 白名单拒绝摘要回灌。
- 3 个初态包和 5 个情境种子会经过 12 人格 × 30 world seed 的确定性社会模拟；观察、角色自己的记忆、可见舆论、关系和资源张力会进入多轮决策，浏览器制品也会运行同一套社会运行时。社区只能贡献开端、约束和行动可能性，不能提交剧本结果。
- Pull Request 门禁候选使用只读 token、零 secret、完整 SHA 固定的官方 Action 和七项独立检查；远端 Actions 与 Ruleset 尚未启用。
- 内容寻址的静态构建清单；相同源码重复构建得到相同文件哈希。

项目仍未启用 GitHub Actions、Ruleset 或 GitHub Pages，也没有公开可玩的线上版本。

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
npm run ci:workflow
npm run ci:world-schema
npm run ci:asset-budget
npm run ci:license-policy
npm run ci:content-safety
```

`npm run build` 会先生成 Rust/WebAssembly 核心，再构建完全静态的浏览器制品和版本清单。浏览器测试通过本地静态预览访问交付制品，不依赖应用服务器或云模型。

## 参与贡献

请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。世界内容贡献必须描述新增的初始条件、可观察事实、角色可采取的行动和资源约束，不得提交主线、支线、指定参与角色、必达转折、预期结果或结局。

## 许可证

- 源代码使用 [Apache License 2.0](LICENSE)。
- 世界文本、世界数据和项目原创素材使用 [CC BY 4.0](LICENSE-CONTENT.md)。
- 第三方素材继续遵守各自许可证，并登记在 [ATTRIBUTIONS.md](ATTRIBUTIONS.md)。
