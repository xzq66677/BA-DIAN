## 已知问题（meshopt 压缩入库后）

- 入库 GLB 采用 meshopt 几何压缩（EXT_meshopt_compression，Issue #108 契约）。量化后
  「Revive is exact reverse of death」一项不再按压缩前基线通过：四元数逐分量误差
  1.16e-6（阈值 1e-6），采样点数 141 不变，位置/缩放误差为 0——视觉不可辨。
- 其余 28 项全过；`evidence/validation.json` 与入库 GLB sha256（eae0c1b44ec8）一致。
- 预览已接入 MeshoptDecoder（`preview/main.js`）。
