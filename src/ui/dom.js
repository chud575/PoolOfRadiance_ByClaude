/**
 * Minimal hyperscript DOM helper.
 *   h('div.por-frame#id', {onclick, style:{...}, dataset:{tip:'..'}}, [children|string])
 */
export function h(sel, props = {}, children = []) {
  if (Array.isArray(props) || typeof props === 'string' || props instanceof Node) {
    children = props;
    props = {};
  }
  const [tagPart, ...rest] = sel.split(/(?=[.#])/);
  const el = document.createElement(tagPart || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

/** Render a label with its hotkey letter highlighted: "Encamp" + 'E' → <u>E</u>ncamp */
export function hotkeyLabel(label, key) {
  const i = key ? label.toUpperCase().indexOf(key.toUpperCase()) : -1;
  if (i < 0) return h('span', [label]);
  return h('span', [label.slice(0, i), h('span.por-hk', [label[i]]), label.slice(i + 1)]);
}
