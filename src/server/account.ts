import "server-only";

/**
 * Conta do usuário: senha provisória e troca de senha. A implementação usa
 * service_role (src/server/admin/passwords.ts) só para a marca de "trocar a
 * senha" e para redefinir senhas, sempre conferindo tenant/permissão antes.
 */
export { changeOwnPassword, needsPasswordChange, resetClientUserPassword, resetMemberPassword } from "./admin/passwords";
