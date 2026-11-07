'use strict';

// 聚合引擎：把多个 scanner 的结果合并为统一画像。
// M5 将在此扩展关系图谱构建与跨实体关联。
function aggregate(input, results) {
  const attributes = {};
  const entities = {};
  (results || []).forEach((r) => {
    if (r && r.data && typeof r.data === 'object') {
      Object.assign(attributes, r.data);
      entities[r.source] = r.data;
    }
  });
  return {
    input,
    profile: attributes,
    bySource: entities,
  };
}

module.exports = { aggregate };
