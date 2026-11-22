# 今日勇者 · hero-today-v1 · 角色记录（2026-11-21）

规格：charId `hero-today`，血3攻2；抽取今日运势（全局一次，0-9 随机换面板，0/1 暴毙）。剪影：绿披风轻甲勇者+头顶大骰子（spin 自转，cast 运势抽取时放大脉冲）+发带。资产：`characters/hero-today.ts`；站高 1.449（含骰）。接入：models 注册；运势结算走既有 trigger 日志+演出。测试：资产全套（spin 挂点断言）通过。视觉：39 帧归档 batch2（骰子立方体在头顶、披风可见）。迭代：无返工。UNVERIFIED：盲测/真机/掷骰实战帧。未提交未部署。

**实战对局证据（2026-11-21 补）**：隔离服务（PORT=3277，CLIENT_DIST=新构建）AI 对局观察到 \`hero-today-v1\` 正确挂载与入场/行走/受击演出，帧归档 \`docs/screenshots-characters/2026-11-21-realmatch/\`，无页面 JS 报错。
