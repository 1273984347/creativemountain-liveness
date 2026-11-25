// B92 守卫用 fixture：**必定回落**的策略（decide 返回 null）。
//
// 用途：证明「注入失败 ⇒ 回落原启发式 ⇒ 对局行为与不注入时**逐字节相同**」。
// ⚠️ 不得改这个文件的行为 —— 守卫依赖它回落。
export function createPolicy(ctx) {
  return {
    face: 'certify',
    seat: 0,
    decide: async () => null
  };
}
