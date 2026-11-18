// B79 T15 Step 1（复算入口）：清点 `tests/**` 的主题词命中并分类。
// 跑法：node tools/presets/b79-inventory.mjs
// 这是记录 §9.1 那张表的**唯一尺**（规格 r1.10 起，别处不许再抄第二份数字）。
//
// 分类口径（规格 §5.1）：
//   TITLE   测试标题里的主题词          ⇒ 措辞，本任务改
//   MSG     断言的**消息**参数含主题词  ⇒ 措辞，本任务改
//   CODE    出现在判据/期望值/fixture    ⇒ 数据，保留并进 R7 登记表逐文件登记
//   COMMENT 整行注释                    ⇒ 仅当它「把主题词当机制讲」才改；L-B78-* 债注记原样保留
import { readFileSync } from 'node:fs';
import { relOf, walkSources } from './common.mjs';
import { leafWordsFromThemes } from '../theme-word-scan.mjs';

const WORDS = leafWordsFromThemes().map((w) => w.word);
// 规格 §2 的历史词也算（这些词在测试标题里同样误导读者）
const ALL = [...new Set([...WORDS, '峰顶', '体力'])];

const cat = { TITLE: [], MSG: [], CODE: [], COMMENT: [] };
for (const f of walkSources('tests')) {
  const rel = relOf(f);
  readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    if (!ALL.some((w) => l.includes(w))) return;
    const t = l.trim();
    let kind;
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) kind = 'COMMENT';
    else if (/^(test|it)(\.\w+)?\(/.test(t)) kind = 'TITLE';
    else if (/(assert\.\w+\([\s\S]*)?['"][^'"]*(必须|应当|应该|否则|⇒|前提)/.test(t) && /['"]$|['"]\);?$/.test(t)) kind = 'MSG';
    else kind = 'CODE';
    cat[kind].push(`${rel}:${String(i + 1)}  ${t.slice(0, 90)}`);
  });
}
console.log('禁字表：', ALL.length, '词');
console.log('合计：', Object.entries(cat).map(([k, v]) => `${k}=${String(v.length)}`).join(' '),
  '| 总', cat.TITLE.length + cat.MSG.length + cat.CODE.length + cat.COMMENT.length);

// 逐文件分布（§9.2 那张「47 行归属」分类表就是照这一段逐条判出来的）
const bucket = (lines) => lines.map((l) => l.split(':')[0]);
const per = new Map();
for (const [kind, lines] of Object.entries(cat)) {
  for (const f of bucket(lines)) per.set(f, { TITLE: 0, MSG: 0, CODE: 0, COMMENT: 0, ...(per.get(f) ?? {}) })[kind] += 1;
}
console.log('\n=== 逐文件（T 标题 / M 消息 / C 判据与数据 / * 注释）===');
for (const [f, o] of [...per.entries()].sort((a, b) => (b[1].TITLE + b[1].MSG + b[1].CODE) - (a[1].TITLE + a[1].MSG + a[1].CODE))) {
  console.log(`T${String(o.TITLE)} M${String(o.MSG)} C${String(o.CODE)} /*${String(o.COMMENT)}  ${f}`);
}

console.log('\n=== CODE（判据/期望值/fixture，须逐条判「数据 or 措辞」）===');
for (const l of cat.CODE) console.log(l);
console.log('\n=== MSG（断言消息，措辞类）===');
for (const l of cat.MSG) console.log(l);
