export function createUserMessage(input) {
  return { role: 'user', id: 'mock', ...input }
}
