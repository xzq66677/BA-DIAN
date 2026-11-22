# 吹箫哥 · chuixiao-v1 · 角色记录（2026-11-21，基线 e4cef57 + 前序角色改动）

规格：charId `chuixiao`，血3攻1，仅远程（异房间直选）。剪影：青竹宽袍+常驻唇边竹箫（head 挂点随头动）+束发；远程出手=凝气吹奏（微后仰）。资产：`characters/chuixiao.ts`，无外部依赖；站高 1.333，reset 脚底 0.025。接入：models `chuixiao → chuixiao-v1`，事件链无新增（远程攻击走既有演出）。测试：character-assets 全套（含 flute 挂点断言）通过。视觉：39 帧归档 `docs/screenshots-characters/2026-11-21-batch2/`（箫在唇边、手位抱箫、GOJO 同屏）。迭代：无返工（kit 默认头颈修复后一次过）。UNVERIFIED：盲测辨识/真机/实战对局帧。未提交未部署。

**实战对局证据（2026-11-21 补）**：隔离服务（PORT=3277，CLIENT_DIST=新构建）AI 对局观察到 \`chuixiao-v1\` 正确挂载与入场/行走/受击演出，帧归档 \`docs/screenshots-characters/2026-11-21-realmatch/\`，无页面 JS 报错。
