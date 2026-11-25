// B92 守卫用 fixture：**必定抛错**的策略（decide throw）。
//
// 用途：证明「策略抛错 ⇒ 问策略处捕获并回落（计数 fallbacks 递增）⇒ 对局不崩、不卡死」。
// ⚠️ 不得改这个文件的行为 —— 守卫依赖它抛错。
export function createPolicy(ctx) {
  return {
    face: 'certify',
    seat: 0,
    decide: async () => { throw new Error('B92 负样本：故意抛错'); }
  };
}
