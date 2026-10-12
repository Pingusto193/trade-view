/** Identificador desta aba/aparelho, para ignorar o "eco" das próprias mudanças na sincronização. */
export const CLIENT_ID: string = (() => {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
})();
