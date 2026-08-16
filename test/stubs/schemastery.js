// Minimal @deepseek-ai/schemastery stub for unit tests.
// Config schemas are only *defined* at import time (never validated in these
// mock tests), so each builder returns a chainable no-op so
// `.default/.optional/.required/.min/.max/.step/.describe` never throw.
function chain() {
  const fn = () => chain()
  fn.default = () => chain()
  fn.optional = () => chain()
  fn.required = () => chain()
  fn.min = () => chain()
  fn.max = () => chain()
  fn.step = () => chain()
  fn.describe = () => chain()
  return fn
}

const z = {
  object: (shape) => shape,
  string: () => chain(),
  number: () => chain(),
  natural: () => chain(),
  boolean: () => chain(),
  array: () => chain(),
  dict: () => chain(),
}

export default z
