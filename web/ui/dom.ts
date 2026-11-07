// DOM 小工具（无框架，零依赖）。

/** 创建元素。 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') { node.className = v; }
    else if (k === 'text') { node.textContent = v; }
    else { node.setAttribute(k, v); }
  }
  for (const c of children) {
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

/** 按钮。 */
export function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el('button', { class: 'btn', type: 'button', text: label });
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

/** 区块标题 + 内容容器。 */
export function section(title: string, ...children: (Node | string)[]): HTMLElement {
  const s = el('section', { class: 'panel' });
  s.append(el('h2', { class: 'panel-title', text: title }));
  const body = el('div', { class: 'panel-body' });
  for (const c of children) {
    body.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  s.append(body);
  return s;
}
