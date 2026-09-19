// h('button', { className: 'primary', onclick }, 'Send')
// Children may be nodes, strings or nested arrays of them; null and false are skipped.
export function h(tag, props = {}, ...children) {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...children.flat(Infinity).filter((child) => child != null && child !== false));
  return el;
}
