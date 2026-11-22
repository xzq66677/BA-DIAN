# 卖大伊万的小女孩 · ivan-girl-v1 · 角色记录（2026-11-21）

规格：charId `ivan-girl`，血2攻0；投掷大伊万（延迟爆炸，场景层 deferred/ivan）。剪影：橙棕矮个少女（palette 0.92）+双马尾+怀抱圆炸弹（引信金）。资产：`characters/ivan-girl.ts`，儿童比例（hipY .52/腿短/头大）；站高 1.044。投掷=过顶掷出（attackSwing 抱弹上举→前掷，炸弹随动）。接入：models 注册；伊万本体/爆炸/落点标记是场景 FX，rig 只表现投掷动作。测试：资产全套（bomb 挂点断言）通过。视觉：39 帧归档 batch2。迭代：① 发绳 stroke 顶在头上读成"角" → 删除（马尾垂绺已可读）。UNVERIFIED：盲测/真机/投掷→爆炸实战链帧。未提交未部署。

**实战对局证据（2026-11-21 补）**：隔离服务（PORT=3277，CLIENT_DIST=新构建）AI 对局观察到 \`ivan-girl-v1\` 正确挂载与入场/行走/受击演出，帧归档 \`docs/screenshots-characters/2026-11-21-realmatch/\`，无页面 JS 报错。
