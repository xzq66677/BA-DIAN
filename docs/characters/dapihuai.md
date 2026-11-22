# 大屁孩 · dapihuai-v1 · 角色记录（2026-11-21）

规格：charId `dapihuai`，血3攻1；判定历史三不同→暴走精神攻击、三同→自爆。剪影：矮个胖小孩（palette 0.74，站高 0.786）+超大圆头+背带裤+呆毛+腮红。资产：`characters/dapihuai.ts`，儿童比例（hipY .42）。暴走前扑抓挠=attackSwing 覆盖；欢呼蹦跳=cheer 覆盖；自爆是淘汰演出（场景层）。接入：models 注册；判定历史记忆/暴走/自爆走既有规则层。测试：资产全套通过（身高按 0.74 归一断言）。视觉：39 帧归档 batch2。迭代：无返工。UNVERIFIED：盲测/真机/暴走自爆实战帧。未提交未部署。

**实战对局证据（2026-11-21 补）**：隔离服务（PORT=3277，CLIENT_DIST=新构建）AI 对局观察到 \`dapihuai-v1\` 正确挂载与入场/行走/受击演出，帧归档 \`docs/screenshots-characters/2026-11-21-realmatch/\`，无页面 JS 报错。
