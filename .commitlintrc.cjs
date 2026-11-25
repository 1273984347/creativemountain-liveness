/**
 * Conventional Commits 规则（B86 发布时引入）。
 *
 * ⚠️ 必须用 .cjs：本仓 package.json 是 "type": "module" ⇒ .js 会被当 ESM；
 *   而 .json 存不下 ignores 里的**函数**（JSON.stringify 会把它变成 null ⇒ 配置非法）。
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => /^merge/i.test(message.subject)],
  rules: {
    // 规则参数格式是 [level, applicability, value] ⇒ value 放第三位
    'header-max-length': [2, 'always', 200],
    'subject-case': [0],
  },
};
