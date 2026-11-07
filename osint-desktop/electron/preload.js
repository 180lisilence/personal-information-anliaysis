// 预加载脚本：HTTP 模式下前端直接 fetch 后端，这里仅做最小桥接。
// 若后续需要本地文件/数据库读写，可在此安全暴露受限 API。
window.addEventListener('DOMContentLoaded', () => {
  // 占位：保持 contextIsolation 习惯，不暴露 node 全局。
});
